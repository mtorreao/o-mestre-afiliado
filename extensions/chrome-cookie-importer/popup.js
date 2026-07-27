// popup.js — Lógica da extensão Cookie Importer (ML + Magalu)
//
// ML:     cookies de .mercadolivre.com.br → ml_affiliates.sessionCookies
// Magalu: cookies de .magazinevoce.com.br → magalu_affiliates.sessionCookies

const MARKETPLACES = {
  ml: {
    domains: ['.mercadolivre.com.br', '.mercadolibre.com', '.mercadolivre.com'],
    listEndpoint: '/api/ml/affiliates',
    saveEndpoint: (id) => `/api/ml/affiliates/${id}`,
    statusLabel: '🟢 ML',
    detectTag: true,
  },
  magalu: {
    domains: ['.magazinevoce.com.br'],
    listEndpoint: '/api/magalu/affiliate',
    saveEndpoint: (id) => `/api/magalu/affiliate`,
    statusLabel: '🟢 Magalu',
    detectTag: false,
  },
};

const $ = (id) => document.getElementById(id);

let affiliates = [];
let selectedAffiliateId = null;
let currentMp = 'ml'; // 'ml' | 'magalu'

// ─── Init ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const saved = await chrome.storage.local.get('apiUrl');
  if (saved.apiUrl) $('apiUrl').value = saved.apiUrl;

  // Marketplace toggle
  $('mpMl').addEventListener('click', () => switchMarketplace('ml'));
  $('mpMagalu').addEventListener('click', () => switchMarketplace('magalu'));

  await switchMarketplace('ml');

  $('apiUrl').addEventListener('change', saveApiUrl);
  $('affiliateSelect').addEventListener('change', onAffiliateChange);
  $('importBtn').addEventListener('click', importCookies);
});

// ─── Marketplace switch ─────────────────────────────────────────────────────

async function switchMarketplace(mp) {
  currentMp = mp;

  // Update UI
  $('mpMl').classList.toggle('active', mp === 'ml');
  $('mpMagalu').classList.toggle('active', mp === 'magalu');
  $('subtitle').textContent =
    mp === 'ml' ? 'Importar cookies do Mercado Livre' : 'Importar cookies do Magazine Você';

  await checkCurrentTab();
  await loadAffiliates();
}

// ─── Check current tab ──────────────────────────────────────────────────────

async function checkCurrentTab() {
  const config = MARKETPLACES[currentMp];
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const detected = config.domains.some((d) => tab.url.includes(d));
  $('marketplaceStatus').textContent = detected
    ? config.statusLabel
    : `🔴 ${currentMp === 'ml' ? 'ML' : 'Magalu'}`;
  $('marketplaceStatus').style.color = detected ? '#4ade80' : '#f87171';
}

// ─── Load affiliates ────────────────────────────────────────────────────────

async function loadAffiliates() {
  const apiUrl = $('apiUrl').value.replace(/\/+$/, '');
  const sel = $('affiliateSelect');
  const btn = $('importBtn');
  const config = MARKETPLACES[currentMp];

  try {
    let res;
    if (currentMp === 'ml') {
      res = await fetch(`${apiUrl}${config.listEndpoint}`);
      const data = await res.json();
      if (!data.success || !data.affiliates?.length) {
        sel.innerHTML = '<option value="">Nenhum afiliado encontrado</option>';
        btn.disabled = true;
        return;
      }
      affiliates = data.affiliates;
      sel.innerHTML = '<option value="">— Selecione um afiliado —</option>';
      affiliates.forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.mlUserId;
        const hasCookies = a.hasSessionCookies ? ' 🔗' : '';
        opt.textContent = `${a.nickname} (ID: ${a.mlUserId})${hasCookies}`;
        sel.appendChild(opt);
      });
    } else {
      // Magalu: GET /api/magalu/affiliate retorna dados do afiliado logado
      const token = ''; // sem token por enquanto — endpoint aberto ou autentica via cookie?
      res = await fetch(`${apiUrl}${config.listEndpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success && data.affiliate) {
        const a = data.affiliate;
        affiliates = [
          {
            id: a.id,
            nickname: a.nickname || 'Minha loja',
            storeSlug: a.storeSlug,
            hasSessionCookies: !!a.sessionCookies,
          },
        ];
        sel.innerHTML = '<option value="">— Selecione um afiliado —</option>';
        affiliates.forEach((aff) => {
          const opt = document.createElement('option');
          opt.value = aff.id;
          const hasC = aff.hasSessionCookies ? ' 🔗' : '';
          opt.textContent = `${aff.nickname} (${aff.storeSlug})${hasC}`;
          sel.appendChild(opt);
        });
      } else {
        sel.innerHTML = '<option value="">Nenhum afiliado encontrado</option>';
        btn.disabled = true;
      }
    }

    btn.disabled = true;
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao conectar com a API</option>';
    showStatus(`Erro de conexão: ${err.message}`, 'error');
  }
}

// ─── Events ─────────────────────────────────────────────────────────────────

function saveApiUrl() {
  chrome.storage.local.set({ apiUrl: $('apiUrl').value });
}

function onAffiliateChange() {
  selectedAffiliateId = $('affiliateSelect').value;
  $('importBtn').disabled = !selectedAffiliateId;
}

// ─── Import cookies ────────────────────────────────────────────────────────

async function importCookies() {
  if (!selectedAffiliateId) return;

  const apiUrl = $('apiUrl').value.replace(/\/+$/, '');
  const btn = $('importBtn');
  const config = MARKETPLACES[currentMp];

  btn.disabled = true;
  showStatus(
    `Lendo cookies do ${currentMp === 'ml' ? 'Mercado Livre' : 'Magazine Você'}...`,
    'loading',
  );

  try {
    // 1. Read ALL cookies from the marketplace domains
    const allCookies = [];
    for (const domain of config.domains) {
      const cookies = await chrome.cookies.getAll({ domain });
      allCookies.push(...cookies);
    }

    // Deduplicate by name+path
    const seen = new Map();
    for (const c of allCookies) {
      const key = `${c.name}:${c.path}`;
      seen.set(key, c);
    }
    const uniqueCookies = [...seen.values()];

    if (uniqueCookies.length === 0) {
      showStatus(
        `Nenhum cookie encontrado. Você está logado no ${currentMp === 'ml' ? 'ML' : 'Magazine Você'}?`,
        'error',
      );
      btn.disabled = false;
      return;
    }

    const cookieStr = uniqueCookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // Preview
    $('cookiePreview').textContent =
      `${uniqueCookies.length} cookies encontrados\n${cookieStr.substring(0, 200)}...`;
    $('cookiePreview').style.display = 'block';

    // 2. Send to API
    showStatus(`Enviando ${uniqueCookies.length} cookies...`, 'loading');

    let res;
    if (currentMp === 'ml') {
      res = await fetch(`${apiUrl}${config.saveEndpoint(selectedAffiliateId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCookies: cookieStr }),
      });
    } else {
      // Magalu: usa PUT /api/magalu/affiliate (aceita o token JWT do header)
      res = await fetch(`${apiUrl}${config.saveEndpoint()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCookies: cookieStr }),
      });
    }

    const data = await res.json();

    if (data.success) {
      if (currentMp === 'ml') {
        // Tentar detectar melitat
        showStatus('✅ Cookies salvos! Detectando etiqueta...', 'loading');
        try {
          const tag = await detectMelitat();
          if (tag) {
            await fetch(`${apiUrl}/api/ml/affiliates/${selectedAffiliateId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ melitat: tag }),
            });
            showStatus(`✅ Etiqueta "${tag}" detectada e salva!`, 'success');
          } else {
            showStatus('✅ Cookies importados! Etiqueta: configure manualmente.', 'success');
          }
        } catch {
          showStatus(`✅ Cookies importados!`, 'success');
        }
      } else {
        showStatus(`✅ Cookies do Magazine Você salvos! OneLink disponível.`, 'success');
      }

      // Update badge
      const aff = affiliates.find((a) =>
        currentMp === 'ml' ? a.mlUserId === selectedAffiliateId : a.id === selectedAffiliateId,
      );
      if (aff) aff.hasSessionCookies = true;
      updateSelectOptions();
    } else {
      showStatus(`❌ Erro do servidor: ${data.error}`, 'error');
    }
  } catch (err) {
    showStatus(`❌ Erro: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function showStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${type}`;
}

function updateSelectOptions() {
  const sel = $('affiliateSelect');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">— Selecione um afiliado —</option>';
  affiliates.forEach((a) => {
    const opt = document.createElement('option');
    if (currentMp === 'ml') {
      opt.value = a.mlUserId;
      const hasCookies = a.hasSessionCookies ? ' 🔗' : '';
      opt.textContent = `${a.nickname} (ID: ${a.mlUserId})${hasCookies}`;
    } else {
      opt.value = a.id;
      const hasC = a.hasSessionCookies ? ' 🔗' : '';
      opt.textContent = `${a.nickname} (${a.storeSlug})${hasC}`;
    }
    sel.appendChild(opt);
  });
  sel.value = currentVal;
}

/**
 * Extrai o melitat (ML-specific) da página do linkbuilder.
 */
async function detectMelitat() {
  const tabs = await chrome.tabs.query({
    url: ['*://*.mercadolivre.com.br/*', '*://*.mercadolibre.com/*'],
  });
  if (tabs.length === 0) return null;

  const tab = tabs[0];
  try {
    const targetUrl = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
    if (!tab.url?.includes('linkbuilder')) {
      await chrome.tabs.update(tab.id, { url: targetUrl });
      await new Promise((r) => setTimeout(r, 3000));
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const html = document.documentElement.innerHTML;
        const match = html.match(/tag_in_use["']:\s*["']([^"']+)/i);
        return match ? match[1] : null;
      },
    });

    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}
