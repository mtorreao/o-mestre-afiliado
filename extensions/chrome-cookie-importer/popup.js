import {
  DEFAULT_API_URL,
  MAGALU_DOMAINS,
  ML_DOMAINS,
  buildAuthHeaders,
  cookieMetadata,
  deduplicateCookies,
  normalizeApiUrl,
  redactSensitiveText,
  serializeCookies,
} from './lib/pure.js';

const $ = (id) => document.getElementById(id);
const log = globalThis.extLog;

let mlUserId = null;
let apiUrl = '';
let authToken = '';
let authState = null; // { status: 'valid'|'expired'|'missing'|'pending'|'error', ... }

void init();

async function init() {
  log.info('popup.init.start', {
    hasGlobalLog: Boolean(globalThis.extLog),
    hasGlobalSink: Boolean(globalThis.extLogSink),
  });

  // Abre um port com o SW pra detectar abertura. O SW aproveita
  // pra disparar verifyAuthToken() imediato (sem esperar polling).
  // O port fica vivo enquanto o popup existir; cleanup automático
  // quando o usuário fecha.
  try {
    const port = chrome.runtime.connect({ name: 'popup' });
    port.postMessage({ type: 'opened' });
    window.addEventListener('beforeunload', () => {
      try {
        port.disconnect();
      } catch {
        /* popup já fechando */
      }
    });
  } catch (e) {
    log.warn('popup.init.connect.failed', { error: String(e) });
  }

  const saved = await chrome.storage.local.get([
    'apiUrl',
    'sessionState',
    'authToken',
    'authState',
  ]);
  log.info('popup.init.after-storage-get', { keys: Object.keys(saved) });
  apiUrl = normalizeApiUrl(saved.apiUrl || DEFAULT_API_URL);
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

  // O logout do painel remove o token do localStorage da página, mas a
  // extensão mantém uma cópia em chrome.storage. Sincroniza diretamente
  // com a aba ativa antes de validar, evitando usar token obsoleto.
  await syncTokenFromActivePanel();

  // Revalida o token contra a API antes de renderizar, para não confiar
  // em authState obsoleto do storage (ex: usuario deslogou em outra aba).
  try {
    await chrome.runtime.sendMessage({ type: 'check-auth' });
    const refreshed = await chrome.runtime.sendMessage({ action: 'get-auth-state' });
    if (refreshed?.authState) authState = refreshed.authState;
    if (refreshed?.authToken !== undefined) authToken = refreshed.authToken;
  } catch (e) {
    log.warn('popup.init.check-auth.failed', { error: String(e) });
  }

  log.info('popup.init', {
    apiUrl,
    hasToken: Boolean(authToken),
    authStatus: authState?.status || null,
    authEmail: authState?.email || null,
    authReason: authState?.reason || null,
  });

  renderGreeting();
  renderAuthState();
  await loadMlAffiliate();

  setupEvents();
}

async function syncTokenFromActivePanel() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !tab.url?.startsWith('https://dev.omestreafiliado.com.br/')) return;

    const [{ result: token } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => localStorage.getItem('omestre_auth_token') || '',
    });

    await chrome.runtime.sendMessage({ type: 'set-auth-token', token: token || '' });
    const fresh = await chrome.runtime.sendMessage({ action: 'get-auth-state' });
    if (fresh?.authState) authState = fresh.authState;
    if (fresh?.authToken !== undefined) authToken = fresh.authToken;
  } catch (e) {
    log.warn('popup.sync-active-panel.failed', { error: String(e) });
  }
}

function renderGreeting() {
  const greeting = $('greeting');
  if (!greeting) return;

  const isLoggedIn = authState?.status === 'valid';
  const name = authState?.name || authState?.email?.split('@')[0];
  greeting.textContent = isLoggedIn ? (name ? `Olá, ${name} \u{1F44B}` : 'Olá') : '';
  greeting.hidden = !isLoggedIn;
}

function renderAuthState() {
  log.debug('renderAuthState.start', {
    hasAuthState: Boolean(authState),
    status: authState?.status,
  });
  const el = $('authState');
  if (!el) return;
  if (!authState || authState.status === 'missing') {
    el.textContent = '🔴 Não logado';
    el.className = 'session-state neutral';
    return;
  }
  if (authState.status === 'pending') {
    el.textContent = '🟡 Verificando...';
    el.className = 'session-state neutral';
    return;
  }
  if (authState.status === 'error') {
    el.textContent = '🟠 Erro ao verificar';
    el.className = 'session-state neutral';
    return;
  }
  if (authState.status === 'expired') {
    el.textContent = '🔴 Sessão expirada';
    el.className = 'session-state expired';
    return;
  }
  // valid
  el.textContent = `🟢 Logado`;
  el.className = 'session-state valid';
}

function authHeaders() {
  return buildAuthHeaders(authToken);
}

function setupEvents() {
  $('importBtn').addEventListener('click', importCookies);
  // Magalu desativado temporariamente (2026-08-01)
  // $('magaluSyncBtn').addEventListener('click', syncMagaluCookies);

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
      renderGreeting();
      renderAuthState();
    }
    if (changes.authToken) {
      authToken = changes.authToken.newValue || '';
    }
  });
}

async function loadMlAffiliate() {
  // Não depende mais do OAuth do ML. Apenas verifica se o usuário está
  // logado no app para habilitar a importação de cookies.
  if (!authToken) {
    $('importBtn').disabled = true;
    showStatus('sessionStatus', 'Faça login no painel para importar cookies.', 'error');
    return;
  }

  $('importBtn').disabled = false;
  $('sessionStatus').textContent = '';
}

function showStatus(id, msg, type) {
  const el = $(id);
  el.textContent = redactSensitiveText(msg);
  el.className = `status ${type}`;
}

function extractMlUserIdFromCookies(cookies) {
  // O ML armazena o user ID em cookies como _d2id ou _d_id
  for (const cookie of cookies) {
    if (cookie.name === '_d2id' || cookie.name === '_d_id') {
      const value = String(cookie.value || '');
      // Extrair apenas dígitos (o ID numérico do usuário)
      const match = value.match(/(\d+)/);
      if (match) return match[1];
    }
  }
  return null;
}

async function importCookies() {
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

    // Envia cookies para o novo endpoint que extrai mlUserId automaticamente
    const res = await fetch(`${apiUrl}/api/ml/affiliates/import-cookies`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ sessionCookies: serializeCookies(cookies) }),
    });
    const data = await res.json();
    if (!data.success) {
      showStatus('sessionStatus', `Erro: ${data.error}`, 'error');
      return;
    }
    showStatus('sessionStatus', `✅ ${meta.count} cookies salvos.`, 'success');
  } catch (err) {
    showStatus('sessionStatus', `Erro: ${err.message}`, 'error');
  } finally {
    $('importBtn').disabled = false;
  }
}

// ─── Magalu (Magazine Você) ─────────────────────────────────────────────────

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
