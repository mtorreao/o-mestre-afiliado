/**
 * Verificação de JWT HS256 para webhooks da Evolution API.
 *
 * A Evolution API v2.3.7 assina webhooks com JWT HS256 quando o webhook
 * da instância tem `headers: { jwt_key: <secret> }`:
 *   - gera payload { iat, exp (10 min), app: 'evolution', action: 'webhook' }
 *   - assina com HMAC-SHA256 usando o secret (jwt_key)
 *   - envia `Authorization: Bearer <jwt>` em cada POST /webhook/message
 *
 * Este módulo é PURA (sem I/O de rede/DB): parsing + verificação de assinatura
 * via Web Crypto (nativo no Bun — zero dependência externa).
 */

export interface ParsedJwt {
  header: { alg?: string; typ?: string };
  payload: { iat?: number; exp?: number; app?: string; action?: string };
  signature: Uint8Array;
  /** "header.payload" — o que foi assinado (base64url sem o 3º segmento). */
  dataToSign: string;
}

/** Decodifica base64url para bytes (pad = `=`). */
export function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Decodifica base64url para string UTF-8. */
export function base64UrlToString(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

/** Faz parse de um JWT em 3 segmentos. Retorna null se malformado. */
export function parseJwt(token: string): ParsedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  try {
    const header = JSON.parse(base64UrlToString(headerB64)) as ParsedJwt['header'];
    const payload = JSON.parse(base64UrlToString(payloadB64)) as ParsedJwt['payload'];
    if (typeof header !== 'object' || header === null) return null;
    if (typeof payload !== 'object' || payload === null) return null;

    return {
      header,
      payload,
      signature: base64UrlToBytes(sigB64),
      dataToSign: `${headerB64}.${payloadB64}`,
    };
  } catch {
    return null;
  }
}

/**
 * Valida as claims do payload sem verificar assinatura.
 * - alg deve ser HS256 (evita downgrade pra 'none' ou outros)
 * - exp (epoch seconds) deve existir e ser futuro
 * - app === 'evolution' e action === 'webhook' (assinatura canônica da Evolution)
 * - iat (epoch seconds) deve existir
 */
export function validateJwtClaims(parsed: ParsedJwt, nowSeconds: number): string | null {
  if (parsed.header.alg !== 'HS256') {
    return `algoritmo inválido: ${parsed.header.alg ?? '(ausente)'}`;
  }

  const { iat, exp, app, action } = parsed.payload;

  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return 'claim iat ausente ou inválido';
  }

  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return 'claim exp ausente ou inválido';
  }

  if (exp < nowSeconds) {
    return 'token expirado';
  }

  // Janela de tolerância de clock skew: rejeitar tokens emitidos no futuro (iat > now + 5min)
  if (iat > nowSeconds + 300) {
    return 'iat no futuro (clock skew)';
  }

  if (app !== 'evolution') {
    return `claim app inválido: ${String(app)}`;
  }

  if (action !== 'webhook') {
    return `claim action inválido: ${String(action)}`;
  }

  return null;
}

/**
 * Verifica a assinatura HMAC-SHA256 de um JWT contra um secret.
 * Usa Web Crypto (nativo no Bun/Workers/Node 20+) — zero dependência.
 */
export async function verifyJwtSignature(parsed: ParsedJwt, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    return await crypto.subtle.verify(
      'HMAC',
      key,
      parsed.signature as unknown as BufferSource,
      new TextEncoder().encode(parsed.dataToSign),
    );
  } catch {
    return false;
  }
}

/**
 * Verificação completa: parse → claims → assinatura.
 * Retorna true se o token é válido para webhook da Evolution.
 */
export async function verifyEvolutionWebhookJwt(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ ok: boolean; reason?: string }> {
  if (!secret) {
    return { ok: false, reason: 'OMA_WEBHOOK_SECRET não configurado' };
  }

  const parsed = parseJwt(token);
  if (!parsed) {
    return { ok: false, reason: 'JWT malformado' };
  }

  const claimError = validateJwtClaims(parsed, nowSeconds);
  if (claimError) {
    return { ok: false, reason: claimError };
  }

  const valid = await verifyJwtSignature(parsed, secret);
  if (!valid) {
    return { ok: false, reason: 'assinatura inválida' };
  }

  return { ok: true };
}
