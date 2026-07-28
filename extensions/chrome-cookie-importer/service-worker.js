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
  await verifyAuthToken();
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
  const { sessionState, authState } = await chrome.storage.local.get(['sessionState', 'authState']);
  const parts = [];
  if (authState?.status === 'valid') parts.push('👤');
  if (sessionState?.status === 'valid') parts.push('OK');
  else if (sessionState?.status === 'expired') parts.push('!');

  const text = parts.join(' ').trim();
  chrome.action.setBadgeText({ text });
  if (!text) return;

  const hasExpired = sessionState?.status === 'expired';
  chrome.action.setBadgeBackgroundColor({
    color:
      !authState || authState.status !== 'valid' ? '#dc2626' : hasExpired ? '#dc2626' : '#059669',
  });
}

/** Verifica o JWT atual contra /api/auth/me e persiste o authState. */
async function verifyAuthToken() {
  const { apiUrl, authToken } = await chrome.storage.local.get(['apiUrl', 'authToken']);
  if (!apiUrl || !authToken) {
    await chrome.storage.local.set({ authState: { status: 'missing' } });
    await updateBadge();
    return { valid: false };
  }

  try {
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.user) {
      const authState = {
        status: 'valid',
        userId: data.user.id,
        email: data.user.email,
        name: data.user.name,
        checkedAt: new Date().toISOString(),
      };
      await chrome.storage.local.set({ authState });
      await updateBadge();
      return { valid: true, user: data.user };
    }
    await chrome.storage.local.set({
      authState: { status: 'expired', checkedAt: new Date().toISOString() },
    });
    await updateBadge();
    return { valid: false };
  } catch {
    await chrome.storage.local.set({
      authState: { status: 'error', checkedAt: new Date().toISOString() },
    });
    await updateBadge();
    return { valid: false };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'set-auth-token') {
    const token = message.token;
    const isValid = typeof token === 'string' && token.length > 0;
    chrome.storage.local
      .set({
        authToken: isValid ? token : '',
        authState: { status: isValid ? 'pending' : 'missing' },
      })
      .then(() => (isValid ? verifyAuthToken() : updateBadge()))
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message?.type === 'get-auth-token') {
    chrome.storage.local
      .get('authToken')
      .then(({ authToken }) => sendResponse({ token: authToken || '' }));
    return true;
  }

  if (message?.type === 'check-auth') {
    verifyAuthToken().then((result) => sendResponse(result));
    return true;
  }

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
verifyAuthToken();
