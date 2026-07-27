import { DEFAULT_API_URL, normalizeApiUrl, redactSensitiveText } from './lib/pure.js';

const $ = (id) => document.getElementById(id);

async function loadOptions() {
  const saved = await chrome.storage.local.get(['apiUrl', 'sessionReminderEnabled']);
  $('apiUrl').value = saved.apiUrl || DEFAULT_API_URL;
  $('sessionReminderEnabled').checked = saved.sessionReminderEnabled !== false;
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

  await chrome.storage.local.set({
    apiUrl,
    sessionReminderEnabled: $('sessionReminderEnabled').checked,
  });
  showStatus('Configurações salvas.', 'success');
}

function showStatus(message, type) {
  $('status').textContent = redactSensitiveText(message);
  $('status').className = `status ${type}`;
}
