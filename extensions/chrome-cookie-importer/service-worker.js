// MV3 service workers suportam importScripts para carregar scripts clássicos
// do mesmo diretório. Carrega o logger antes do código principal.
// Ordem: log-sink.config.js (gerado pelo build) → log.js → log-sink.js
importScripts('lib/log-sink.config.js');
importScripts('lib/log.js');
importScripts('lib/log-sink-pure.js');
importScripts('lib/log-sink.js');

// DIAGNOSTICO 1.6.7-UNIQUE-TOKEN-XXX: log no top-level do SW.
// Se voce nao ve este evento exato no DB, o SW NAO foi reiniciado.
try {
  globalThis.extLog?.info?.('sw.boot.unique.token.v1.6.7', {
    swVersion: chrome.runtime.getManifest().version,
    hasApiKey: Boolean(globalThis.__EXT_LOGS_API_KEY__),
    sinkLoaded: Boolean(globalThis.extLogSink),
  });
} catch (e) {
  globalThis.console?.error?.('[OMA-SW] bootstrap failed:', e);
}

const DEFAULT_API_URL = 'https://dev.omestreafiliado.com.br';
const SESSION_ALARM = 'session-health-reminder';
const SW_VERSION = chrome.runtime.getManifest().version;
const HAS_API_KEY = Boolean(globalThis.__EXT_LOGS_API_KEY__);

const log = globalThis.extLog;
const sink = globalThis.extLogSink;

// Sincroniza apiUrl com default ANTES de qualquer listener. Garante que
// verifyAuthToken() no boot ja encontre a URL mesmo em instalacao fresca.
// chrome.storage.local.get com callback API — sync, nao bloqueia top-level,
// mas garante que `apiUrl` esteja setado antes do `verifyAuthToken()` rodar.
chrome.storage.local.get(['apiUrl'], (saved) => {
  if (!saved.apiUrl) {
    chrome.storage.local.set({ apiUrl: DEFAULT_API_URL });
    log.info('sw.top-level.apiUrl.default-set', { apiUrl: DEFAULT_API_URL });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(['apiUrl', 'sessionReminderEnabled']);
  if (!saved.apiUrl) await chrome.storage.local.set({ apiUrl: DEFAULT_API_URL });
  if (saved.sessionReminderEnabled !== false) {
    await chrome.alarms.create(SESSION_ALARM, { periodInMinutes: 60 });
  }
  log.info('service-worker.installed', { apiUrl: saved.apiUrl || DEFAULT_API_URL });
});

chrome.runtime.onStartup.addListener(async () => {
  const saved = await chrome.storage.local.get('sessionReminderEnabled');
  if (saved.sessionReminderEnabled !== false) {
    await chrome.alarms.create(SESSION_ALARM, { periodInMinutes: 60 });
  }
  log.info('service-worker.startup');
  await updateBadge();
  await verifyAuthToken();
});

/** Persiste o userEmail do authState no storage pro log-sink usar. */
async function syncAuthEmailForSink() {
  const { authState } = await chrome.storage.local.get('authState');
  const email = authState?.status === 'valid' ? authState.email : null;
  await chrome.storage.local.set({ logsUploadUserEmail: email || null });
}

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

// ─── Popup opened ─────────────────────────────────────────────────────
// Quando o popup abre, ele conecta via chrome.runtime.connect({ name: 'popup' }).
// Aproveitamos pra disparar verifyAuthToken() imediato — sem esperar
// o content script polling (que é de 30s). O polling continua
// importante pra detectar login/logout em outras abas quando o
// popup NÃO está aberto.
//
// O port fica aberto enquanto o popup existir; quando o popup fecha,
// o SW recebe onDisconnect e limpa.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return;
  log.info('popup.opened', { sender: port.sender?.tab?.id || 'unknown' });

  // Dispara verify imediatamente (não bloqueia o port).
  verifyAuthToken().catch((err) => log.error('popup.opened.verify.failed', { error: String(err) }));

  port.onMessage.addListener((msg) => {
    // Mensagens futuras — popup pode pedir algo. Por ora no-op.
    if (msg?.type === 'ping') {
      port.postMessage({ type: 'pong', at: Date.now() });
    }
  });

  port.onDisconnect.addListener(() => {
    log.debug('popup.closed');
  });
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

  if (!apiUrl) {
    log.warn('verify-auth.apiUrl.missing');
    await chrome.storage.local.set({ authState: { status: 'missing', reason: 'no-api-url' } });
    await updateBadge();
    return { valid: false };
  }
  if (!authToken) {
    log.warn('verify-auth.token.missing', { apiUrl });
    await chrome.storage.local.set({ authState: { status: 'missing', reason: 'no-auth-token' } });
    await updateBadge();
    return { valid: false };
  }

  const url = `${apiUrl}/api/auth/me`;
  log.info('verify-auth.fetch.start', { url, tokenLength: authToken.length });

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    log.info('verify-auth.fetch.response', { status: res.status, ok: res.ok });
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
      await syncAuthEmailForSink();
      await updateBadge();
      log.info('verify-auth.success', { userId: authState.userId, email: authState.email });
      return { valid: true, user: data.user };
    }
    log.warn('verify-auth.invalid', { status: res.status, data });
    await chrome.storage.local.set({
      authState: { status: 'expired', checkedAt: new Date().toISOString() },
    });
    await updateBadge();
    return { valid: false };
  } catch (err) {
    log.error('verify-auth.network.error', { error: String(err), url });
    await chrome.storage.local.set({
      authState: { status: 'error', checkedAt: new Date().toISOString() },
    });
    await updateBadge();
    return { valid: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'get-auth-state') {
    globalThis.extLog?.info?.('message.get-auth-state.received', {
      senderTabId: sender?.tab?.id,
      senderUrl: sender?.tab?.url,
    });
    chrome.storage.local
      .get(['authToken', 'authState'])
      .then((data) =>
        sendResponse({ authToken: data.authToken || '', authState: data.authState || null }),
      )
      .catch((err) => sendResponse({ authToken: '', authState: null }));
    return true;
  }
  if (message?.type === 'set-auth-token') {
    const token = message.token;
    const isValid = typeof token === 'string' && token.length > 0;
    log.info('message.set-auth-token.received', {
      hasToken: isValid,
      tokenLength: isValid ? token.length : 0,
      tabUrl: sender?.tab?.url,
      tabId: sender?.tab?.id,
    });
    chrome.storage.local
      .set({
        authToken: isValid ? token : '',
        authState: { status: isValid ? 'pending' : 'missing' },
      })
      .then(() => (isValid ? verifyAuthToken() : updateBadge()))
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        log.error('message.set-auth-token.storage.error', { error: String(err) });
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }

  if (message?.type === 'get-auth-token') {
    chrome.storage.local
      .get('authToken')
      .then(({ authToken }) => sendResponse({ token: authToken || '' }));
    return true;
  }

  if (message?.type === 'check-auth') {
    log.info('message.check-auth.received');
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

  if (message?.type === 'flush-logs-now') {
    log.info('message.flush-logs-now.received');
    sink
      .flushNow()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message?.type === 'get-logs-status') {
    chrome.storage.local.get(
      [
        'logsUploadEnabled',
        'logsUploadLastSentAt',
        'logsUploadLastError',
        'logsUploadBuffer',
        'logsUploadLastBatchSize',
      ],
      (saved) => {
        sendResponse({
          enabled: saved.logsUploadEnabled === true,
          lastSentAt: saved.logsUploadLastSentAt || null,
          lastError: saved.logsUploadLastError || null,
          bufferSize: Array.isArray(saved.logsUploadBuffer) ? saved.logsUploadBuffer.length : 0,
          lastBatchSize: saved.logsUploadLastBatchSize || null,
        });
      },
    );
    return true;
  }

  return false;
});

log.info('service-worker.boot', {
  version: SW_VERSION,
  hasApiKey: HAS_API_KEY,
  manifestVersion: chrome.runtime.getManifest().version,
});
sink.init().catch(() => {});
updateBadge();
verifyAuthToken();
