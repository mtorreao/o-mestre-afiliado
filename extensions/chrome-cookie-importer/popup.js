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
  log.info('popup.init.start', {
    hasGlobalLog: Boolean(globalThis.extLog),
    hasGlobalSink: Boolean(globalThis.extLogSink),
  });
  const saved = await chrome.storage.local.get([
    'apiUrl',
    'sessionState',
    'authToken',
    'authState',
  ]);
  log.info('popup.init.after-storage-get', { keys: Object.keys(saved) });
  console.log('[DEBUG] popup.init.after-storage-get OK');
  const apiUrlEl = $('apiUrl');
  if (apiUrlEl) apiUrlEl.value = saved.apiUrl || DEFAULT_API_URL;
  authToken = saved.authToken || '';
  authState = saved.authState || null;
  try {
    const fresh = await chrome.runtime.sendMessage({ action: 'get-auth-state' });
    log.info('popup.init.after-send-message', { fresh });
    if (fresh?.authState) authState = fresh.authState;
    if (fresh?.authToken !== undefined) authToken = fresh.authToken;
  } catch (e) {
    log.warn('popup.init.send-message-failed', { error: String(e) });
    /* SW não respondeu — fica com o que tinha no storage */
  }

  log.info('popup.init', {
    apiUrl: $('apiUrl')?.value || DEFAULT_API_URL,
    hasToken: Boolean(authToken),
    authStatus: authState?.status || null,
    authEmail: authState?.email || null,
    authReason: authState?.reason || null,
  });

  await updateMLStatus();
  renderAuthState();
  await loadAffiliates(saved.sessionState);
  renderSessionState(saved.sessionState);

  setupTabs();
  setupEvents();
}

function renderAuthState() {
  log.debug('renderAuthState.start', {
    hasAuthState: Boolean(authState),
    status: authState?.status,
  });
  const el = $('authState');
  const badge = $('sessionBadge');
  const relogin = $('reloginHint');
  if (!authState || authState.status === 'missing') {
    // Estado inicial — SW ainda não verificou. Não mostrar "Não logado"
    // (parece erro mas é só "ainda não checou").
    el.textContent = '🟡 Verificando...';
    el.className = 'session-state neutral';
    if (badge) badge.textContent = '🟡';
    if (relogin) relogin.style.display = 'none';
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
  el.textContent = `🟢 ${who}`;
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
  $('magaluTestBtn').addEventListener('click', testMagaluOneLink);
  $('magaluSyncBtn').addEventListener('click', syncMagaluCookies);
  $('optionsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Auto-update: re-renderiza quando o SW grava novo authState/authToken.
  // Resolve o problema de abrir o popup antes do SW terminar o verify-auth.
  // Filtra mudanças do proprio log-sink pra evitar feedback loop
  // (o sink grava logsUpload* no storage a cada flush, e logá-los de volta
  //  geraria entradas infinitas).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const relevantKeys = Object.keys(changes).filter((k) => !k.startsWith('logsUpload'));
    if (relevantKeys.length === 0) return;
    log.info('popup.storage.changed', { keys: relevantKeys });
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
  });
}

async function loadAffiliates(sessionState) {
  const apiUrlEl = $('apiUrl');
  const apiUrl = normalizeApiUrl(apiUrlEl?.value);
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
  $('importBtn').disabled = !Boolean(selectedUserId);
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
  const apiUrl = normalizeApiUrl($('apiUrl')?.value);
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
    showStatus(
      'sessionStatus',
      `✅ ${meta.count} cookies salvos. Use "Testar OneLink" para validar a sessão.`,
      'success',
    );
  } catch (err) {
    showStatus('sessionStatus', `Erro: ${err.message}`, 'error');
  } finally {
    $('importBtn').disabled = false;
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
  const apiUrl = normalizeApiUrl($('apiUrl')?.value);
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
