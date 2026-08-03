/**
 * Helpers para requisicoes HTTP autenticadas (JWT Bearer no header
 * Authorization). Usado por specs que chamam rotas da API em nome de
 * um usuario (criado via createTestUser).
 */

import { API_BASE } from './api-base.ts';

/**
 * Faz uma requisição GET autenticada.
 */
export async function authGet<TBody extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  token: string,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as TBody };
}

/**
 * Faz uma requisição POST autenticada.
 */
export async function authPost<TBody extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  token: string,
  body: Record<string, unknown>,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as TBody };
}

/**
 * Faz uma requisição PUT autenticada.
 */
export async function authPut<TBody extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  token: string,
  body: Record<string, unknown>,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as TBody };
}

/**
 * Faz uma requisição PATCH autenticada.
 */
export async function authPatch<TBody extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  token: string,
  body: Record<string, unknown>,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as TBody };
}

/**
 * Faz uma requisição DELETE autenticada.
 */
export async function authDelete<TBody extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  token: string,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as TBody };
}
