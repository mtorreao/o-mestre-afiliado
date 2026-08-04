import { describe, expect, test } from 'bun:test';
import {
  base64UrlToBytes,
  base64UrlToString,
  parseJwt,
  validateJwtClaims,
  verifyEvolutionWebhookJwt,
  verifyJwtSignature,
} from './webhook-jwt-pure.ts';

/**
 * Gera um JWT HS256 idêntico ao que a Evolution API v2.3.7 produz
 * (payload { iat, exp, app: 'evolution', action: 'webhook' }).
 */
async function signEvolutionJwt(
  secret: string,
  opts: { iat?: number; exp?: number; app?: string; action?: string; alg?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: opts.alg ?? 'HS256', typ: 'JWT' };
  const payload = {
    iat: opts.iat ?? now,
    exp: opts.exp ?? now + 600,
    app: opts.app ?? 'evolution',
    action: opts.action ?? 'webhook',
  };

  const enc = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const dataToSign = `${enc(header)}.${enc(payload)}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataToSign)),
  );
  const sigB64 = Buffer.from(sig).toString('base64url');

  return `${dataToSign}.${sigB64}`;
}

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('base64Url helpers', () => {
  test('base64UrlToBytes decodifica base64url (sem padding)', () => {
    const bytes = base64UrlToBytes('aGVsbG8'); // "hello"
    expect(Buffer.from(bytes).toString('utf8')).toBe('hello');
  });

  test('base64UrlToString decodifica para UTF-8', () => {
    expect(base64UrlToString('aGVsbG8')).toBe('hello');
  });

  test('base64UrlToBytes lida com - e _', () => {
    const input = Buffer.from('{"a":1}').toString('base64url');
    const bytes = base64UrlToBytes(input);
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
  });
});

describe('parseJwt', () => {
  test('retorna null para token malformado (<3 segmentos)', () => {
    expect(parseJwt('a.b')).toBeNull();
    expect(parseJwt('')).toBeNull();
    expect(parseJwt('a.b.c.d')).toBeNull();
  });

  test('retorna null para header não-JSON', () => {
    const bad = `${Buffer.from('nao-json').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.x`;
    expect(parseJwt(bad)).toBeNull();
  });

  test('parseia JWT válido e expõe claims + dataToSign', async () => {
    const token = await signEvolutionJwt(SECRET);
    const parsed = parseJwt(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.header.alg).toBe('HS256');
    expect(parsed!.payload.app).toBe('evolution');
    expect(parsed!.payload.action).toBe('webhook');
    expect(parsed!.dataToSign.split('.')).toHaveLength(2);
  });
});

describe('validateJwtClaims', () => {
  const now = 1_700_000_000;

  test('aceita claims válidos da Evolution', () => {
    const parsed = {
      header: { alg: 'HS256' },
      payload: { iat: now, exp: now + 600, app: 'evolution', action: 'webhook' },
      signature: new Uint8Array(),
      dataToSign: 'a.b',
    };
    expect(validateJwtClaims(parsed, now)).toBeNull();
  });

  test('rejeita algoritmo diferente de HS256', () => {
    const parsed = {
      header: { alg: 'none' },
      payload: { iat: now, exp: now + 600, app: 'evolution', action: 'webhook' },
      signature: new Uint8Array(),
      dataToSign: 'a.b',
    };
    expect(validateJwtClaims(parsed, now)).toContain('algoritmo');
  });

  test('rejeita token expirado', () => {
    const parsed = {
      header: { alg: 'HS256' },
      payload: { iat: now - 1200, exp: now - 600, app: 'evolution', action: 'webhook' },
      signature: new Uint8Array(),
      dataToSign: 'a.b',
    };
    expect(validateJwtClaims(parsed, now)).toBe('token expirado');
  });

  test('rejeita iat ausente', () => {
    const parsed = {
      header: { alg: 'HS256' },
      payload: { exp: now + 600, app: 'evolution', action: 'webhook' },
      signature: new Uint8Array(),
      dataToSign: 'a.b',
    };
    expect(validateJwtClaims(parsed, now)).toContain('iat');
  });

  test('rejeita exp ausente', () => {
    const parsed = {
      header: { alg: 'HS256' },
      payload: { iat: now, app: 'evolution', action: 'webhook' },
      signature: new Uint8Array(),
      dataToSign: 'a.b',
    };
    expect(validateJwtClaims(parsed, now)).toContain('exp');
  });

  test('rejeita app diferente de evolution', () => {
    const parsed = {
      header: { alg: 'HS256' },
      payload: { iat: now, exp: now + 600, app: 'evil', action: 'webhook' },
      signature: new Uint8Array(),
      dataToSign: 'a.b',
    };
    expect(validateJwtClaims(parsed, now)).toContain('app');
  });

  test('rejeita action diferente de webhook', () => {
    const parsed = {
      header: { alg: 'HS256' },
      payload: { iat: now, exp: now + 600, app: 'evolution', action: 'delete' },
      signature: new Uint8Array(),
      dataToSign: 'a.b',
    };
    expect(validateJwtClaims(parsed, now)).toContain('action');
  });

  test('rejeita iat no futuro além de 5min (clock skew)', () => {
    const parsed = {
      header: { alg: 'HS256' },
      payload: { iat: now + 600, exp: now + 3600, app: 'evolution', action: 'webhook' },
      signature: new Uint8Array(),
      dataToSign: 'a.b',
    };
    expect(validateJwtClaims(parsed, now)).toContain('futuro');
  });
});

describe('verifyJwtSignature', () => {
  test('aceita assinatura válida', async () => {
    const token = await signEvolutionJwt(SECRET);
    const parsed = parseJwt(token)!;
    expect(await verifyJwtSignature(parsed, SECRET)).toBe(true);
  });

  test('rejeita assinatura com secret errado', async () => {
    const token = await signEvolutionJwt(SECRET);
    const parsed = parseJwt(token)!;
    expect(await verifyJwtSignature(parsed, 'outro-secret')).toBe(false);
  });

  test('rejeita assinatura alterada (tamper payload)', async () => {
    const token = await signEvolutionJwt(SECRET);
    const [h, , sig] = token.split('.');
    // Troca o payload por um claim malicioso, mantém assinatura original
    const evilPayload = Buffer.from(
      JSON.stringify({ iat: 1, exp: 9e9, app: 'evolution', action: 'webhook', admin: true }),
    ).toString('base64url');
    const tampered = `${h}.${evilPayload}.${sig}`;
    const parsed = parseJwt(tampered)!;
    expect(await verifyJwtSignature(parsed, SECRET)).toBe(false);
  });
});

describe('verifyEvolutionWebhookJwt (integração do fluxo completo)', () => {
  test('aceita token válido da Evolution', async () => {
    const token = await signEvolutionJwt(SECRET);
    const result = await verifyEvolutionWebhookJwt(token, SECRET);
    expect(result.ok).toBe(true);
  });

  test('rejeita quando secret não configurado', async () => {
    const token = await signEvolutionJwt(SECRET);
    const result = await verifyEvolutionWebhookJwt(token, '');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('não configurado');
  });

  test('rejeita JWT malformado', async () => {
    const result = await verifyEvolutionWebhookJwt('nao.eh.jwt', SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('JWT malformado');
  });

  test('rejeita token com secret errado (não-Evolution)', async () => {
    const token = await signEvolutionJwt('chave-de-outro-servico');
    const result = await verifyEvolutionWebhookJwt(token, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('assinatura inválida');
  });

  test('rejeita token expirado mesmo com assinatura válida', async () => {
    const token = await signEvolutionJwt(SECRET, { exp: Math.floor(Date.now() / 1000) - 10 });
    const result = await verifyEvolutionWebhookJwt(token, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('token expirado');
  });

  test('aceita token válido com nowSeconds explícito (determinístico)', async () => {
    const now = 1_700_000_000;
    const token = await signEvolutionJwt(SECRET, { iat: now, exp: now + 600 });
    const result = await verifyEvolutionWebhookJwt(token, SECRET, now);
    expect(result.ok).toBe(true);
  });
});
