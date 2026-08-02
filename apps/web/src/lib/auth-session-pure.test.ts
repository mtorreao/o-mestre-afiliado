import { describe, expect, it } from 'bun:test';
import {
  base64UrlDecode,
  decodeJwtExp,
  isAccessExpired,
  secondsUntilExpiry,
  shouldProactivelyRefresh,
} from './auth-session-pure.ts';

function b64(s: string): string {
  return Buffer.from(s)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function build(expSeconds: number): string {
  const header = b64('{"alg":"none"}');
  const payload = b64(JSON.stringify({ sub: '1', exp: expSeconds }));
  return header + '.' + payload + '.sort';
}

describe('auth-session-pure', () => {
  const nowMs = 1_800_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);

  it('decodeJwtExp extrai o exp em segundos', () => {
    expect(decodeJwtExp(build(nowSec))).toBe(nowSec);
  });

  it('decodeJwtExp retorna null para payload invalido', () => {
    expect(decodeJwtExp('nao-e-jwt')).toBeNull();
    expect(decodeJwtExp('a.b.c')).toBeNull();
  });

  it('base64UrlDecode decodifica conteudo', () => {
    const raw = '{"x":1}';
    const b = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    expect(base64UrlDecode(b)).toBe(raw);
  });

  it('secondsUntilExpiry = exp - now', () => {
    expect(secondsUntilExpiry(build(nowSec + 120), nowMs)).toBe(120);
  });

  it('secondsUntilExpiry 0 com token invalido', () => {
    expect(secondsUntilExpiry('bad', nowMs)).toBe(0);
  });

  it('shouldProactivelyRefresh true quando faltam 60s', () => {
    expect(shouldProactivelyRefresh(build(nowSec + 60), nowMs, 60)).toBe(true);
  });

  it('shouldProactivelyRefresh false quando sobram 5min', () => {
    expect(shouldProactivelyRefresh(build(nowSec + 300), nowMs, 60)).toBe(false);
  });

  it('shouldProactivelyRefresh true quando faltam 3s', () => {
    expect(shouldProactivelyRefresh(build(nowSec + 3), nowMs, 60)).toBe(true);
  });

  it('shouldProactivelyRefresh false sem token', () => {
    expect(shouldProactivelyRefresh(null, nowMs)).toBe(false);
  });

  it('isAccessExpired true quando exp <= now', () => {
    expect(isAccessExpired(build(nowSec), nowMs)).toBe(true);
    expect(isAccessExpired(null, nowMs)).toBe(true);
  });

  it('isAccessExpired false quando exp no futuro', () => {
    expect(isAccessExpired(build(nowSec + 500), nowMs)).toBe(false);
  });
});
