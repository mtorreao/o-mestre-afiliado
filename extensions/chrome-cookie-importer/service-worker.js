const DEFAULT_API_URL = 'https://dev.omestreafiliado.com.br';
const SESSION_ALARM = 'session-health-reminder';
const MAX_LOG_ENTRIES = 50;

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(['apiUrl', 'sessionReminderEnabled']);
  if (!saved.apiUrl) await chrome.storage.local.set({ apiUrl: DEFAULT_API_URL });
  if (saved.sessionReminderEnabled !== false) {
    await chrome.alarms.create(SESSION_ALARM, { periodInMinutes: 60 });
  }
  chrome.contextMenus.create({
    id: 'create-offer-link',
    title: 'Criar oferta com O Mestre Afiliado',
    contexts: ['link'],
  });
});

chrome.runtime.onStartup.addListener(async () => {
  const saved = await chrome.storage.local.get('sessionReminderEnabled');
  if (saved.sessionReminderEnabled !== false) {
    await chrome.alarms.create(SESSION_ALARM, { periodInMinutes: 60 });
  }
  await updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SESSION_ALARM) return;
  const state = await chrome.storage.local.get('sessionState');
  if (state.sessionState?.status === 'expired') {
    await chrome.notifications.create('session-expired', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Sessão do Mercado Livre expirada',
      message: 'Abra a extensão para reimportar e validar os cookies.',
    });
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'create-offer-link' && info.linkUrl) {
    await chrome.storage.local.set({
      productData: { url: info.linkUrl, marketplace: 'unknown', name: '', price: '', imageUrl: '' },
      productDataAt: Date.now(),
      productFromContextMenu: true,
    });
    chrome.action.openPopup();
  }
});

async function updateBadge() {
  const { sessionState } = await chrome.storage.local.get('sessionState');
  if (!sessionState?.status) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  chrome.action.setBadgeText({ text: sessionState.status === 'valid' ? 'OK' : '!' });
  chrome.action.setBadgeBackgroundColor({
    color: sessionState.status === 'valid' ? '#059669' : '#dc2626',
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'set-session-state') {
    chrome.storage.local.set({ sessionState: message.state }).then(() => {
      updateBadge();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message?.type === 'product-data') {
    chrome.storage.local
      .set({ productData: message.data, productDataAt: Date.now() })
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message?.type === 'add-offer-log') {
    addOfferLog(message.entry).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message?.type === 'get-offer-log') {
    getOfferLog().then((log) => sendResponse({ log }));
    return true;
  }

  if (message?.type === 'clear-offer-log') {
    chrome.storage.local.set({ offerLog: [] }).then(() => sendResponse({ success: true }));
    return true;
  }

  return false;
});

async function addOfferLog(entry) {
  const { offerLog = [] } = await chrome.storage.local.get('offerLog');
  offerLog.unshift({
    ...entry,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    sentAt: new Date().toISOString(),
  });
  if (offerLog.length > MAX_LOG_ENTRIES) offerLog.length = MAX_LOG_ENTRIES;
  await chrome.storage.local.set({ offerLog });
}

async function getOfferLog() {
  const { offerLog = [] } = await chrome.storage.local.get('offerLog');
  return offerLog;
}

updateBadge();
