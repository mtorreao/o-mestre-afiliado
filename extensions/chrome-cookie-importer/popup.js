// popup.js — Lógica da extensão Cookie Importer

const ML_DOMAINS = [
  '.mercadolivre.com.br',
  '.mercadolibre.com',
  '.mercadolivre.com',
];

const $ = (id) => document.getElementById(id);

let affiliates = [];
let selectedUserId = null;

// ─── Init ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Restore saved API URL
  const saved = await chrome.storage.local.get('apiUrl');
  if (saved.apiUrl) $('apiUrl').value = saved.apiUrl;

  // Check if we're on ML
  await checkMLTab();

  // Load affiliates
  await loadAffiliates();

  // Events
  $('apiUrl').addEventListener('change', saveApiUrl);
  $('affiliateSelect').addEventListener('change', onAffiliateChange);
  $('importBtn').addEventListener('click', importCookies);
});

// ─── Check ML tab ──────────────────────────────────────────────────────────

async function checkMLTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const isML = ML_DOMAINS.some((d) => tab.url.includes(d));
  $('mlStatus').textContent = isML ? '🟢 ML detectado' : '🔴 Abra o ML';
  $('mlStatus').style.color = isML ? '#4ade80' : '#f87171';
}

// ─── Load affiliates ────────────────────────────────────────────────────────

async function loadAffiliates() {
  const apiUrl = $('apiUrl').value.replace(/\/+$/, '');
  const sel = $('affiliateSelect');
  const btn = $('importBtn');

  try {
    const res = await fetch(`${apiUrl}/api/ml/affiliates`);
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
  selectedUserId = $('affiliateSelect').value;
  $('importBtn').disabled = !selectedUserId;
}

// ─── Import cookies ────────────────────────────────────────────────────────

async function importCookies() {
  if (!selectedUserId) return;

  const apiUrl = $('apiUrl').value.replace(/\/+$/, '');
  const btn = $('importBtn');
  const status = $('status');

  btn.disabled = true;
  showStatus('Lendo cookies do Mercado Livre...', 'loading');

  try {
    // 1. Read ALL cookies from ML domains (including HttpOnly)
    const allCookies = [];
    for (const domain of ML_DOMAINS) {
      const cookies = await chrome.cookies.getAll({ domain });
      allCookies.push(...cookies);
    }

    // Deduplicate by name+path (keep last occurrence)
    const seen = new Map();
    for (const c of allCookies) {
      const key = `${c.name}:${c.path}`;
      seen.set(key, c);
    }

    const uniqueCookies = [...seen.values()];

    if (uniqueCookies.length === 0) {
      showStatus('Nenhum cookie encontrado. Você está logado no ML?', 'error');
      btn.disabled = false;
      return;
    }

    // Build cookie string
    const cookieStr = uniqueCookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // Show preview (truncated)
    $('cookiePreview').textContent =
      `${uniqueCookies.length} cookies encontrados\n${cookieStr.substring(0, 200)}...`;
    $('cookiePreview').style.display = 'block';

    // 2. Send to API
    showStatus(`Enviando ${uniqueCookies.length} cookies para o servidor...`, 'loading');

    const res = await fetch(`${apiUrl}/api/ml/affiliates/${selectedUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCookies: cookieStr }),
    });

    const data = await res.json();

    if (data.success) {
      // Tentar extrair melitat diretamente da página do linkbuilder
      showStatus(`✅ Cookies salvos! Detectando etiqueta...`, 'loading');
      try {
        const tag = await detectMelitat();
        if (tag) {
          // Salvar melitat no servidor
          await fetch(`${apiUrl}/api/ml/affiliates/${selectedUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ melitat: tag }),
          });
          showStatus(`✅ Etiqueta "${tag}" detectada e salva!`, 'success');
        } else {
          showStatus(`✅ Cookies importados! Etiqueta: configure manualmente.`, 'success');
        }
      } catch {
        showStatus(`✅ Cookies importados para ${data.mlUserId}!`, 'success');
      }

      // Update the select option to show the 🔗 badge
      const affiliate = affiliates.find((a) => a.mlUserId === selectedUserId);
      if (affiliate) {
        affiliate.hasSessionCookies = true;
        updateSelectOptions();
      }
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
    opt.value = a.mlUserId;
    const hasCookies = a.hasSessionCookies ? ' 🔗' : '';
    opt.textContent = `${a.nickname} (ID: ${a.mlUserId})${hasCookies}`;
    sel.appendChild(opt);
  });
  sel.value = currentVal;
}

/**
 * Extrai o melitat (etiqueta de afiliado) da página do linkbuilder.
 * Usa uma tab ativa do ML pra executar um script que lê o tag_in_use.
 */
async function detectMelitat() {
  // Procura uma tab aberta do ML
  const tabs = await chrome.tabs.query({ url: ['*://*.mercadolivre.com.br/*', '*://*.mercadolibre.com/*'] });
  if (tabs.length === 0) return null;

  const tab = tabs[0];

  try {
    // Navega a tab pra página do linkbuilder (se já não estiver)
    const targetUrl = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
    if (!tab.url?.includes('linkbuilder')) {
      await chrome.tabs.update(tab.id, { url: targetUrl });
      // Espera a página carregar
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Executa script pra extrair o tag_in_use do HTML
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Procura no HTML o tag_in_use
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
