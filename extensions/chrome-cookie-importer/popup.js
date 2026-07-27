import {
  DEFAULT_API_URL,
  MAGALU_DOMAINS,
  MAGALU_ONELINK_API,
  ML_DOMAINS,
  cookieMetadata,
  deduplicateCookies,
  isMercadoLivreUrl,
  normalizeApiUrl,
  redactSensitiveText,
  serializeCookies,
} from './lib/pure.js';

const $ = (id) => document.getElementById(id);
const PRODUCT_DATA_TTL = 10 * 60 * 1000; // 10 min

let affiliates = [];
let selectedUserId = null;
let productData = null;
let availableGroups = [];
let selectedGroups = new Set();
let mirrorMap = new Map(); // jid → mirror name

void init();

async function init() {
  const saved = await chrome.storage.local.get([
    'apiUrl',
    'sessionState',
    'productData',
    'productDataAt',
    'offerLog',
  ]);
  $('apiUrl').value = saved.apiUrl || DEFAULT_API_URL;
  productData = getValidProductData(saved.productData, saved.productDataAt);

  if (productData) {
    const isFromMenu = await chrome.storage.local.get('productFromContextMenu');
    if (isFromMenu.productFromContextMenu) {
      await chrome.storage.local.remove('productFromContextMenu');
    }
  }

  await updateMLStatus();
  await loadAffiliates(saved.sessionState);
  renderSessionState(saved.sessionState);

  setupTabs();
  setupEvents();

  if (productData) {
    fillOfferForm();
    updatePreview();
    await loadGroups();
  }
}

function getValidProductData(data, timestamp) {
  if (!data || !timestamp) return null;
  if (Date.now() - timestamp > PRODUCT_DATA_TTL) return null;
  return data;
}

async function updateMLStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isML = Boolean(tab?.url && isMercadoLivreUrl(tab.url));
  const isShopee = Boolean(tab?.url?.includes('shopee'));
  const isAmazon = Boolean(tab?.url?.includes('amazon'));
  const hasProduct = isML || isShopee || isAmazon || productData;
  $('mlStatus').textContent = productData
    ? `🟢 Produto detectado`
    : hasProduct
      ? '🟡 Abra um produto'
      : '🔴 Abra um marketplace';
}

async function loadGroups() {
  const apiUrl = normalizeApiUrl($('apiUrl').value);
  if (!apiUrl || !selectedUserId) {
    $('groupList').innerHTML = '<span style="color:#64748b">Selecione um afiliado primeiro.</span>';
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/api/mirrors?status=active&pageSize=50`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) {
      $('groupList').innerHTML = '<span style="color:#f87171">Erro ao carregar grupos.</span>';
      return;
    }

    const mirrors = data.rows || [];
    const groups = [];
    mirrorMap = new Map();

    for (const m of mirrors) {
      const targets = m.targetGroups || [];
      for (const g of targets) {
        groups.push(g);
        mirrorMap.set(g.jid, m.name);
      }
    }

    if (!groups.length) {
      $('groupList').innerHTML =
        '<span style="color:#94a3b8">Nenhum grupo de destino configurado.</span>';
      availableGroups = [];
      return;
    }

    availableGroups = deduplicateGroups(groups);
    selectedGroups = new Set(availableGroups.map((g) => g.jid));
    renderGroupList();
  } catch {
    $('groupList').innerHTML = '<span style="color:#f87171">Erro de conexão.</span>';
  }
}

function authHeaders() {
  return { 'Content-Type': 'application/json' };
}

function deduplicateGroups(groups) {
  const seen = new Set();
  return groups.filter((g) => {
    if (seen.has(g.jid)) return false;
    seen.add(g.jid);
    return true;
  });
}

function renderGroupList() {
  const el = $('groupList');
  el.innerHTML = '';
  if (!availableGroups.length) {
    el.innerHTML = '<span style="color:#94a3b8">Nenhum grupo disponível.</span>';
    return;
  }
  let html = '';
  for (const g of availableGroups) {
    mirrorMap.get(g.jid);
    html += `<div class="group-item"><input type="checkbox" data-jid="${g.jid}" ${selectedGroups.has(g.jid) ? 'checked' : ''}> ${g.name}</div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.dataset.jid) {
        if (cb.checked) selectedGroups.add(cb.dataset.jid);
        else selectedGroups.delete(cb.dataset.jid);
        $('groupCount').textContent = selectedGroups.size;
      }
    });
  });
  $('groupCount').textContent = selectedGroups.size;
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
      if (tab.dataset.tab === 'log') renderLog();
    });
  });
}

function setupEvents() {
  $('importBtn').addEventListener('click', importCookies);
  $('validateBtn').addEventListener('click', validateSession);
  $('magaluTestBtn').addEventListener('click', testMagaluOneLink);
  $('magaluSyncBtn').addEventListener('click', syncMagaluCookies);
  $('sendOfferBtn').addEventListener('click', sendOffer);
  $('clearLogBtn').addEventListener('click', clearLog);
  $('selectAllGroups').addEventListener('change', () => {
    if ($('selectAllGroups').checked) {
      selectedGroups = new Set(availableGroups.map((g) => g.jid));
    } else {
      selectedGroups = new Set();
    }
    document.querySelectorAll('.group-item input[type=checkbox]').forEach((cb) => {
      cb.checked = $('selectAllGroups').checked;
    });
    $('groupCount').textContent = selectedGroups.size;
  });
  $('optionsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  ['offerTitle', 'offerProductName', 'offerCoupon', 'offerPriceFrom', 'offerPrice'].forEach(
    (id) => {
      $(id).addEventListener('input', updatePreview);
    },
  );
}

function fillOfferForm() {
  if (!productData) return;
  $('offerUrl').value = productData.url || '';
  $('offerProductName').value = productData.name || '';
  if (productData.price) $('offerPrice').value = `R$ ${productData.price}`;
}

function updatePreview() {
  const title = $('offerTitle').value.trim();
  const name = $('offerProductName').value.trim();
  const coupon = $('offerCoupon').value.trim();
  const priceFrom = $('offerPriceFrom').value.trim();
  const priceTo = $('offerPrice').value.trim();

  const lines = [];
  if (title) lines.push(`🔥 *${title}*`);
  if (lines.length > 0 && (name || priceFrom || priceTo || coupon)) lines.push('');
  if (name) lines.push(`📦 *${name}*`);
  if (priceFrom) lines.push(`~~ De: ${priceFrom} ~~`);
  if (priceTo) lines.push(`🔥 Por: *${priceTo}*`);
  if (coupon) lines.push(`🏷️ Cupom: *${coupon}*`);
  if (lines.length > 0) lines.push('');
  lines.push(`🔗 {link_afiliado}`);

  $('offerPreview').value = lines.join('\n');
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
  $('sendOfferBtn').disabled = !has || !productData || !selectedGroups.size;
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

async function sendOffer() {
  if (!selectedUserId || !productData) return;
  const apiUrl = normalizeApiUrl($('apiUrl').value);
  if (!apiUrl) return showStatus('offerStatus', 'URL da API inválida', 'error');
  if (!selectedGroups.size)
    return showStatus('offerStatus', 'Selecione ao menos um grupo.', 'error');

  $('sendOfferBtn').disabled = true;
  showStatus('offerStatus', 'Enviando oferta...', 'loading');

  try {
    const res = await fetch(`${apiUrl}/api/extension/offers/create`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        url: productData.url,
        marketplace: productData.marketplace,
        title: $('offerTitle').value.trim() || undefined,
        productName: $('offerProductName').value.trim(),
        coupon: $('offerCoupon').value.trim() || undefined,
        priceFrom: $('offerPriceFrom').value.trim() || undefined,
        priceTo: $('offerPrice').value.trim() || undefined,
        imageUrl: $('offerWithImage').checked ? productData.imageUrl || undefined : undefined,
        targetGroupJids: [...selectedGroups],
      }),
    });

    const data = await res.json();
    if (data.success) {
      const totalSent = data.sentTo?.length || 0;
      showStatus('offerStatus', `✅ Enviado para ${totalSent} grupo(s)!`, 'success');

      const entry = {
        marketplace: productData.marketplace,
        productName: $('offerProductName').value.trim(),
        sentTo: data.sentTo,
        totalSent,
        status: 'sent',
      };
      await chrome.runtime.sendMessage({ type: 'add-offer-log', entry });
    } else {
      showStatus('offerStatus', `❌ ${data.error || 'Erro'}`, 'error');
    }
  } catch (err) {
    showStatus('offerStatus', `❌ ${err.message}`, 'error');
  } finally {
    $('sendOfferBtn').disabled = false;
    setActionState();
  }
}

async function renderLog() {
  const res = await chrome.runtime.sendMessage({ type: 'get-offer-log' });
  const log = res?.log || [];
  const el = $('logList');
  if (!log.length) {
    el.innerHTML =
      '<span style="color:#64748b;font-size:12px">Nenhuma oferta enviada ainda.</span>';
    return;
  }

  el.innerHTML = log
    .map((entry) => {
      const time = entry.sentAt ? new Date(entry.sentAt).toLocaleString('pt-BR') : '';
      const groups = entry.sentTo?.map((g) => g.groupName || g.groupJid).join(', ') || '—';
      return `<div class="log-entry">
      <div class="time">${time}</div>
      <div><span class="status-badge ${entry.status}">${entry.status === 'sent' ? '✅ Enviado' : '❌ Erro'}</span>
      <span style="color:#e2e8f0">${entry.productName || entry.marketplace || ''}</span></div>
      <div style="color:#94a3b8;font-size:10px">${groups}</div>
    </div>`;
    })
    .join('');
}

async function clearLog() {
  await chrome.runtime.sendMessage({ type: 'clear-offer-log' });
  renderLog();
}

// ─── Magalu (Magazine Você) ─────────────────────────────────────────────────

/**
 * Testa a geração de OneLink usando a sessão ativa do navegador.
 * A extensão tem host_permission para magazinevoce.com.br, então o fetch
 * envia os cookies da sessão automaticamente (incluindo HttpOnly).
 */
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
