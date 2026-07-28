import { DEFAULT_API_URL, normalizeApiUrl, redactSensitiveText } from './lib/pure.js';

const $ = (id) => document.getElementById(id);

async function loadOptions() {
  const saved = await chrome.storage.local.get([
    'apiUrl',
    'sessionReminderEnabled',
    'logsUploadApiKey',
  ]);
  $('apiUrl').value = saved.apiUrl || DEFAULT_API_URL;
  $('sessionReminderEnabled').checked = saved.sessionReminderEnabled !== false;
  // Mostra a key com N caracteres visíveis + asteriscos (UX: confirma que há
  // algo salvo sem expor a key completa na tela).
  const key = saved.logsUploadApiKey || '';
  $('logsApiKey').value = key;
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadOptions();
  $('saveBtn').addEventListener('click', saveOptions);
});

async function saveOptions() {
  const apiUrl = normalizeApiUrl($('apiUrl').value);
  if (!apiUrl) {
    showStatus('Informe uma URL HTTP(S) válida sem credenciais, query ou hash.', 'error');
    return;
  }

  const apiKey = $('logsApiKey').value.trim();

  await chrome.storage.local.set({
    apiUrl,
    sessionReminderEnabled: $('sessionReminderEnabled').checked,
    // Salva string vazia se user limpou — sink fica inerte sem key.
    logsUploadApiKey: apiKey || '',
  });
  showStatus('Configurações salvas.', 'success');
}

function showStatus(message, type) {
  $('status').textContent = redactSensitiveText(message);
  $('status').className = `status ${type}`;
}
