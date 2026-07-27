import {
  DEFAULT_API_URL,
  ML_DOMAINS,
  cookieMetadata,
  deduplicateCookies,
  isMercadoLivreUrl,
  normalizeApiUrl,
  redactSensitiveText,
  serializeCookies,
} from './lib/pure.js';

const $ = (id) => document.getElementById(id);
let affiliates = [];
let selectedUserId = null;
let activeTab = null;

void init();

async function init() {
  const saved = await chrome.storage.local.get(['apiUrl', 'sessionState']);
  $('apiUrl').value = saved.apiUrl || DEFAULT_API_URL;
  await checkActiveTab();
  await loadAffiliates(saved.sessionState);
  $('apiUrl').addEventListener('change', saveApiUrl);
  $('affiliateSelect').addEventListener('change', onAffiliateChange);
  $('importBtn').addEventListener('click', importCookies);
  $('validateBtn').addEventListener('click', validateSession);
  $('optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

async function checkActiveTab() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isML = Boolean(activeTab?.url && isMercadoLivreUrl(activeTab.url));
  $('mlStatus').textContent = isML ? '🟢 ML detectado' : '🔴 Abra o ML';
  $('mlStatus').style.color = isML ? '#4ade80' : '#f87171';
}

async function loadAffiliates(sessionState) {
  const apiUrl = getApiUrl();
  if (!apiUrl) {
    showStatus('Configure uma URL de API válida.', 'error');
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/api/ml/affiliates`);
    const data = await res.json();
    if (!data.success || !data.affiliates?.length) {
      renderAffiliates([], sessionState);
      showStatus('Nenhum afiliado encontrado na API.', 'error');
      return;
    }
    affiliates = data.affiliates;
    renderAffiliates(affiliates, sessionState);
  } catch (error) {
    renderAffiliates([], sessionState);
    showStatus(`Erro de conexão: ${redactSensitiveText(error.message)}`, 'error');
  }
}

function renderAffiliates(items, sessionState) {
  const select = $('affiliateSelect');
  select.innerHTML = '';
  if (!items.length) {
    select.innerHTML = '<option value="">Nenhum afiliado encontrado</option>';
    setActionState();
    renderSessionState(sessionState);
    return;
  }

  select.appendChild(new Option('— Selecione um afiliado —', ''));
  for (const a of items) {
    const suffix = a.hasSessionCookies ? ' 🔗' : '';
    select.appendChild(new Option(`${a.nickname} (ID: ${a.mlUserId})${suffix}`, a.mlUserId));
  }

  const remembered = sessionState?.mlUserId;
  const onlyAffiliate = items.length === 1 ? items[0].mlUserId : null;
  selectedUserId = remembered || onlyAffiliate || null;
  select.value = selectedUserId || '';
  setActionState();
  renderSessionState(sessionState);
}

function saveApiUrl() {
  const apiUrl = normalizeApiUrl($('apiUrl').value);
  if (apiUrl) {
    $('apiUrl').value = apiUrl;
    void chrome.storage.local.set({ apiUrl });
  }
}

function getApiUrl() {
  return normalizeApiUrl($('apiUrl').value);
}

function onAffiliateChange() {
  selectedUserId = $('affiliateSelect').value || null;
  setActionState();
}

function setActionState() {
  const has = Boolean(selectedUserId);
  $('importBtn').disabled = !has;
  $('validateBtn').disabled = !has;
}

async function importCookies() {
  if (!selectedUserId) return;
  const apiUrl = getApiUrl();
  if (!apiUrl) return showStatus('Configure uma URL de API válida.', 'error');

  const button = $('importBtn');
  button.disabled = true;
  showStatus('Lendo cookies do Mercado Livre...', 'loading');

  try {
    const allCookies = [];
    for (const domain of ML_DOMAINS) {
      allCookies.push(...(await chrome.cookies.getAll({ domain })));
    }
    const cookies = deduplicateCookies(allCookies);
    const meta = cookieMetadata(cookies);
    if (!meta.count) {
      showStatus('Nenhum cookie encontrado. Faça login no ML e tente novamente.', 'error');
      return;
    }

    showStatus(`Enviando ${meta.count} cookies para a API segura...`, 'loading');
    const res = await fetch(`${apiUrl}/api/ml/affiliates/${encodeURIComponent(selectedUserId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCookies: serializeCookies(cookies) }),
    });
    const data = await res.json();
    if (!data.success) {
      showStatus(
        `Erro do servidor: ${redactSensitiveText(data.error || 'não informado')}`,
        'error',
      );
      return;
    }

    await validateSession();
  } catch (error) {
    showStatus(`Erro ao sincronizar: ${redactSensitiveText(error.message)}`, 'error');
  } finally {
    button.disabled = false;
    setActionState();
  }
}

async function validateSession() {
  if (!selectedUserId) return;
  const apiUrl = getApiUrl();
  if (!apiUrl) return showStatus('Configure uma URL de API válida.', 'error');

  $('validateBtn').disabled = true;
  showStatus('Validando a sessão no Link Builder...', 'loading');
  try {
    const res = await fetch(
      `${apiUrl}/api/ml/affiliates/${encodeURIComponent(selectedUserId)}/validate-cookies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
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
      data.valid
        ? `✅ Sessão válida${data.melitat ? ` — etiqueta: ${data.melitat}` : ''}`
        : `❌ ${redactSensitiveText(data.error || 'Sessão inválida')}`,
      data.valid ? 'success' : 'error',
    );
  } catch (error) {
    showStatus(`Erro ao validar: ${redactSensitiveText(error.message)}`, 'error');
  } finally {
    $('validateBtn').disabled = false;
    setActionState();
  }
}

function renderSessionState(state) {
  const el = $('sessionState');
  if (!state?.status) {
    el.textContent = 'Sessão ainda não validada';
    el.className = 'session-state neutral';
    return;
  }
  const checkedAt = state.checkedAt ? new Date(state.checkedAt).toLocaleString('pt-BR') : '';
  el.textContent =
    state.status === 'valid'
      ? `🟢 Sessão válida${state.melitat ? ` · ${state.melitat}` : ''}${checkedAt ? ` · ${checkedAt}` : ''}`
      : `🔴 Sessão expirada${checkedAt ? ` · ${checkedAt}` : ''}`;
  el.className = `session-state ${state.status}`;
}

function showStatus(message, type) {
  $('status').textContent = redactSensitiveText(message);
  $('status').className = `status ${type}`;
}
