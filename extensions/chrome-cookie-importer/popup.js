import {
  DEFAULT_API_URL,
  MAGALU_DOMAINS,
  MAGALU_ONELINK_API,
  ML_DOMAINS,
  buildAuthHeaders,
  cookieMetadata,
  deduplicateCookies,
  isMercadoLivreUrl,
  normalizeApiUrl,
  redactSensitiveText,
  serializeCookies,
} from './lib/pure.js';

const $ = (id) => document.getElementById(id);
const log = globalThis.extLog;

let affiliates = [];
let selectedUserId = null;
let authToken = '';
let authState = null; // { status: 'valid'|'expired'|'missing'|'pending'|'error', ... }

void init();

async function init() {
  const saved = await chrome.storage.local.get([
    'apiUrl',
    'sessionState',
    'authToken',
    'authState',
    'authDebugEnabled',
    'logsUploadEnabled',
    'logsUploadLastSentAt',
    'logsUploadLastError',
    'logsUploadBuffer',
    'logsUploadLastBatchSize',
    'logsUploadApiKey',
  ]);
  $('apiUrl').value = saved.apiUrl || DEFAULT_API_URL;
  authToken = saved.authToken || '';
  authState = saved.authState || null;

  const debugToggle = $('debugLogsToggle');
  if (debugToggle) debugToggle.checked = saved.authDebugEnabled === true;

  const logsToggle = $('logsUploadToggle');
  if (logsToggle) logsToggle.checked = saved.logsUploadEnabled === true;

  log.info('popup.init', {
    apiUrl: $('apiUrl').value,
    hasToken: Boolean(authToken),
    authStatus: authState?.status || null,
    logDebugEnabled: log.isEnabled(),
    logsUploadEnabled: saved.logsUploadEnabled === true,
    hasApiKey: Boolean(saved.logsUploadApiKey),
  });

  renderLogsUploadStatus({
    enabled: saved.logsUploadEnabled === true,
    lastSentAt: saved.logsUploadLastSentAt || null,
    lastError: saved.logsUploadLastError || null,
    bufferSize: Array.isArray(saved.logsUploadBuffer) ? saved.logsUploadBuffer.length : 0,
    lastBatchSize: saved.logsUploadLastBatchSize || null,
    hasApiKey: Boolean(saved.logsUploadApiKey),
  });

  await updateMLStatus();
  renderAuthState();
  await loadAffiliates(saved.sessionState);
  renderSessionState(saved.sessionState);

  setupTabs();
  setupEvents();
}

/** Renderiza o status do sink de logs (último envio, buffer, erro). */
function renderLogsUploadStatus(s) {
  const el = $('logsUploadStatus');
  const btn = $('flushLogsBtn');
  if (!el) return;
  if (!s.enabled) {
    el.textContent = 'Envio de logs desativado.';
    el.style.color = '#64748b';
    if (btn) btn.style.display = 'none';
    return;
  }
  if (!s.hasApiKey) {
    el.textContent = '⚠️ Ativado, mas falta configurar a API key em Configurações.';
    el.style.color = '#fca5a5';
    if (btn) btn.style.display = 'none';
    return;
  }
  const parts = [];
  if (s.lastSentAt) {
    const ago = Math.round((Date.now() - new Date(s.lastSentAt).getTime()) / 1000);
    const label =
      ago < 60
        ? `há ${ago}s`
        : ago < 3600
          ? `há ${Math.round(ago / 60)}min`
          : `há ${Math.round(ago / 3600)}h`;
    parts.push(`Último envio: ${label} (${s.lastBatchSize ?? '?'} logs)`);
  } else {
    parts.push('Ainda sem envios.');
  }
  if (s.bufferSize > 0) parts.push(`Buffer: ${s.bufferSize}`);
  if (s.lastError) parts.push(`❌ Último erro: ${s.lastError}`);
  el.textContent = parts.join(' · ');
  el.style.color = s.lastError ? '#fca5a5' : '#86efac';
  if (btn) btn.style.display = s.bufferSize > 0 ? 'block' : 'none';
}

async function refreshAuth() {
  log.info('popup.refreshAuth.click');
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'check-auth' });
    log.info('popup.refreshAuth.response', { valid: res?.valid });
  } catch (err) {
    log.error('popup.refreshAuth.failed', { error: String(err) });
    throw err;
  }
  const saved = await chrome.storage.local.get(['authToken', 'authState']);
  authToken = saved.authToken || '';
  authState = saved.authState || null;
  renderAuthState();
  return res;
}

function renderAuthState() {
  const el = $('authState');
  const badge = $('sessionBadge');
  const relogin = $('reloginHint');
  if (!authState || authState.status === 'missing') {
    el.textContent = '🔴 Não logado';
    el.className = 'session-state expired';
    if (badge) badge.textContent = '🔴';
    if (relogin) relogin.style.display = 'block';
    return;
  }
  if (authState.status === 'pending') {
    el.textContent = '🟡 Verificando...';
    el.className = 'session-state neutral';
    if (badge) badge.textContent = '🟡';
    if (relogin) relogin.style.display = 'none';
    return;
  }
  if (authState.status === 'error') {
    el.textContent = '🟠 Erro ao verificar';
    el.className = 'session-state neutral';
    if (badge) badge.textContent = '🟠';
    if (relogin) relogin.style.display = 'block';
    return;
  }
  if (authState.status === 'expired') {
    el.textContent = '🔴 Sessão expirada';
    el.className = 'session-state expired';
    if (badge) badge.textContent = '🔴';
    if (relogin) relogin.style.display = 'block';
    return;
  }
  // valid
  const who = authState.name || authState.email || 'usuário';
  el.textContent = `🟢 Logado · ${who}`;
  el.className = 'session-state valid';
  if (badge) badge.textContent = '🟢';
  if (relogin) relogin.style.display = 'none';
}

async function updateMLStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isML = Boolean(tab?.url && isMercadoLivreUrl(tab.url));
  const isShopee = Boolean(tab?.url?.includes('shopee'));
  const isAmazon = Boolean(tab?.url?.includes('amazon'));
  $('mlStatus').textContent =
    isML || isShopee || isAmazon ? '🟡 Abra um produto' : '🔴 Abra um marketplace';
}

function authHeaders() {
  return buildAuthHeaders(authToken);
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document
        .querySelectorAll('.tab, .tab-content')
        .forEach((el) => el.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });
}

function setupEvents() {
  $('importBtn').addEventListener('click', importCookies);
  $('validateBtn').addEventListener('click', validateSession);
  $('magaluTestBtn').addEventListener('click', testMagaluOneLink);
  $('magaluSyncBtn').addEventListener('click', syncMagaluCookies);
  $('refreshAuthBtn').addEventListener('click', async () => {
    $('authState').textContent = '🟡 Verificando...';
    await refreshAuth();
  });
  const debugToggle = $('debugLogsToggle');
  if (debugToggle) {
    debugToggle.addEventListener('change', async () => {
      const enabled = debugToggle.checked;
      await chrome.storage.local.set({ authDebugEnabled: enabled });
      log.info('popup.debug-toggle.changed', { enabled });
    });
  }
  const logsToggle = $('logsUploadToggle');
  if (logsToggle) {
    logsToggle.addEventListener('change', async () => {
      const enabled = logsToggle.checked;
      await chrome.storage.local.set({ logsUploadEnabled: enabled });
      log.info('popup.logs-upload.changed', { enabled });
    });
  }
  const flushBtn = $('flushLogsBtn');
  if (flushBtn) {
    flushBtn.addEventListener('click', async () => {
      flushBtn.disabled = true;
      flushBtn.textContent = '⏳ Enviando...';
      try {
        const res = await chrome.runtime.sendMessage({ type: 'flush-logs-now' });
        log.info('popup.flush-clicked', { ok: res?.success });
      } catch (err) {
        log.error('popup.flush-clicked.failed', { error: String(err) });
      } finally {
        setTimeout(() => {
          flushBtn.disabled = false;
          flushBtn.textContent = '🚀 Enviar agora';
        }, 1500);
      }
    });
  }
  $('optionsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Auto-update: re-renderiza quando o SW grava novo authState/authToken.
  // Resolve o problema de abrir o popup antes do SW terminar o verify-auth —
  // antes era preciso fechar e abrir de novo (ou clicar "Verificar login").
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.authState) {
      authState = changes.authState.newValue || null;
      log.info('popup.storage.authState.changed', { status: authState?.status });
      renderAuthState();
    }
    if (changes.authToken) {
      authToken = changes.authToken.newValue || '';
    }
    if (changes.sessionState) {
      renderSessionState(changes.sessionState.newValue);
    }
    // Re-render do status do sink quando buffer/lastSent mudarem
    const sinkKeys = [
      'logsUploadLastSentAt',
      'logsUploadLastError',
      'logsUploadBuffer',
      'logsUploadLastBatchSize',
      'logsUploadEnabled',
      'logsUploadApiKey',
    ];
    if (sinkKeys.some((k) => k in changes)) {
      chrome.storage.local.get(
        [
          'logsUploadEnabled',
          'logsUploadLastSentAt',
          'logsUploadLastError',
          'logsUploadBuffer',
          'logsUploadLastBatchSize',
          'logsUploadApiKey',
        ],
        (saved) => {
          renderLogsUploadStatus({
            enabled: saved.logsUploadEnabled === true,
            lastSentAt: saved.logsUploadLastSentAt || null,
            lastError: saved.logsUploadLastError || null,
            bufferSize: Array.isArray(saved.logsUploadBuffer) ? saved.logsUploadBuffer.length : 0,
            lastBatchSize: saved.logsUploadLastBatchSize || null,
            hasApiKey: Boolean(saved.logsUploadApiKey),
          });
        },
      );
    }
  });
}

async function loadAffiliates(sessionState) {
  const apiUrl = normalizeApiUrl($('apiUrl').value);
  if (!apiUrl) return;
  try {
    const res = await fetch(`${apiUrl}/api/ml/affiliates`, { headers: authHeaders() });
    const data = await res.json();
    if (!data.success || !data.affiliates?.length) return;
    affiliates = data.affiliates;
    const select = $('affiliateSelect');
    select.innerHTML = '<option value="">— Selecione —</option>';
    for (const a of affiliates)
      select.appendChild(
        new Option(`${a.nickname} (${a.mlUserId})${a.hasSessionCookies ? ' 🔗' : ''}`, a.mlUserId),
      );

    const remembered = sessionState?.mlUserId;
    const only = affiliates.length === 1 ? affiliates[0].mlUserId : null;
    selectedUserId = remembered || only || null;
    select.value = selectedUserId || '';
    setActionState();
  } catch {}
}

function setActionState() {
  const has = Boolean(selectedUserId);
  $('importBtn').disabled = !has;
  $('validateBtn').disabled = !has;
}

function renderSessionState(state) {
  const el = $('sessionState');
  if (!state?.status) {
    el.textContent = 'Ainda não validada';
    el.className = 'session-state neutral';
    return;
  }
  el.textContent =
    state.status === 'valid'
      ? `🟢 Válida${state.melitat ? ' · ' + state.melitat : ''}`
      : '🔴 Expirada';
  el.className = `session-state ${state.status}`;
  $('sessionBadge').textContent = state.status === 'valid' ? '🟢' : '🔴';
}

function showStatus(id, msg, type) {
  const el = $(id);
  el.textContent = redactSensitiveText(msg);
  el.className = `status ${type}`;
}

async function importCookies() {
  if (!selectedUserId) return;
  const apiUrl = normalizeApiUrl($('apiUrl').value);
  if (!apiUrl) return showStatus('sessionStatus', 'URL da API inválida', 'error');

  $('importBtn').disabled = true;
  showStatus('sessionStatus', 'Lendo cookies...', 'loading');
  try {
    const allCookies = [];
    for (const domain of ML_DOMAINS) allCookies.push(...(await chrome.cookies.getAll({ domain })));
    const cookies = deduplicateCookies(allCookies);
    const meta = cookieMetadata(cookies);
    if (!meta.count) {
      showStatus('sessionStatus', 'Nenhum cookie encontrado. Faça login no ML.', 'error');
      return;
    }

    const res = await fetch(`${apiUrl}/api/ml/affiliates/${encodeURIComponent(selectedUserId)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ sessionCookies: serializeCookies(cookies) }),
    });
    const data = await res.json();
    if (!data.success) {
      showStatus('sessionStatus', `Erro: ${data.error}`, 'error');
      return;
    }
    await validateSession();
  } catch (err) {
    showStatus('sessionStatus', `Erro: ${err.message}`, 'error');
  }
}

async function validateSession() {
  if (!selectedUserId) return;
  const apiUrl = normalizeApiUrl($('apiUrl').value);
  if (!apiUrl) return;
  $('validateBtn').disabled = true;
  showStatus('sessionStatus', 'Validando...', 'loading');
  try {
    const res = await fetch(
      `${apiUrl}/api/ml/affiliates/${encodeURIComponent(selectedUserId)}/validate-cookies`,
      { method: 'POST', headers: authHeaders() },
    );
    const data = await res.json();
    const state = {
      mlUserId: selectedUserId,
      status: data.valid ? 'valid' : 'expired',
      melitat: data.melitat || null,
      checkedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ sessionState: state });
    await chrome.runtime.sendMessage({ type: 'set-session-state', state });
    renderSessionState(state);
    showStatus(
      'sessionStatus',
      data.valid
        ? `✅ Válida${data.melitat ? ' · ' + data.melitat : ''}`
        : `❌ ${data.error || 'Inválida'}`,
      data.valid ? 'success' : 'error',
    );
  } catch (err) {
    showStatus('sessionStatus', `Erro: ${err.message}`, 'error');
  }
}

// ─── Magalu (Magazine Você) ─────────────────────────────────────────────────

async function testMagaluOneLink() {
  const btn = $('magaluTestBtn');
  btn.disabled = true;
  showStatus('magaluStatus', 'Testando OneLink com a sessão do navegador...', 'loading');

  try {
    const testProduct =
      'https://www.magazineluiza.com.br/perfume-cebolinha-25ml-edicao-limitada-frasco-de-vidro-jequiti/p/jb440h4cc8/de/frap/';
    const res = await fetch(MAGALU_ONELINK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        addPartnerId: true,
        desktopLink: testProduct,
        link: testProduct.replace('www.magazineluiza.com.br', 'm.magazineluiza.com.br'),
      }),
    });

    const data = await res.json();
    if (res.ok && data.shortenedLink) {
      $('magaluState').textContent = `🟢 Sessão válida · OneLink OK`;
      $('magaluState').className = 'session-state valid';
      showStatus('magaluStatus', `✅ OneLink gerado: ${data.shortenedLink}`, 'success');
    } else {
      $('magaluState').textContent = '🔴 Sessão expirada';
      $('magaluState').className = 'session-state expired';
      showStatus(
        'magaluStatus',
        `❌ ${data.message || 'Sessão inválida. Faça login no magazinevoce.com.br'}`,
        'error',
      );
    }
  } catch (err) {
    showStatus('magaluStatus', `❌ Erro: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

/**
 * Lê os cookies do magazinevoce.com.br (incluindo HttpOnly) e envia
 * para a API para persistência (magalu_affiliates.session_cookies).
 */
async function syncMagaluCookies() {
  const apiUrl = normalizeApiUrl($('apiUrl').value);
  if (!apiUrl) return showStatus('magaluStatus', 'URL da API inválida', 'error');

  const btn = $('magaluSyncBtn');
  btn.disabled = true;
  showStatus('magaluStatus', 'Lendo cookies do Magazine Você...', 'loading');

  try {
    const allCookies = [];
    for (const domain of MAGALU_DOMAINS)
      allCookies.push(...(await chrome.cookies.getAll({ domain })));
    const cookies = deduplicateCookies(allCookies);
    const meta = cookieMetadata(cookies);
    if (!meta.count) {
      showStatus(
        'magaluStatus',
        'Nenhum cookie encontrado. Faça login no magazinevoce.com.br.',
        'error',
      );
      return;
    }

    const res = await fetch(`${apiUrl}/api/magalu/affiliate/cookies`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ sessionCookies: serializeCookies(cookies) }),
    });
    const data = await res.json();
    if (data.success) {
      showStatus('magaluStatus', `✅ ${meta.count} cookies Magalu salvos!`, 'success');
    } else {
      showStatus('magaluStatus', `❌ Erro do servidor: ${data.error || 'desconhecido'}`, 'error');
    }
  } catch (err) {
    showStatus('magaluStatus', `❌ Erro: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}
