/**
 * Content script — Sincronização de login com o painel O Mestre Afiliado.
 *
 * O web app guarda o JWT em `localStorage['omestre_auth_token']` no origin do
 * painel (ex: dev.omestreafiliado.com.br). A extensão precisa desse token para
 * autenticar o `POST /api/extension/offers/create`. Como o `localStorage` da
 * extensão é isolado do do site, este script (que roda no contexto do painel)
 * lê o token e o encaminha ao service worker via `chrome.runtime.sendMessage`.
 *
 * Só dispara quando há um token válido (string não vazia) — nunca envia
 * segredos a não ser o próprio JWT, e o SW não o loga.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'omestre_auth_token';

  function readToken() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw && typeof raw === 'string' && raw.length > 0 ? raw : null;
    } catch {
      return null;
    }
  }

  const token = readToken();
  if (token) {
    chrome.runtime.sendMessage({ type: 'set-auth-token', token }).catch(() => {
      /* SW pode estar indisponível momentaneamente; ignora */
    });
  }
})();
