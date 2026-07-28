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

  log.info('auth-sync.loaded', { origin: location.origin, href: location.href });

  const token = readToken();
  if (!token) {
    log.warn('auth-sync.token.absent', { key: STORAGE_KEY });
    return;
  }

  log.info('auth-sync.token.found', { length: token.length });

  chrome.runtime
    .sendMessage({ type: 'set-auth-token', token })
    .then((response) => {
      log.info('auth-sync.message.ack', { ok: Boolean(response?.success) });
    })
    .catch((err) => {
      log.error('auth-sync.message.failed', { error: String(err) });
    });
})();
