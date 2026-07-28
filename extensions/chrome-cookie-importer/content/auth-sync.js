/**
 * Content script — Sincronização de login com o painel O Mestre Afiliado.
 *
 * O web app guarda o JWT em `localStorage['omestre_auth_token']` no origin do
 * painel (ex: dev.omestreafiliado.com.br). A extensão precisa desse token para
 * autenticar as chamadas à API. Como o `localStorage` da extensão é isolado do
 * do site, este script (que roda no contexto do painel) lê o token e o
 * encaminha ao service worker via `chrome.runtime.sendMessage`.
 *
 * Só dispara quando há um token válido (string não vazia) — nunca envia
 * segredos a não ser o próprio JWT, e o SW não o loga.
 *
 * Logger: lib/log.js (carregado antes deste script pelo manifest).
 */
(function () {
  'use strict';

  if (globalThis.extLog?.info) {
    globalThis.extLog.info('auth-sync.script-loaded', {
      origin: location.origin,
      href: location.href,
      hasExtLog: Boolean(globalThis.extLog),
      hasExtLogSink: Boolean(globalThis.extLogSink),
    });
  }

  const STORAGE_KEY = 'omestre_auth_token';
  const log = globalThis.extLog;

  function readToken() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw && typeof raw === 'string' && raw.length > 0 ? raw : null;
    } catch (err) {
      log.warn('auth-sync.localStorage.error', { error: String(err) });
      return null;
    }
  }

  // Sincroniza o token com o SW. Retorna true se mudou (para log).
  let lastSentToken = null;
  function syncToken(reason) {
    const token = readToken();
    if (token === lastSentToken) return false;
    lastSentToken = token;
    if (!token) {
      log.info('auth-sync.token.absent', { reason });
      // Avisa o SW para limpar o estado (não envia token vazio).
      chrome.runtime
        .sendMessage({ type: 'set-auth-token', token: '' })
        .then((response) =>
          log.info('auth-sync.message.ack', {
            ok: Boolean(response?.success),
            reason,
            cleared: true,
          }),
        )
        .catch((err) => log.error('auth-sync.message.failed', { error: String(err), reason }));
      return true;
    }
    log.info('auth-sync.token.found', { length: token.length, reason });
    chrome.runtime
      .sendMessage({ type: 'set-auth-token', token })
      .then((response) =>
        log.info('auth-sync.message.ack', {
          ok: Boolean(response?.success),
          reason,
        }),
      )
      .catch((err) => log.error('auth-sync.message.failed', { error: String(err), reason }));
    return true;
  }

  log.info('auth-sync.loaded', { origin: location.origin, href: location.href });

  // Sync inicial
  syncToken('initial');

  // 1. Storage event — dispara quando OUTRA aba do mesmo origin muda o
  //    localStorage (ex: aba do painel faz logout, aba atual detecta).
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) syncToken('storage-event');
  });

  // 2. Custom event — o web app pode disparar apos login/logout.
  //    Ex: window.dispatchEvent(new CustomEvent('omestre:auth-changed'))
  window.addEventListener('omestre:auth-changed', () => {
    syncToken('custom-event');
  });

  // 3. Polling fallback — em SPAs o localStorage pode mudar via
  //    setItem sem disparar storage event na mesma aba.
  let pollingTimer = null;
  function startPolling() {
    if (pollingTimer) return;
    pollingTimer = setInterval(() => syncToken('poll'), 10000);
  }
  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }
  startPolling();
  // Para polling quando a aba sai de foco (economia)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });
})();
