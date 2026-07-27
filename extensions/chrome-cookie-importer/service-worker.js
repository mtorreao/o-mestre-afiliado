const DEFAULT_API_URL = 'https://dev.omestreafiliado.com.br';

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get('apiUrl');
  if (!saved.apiUrl) await chrome.storage.local.set({ apiUrl: DEFAULT_API_URL });
});
