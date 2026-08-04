/**
 * Testes de verificação de assinatura Ed25519.
 *
 * Gera um par de chaves real via WebCrypto e valida o fluxo completo:
 * assinatura válida aceita, assinatura inválida rejeitada, payload
 * adulterado rejeitado.
 */

import { describe, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { verifyEd25519Signature } from './verify-ed25519.ts';

async function generateKeyPair(): Promise<{ publicKeyB64: string; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pubRaw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return {
    publicKeyB64: Buffer.from(pubRaw).toString('base64'),
    privateKey: pair.privateKey,
  };
}

async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const digest = createHash('sha256').update(payload, 'utf8').digest();
  const sig = await crypto.subtle.sign('Ed25519', privateKey, digest);
  return Buffer.from(sig).toString('hex');
}

describe('verifyEd25519Signature', () => {
  test('aceita assinatura válida', async () => {
    const { publicKeyB64, privateKey } = await generateKeyPair();
    const payload = JSON.stringify({ ref: 'v0.4.2', sha: '954d94b' });
    const sig = await signPayload(privateKey, payload);

    expect(await verifyEd25519Signature(payload, sig, publicKeyB64)).toBe(true);
  });

  test('rejeita assinatura de outro payload (payload adulterado)', async () => {
    const { publicKeyB64, privateKey } = await generateKeyPair();
    const payload = JSON.stringify({ ref: 'v0.4.2', sha: '954d94b' });
    const sig = await signPayload(privateKey, payload);

    const tampered = JSON.stringify({ ref: 'v0.4.3', sha: 'deadbeef' });
    expect(await verifyEd25519Signature(tampered, sig, publicKeyB64)).toBe(false);
  });

  test('rejeita assinatura de outra chave', async () => {
    const { privateKey } = await generateKeyPair();
    const other = await generateKeyPair();
    const payload = JSON.stringify({ ref: 'v0.4.2' });
    const sig = await signPayload(privateKey, payload);

    expect(await verifyEd25519Signature(payload, sig, other.publicKeyB64)).toBe(false);
  });

  test('rejeita assinatura em formato inválido', async () => {
    const { publicKeyB64 } = await generateKeyPair();
    expect(await verifyEd25519Signature('{}', 'not-hex', publicKeyB64)).toBe(false);
    expect(await verifyEd25519Signature('{}', '', publicKeyB64)).toBe(false);
  });

  test('rejeita chave pública inválida (tamanho errado)', async () => {
    const payload = JSON.stringify({ ref: 'v0.4.2' });
    expect(
      await verifyEd25519Signature(payload, 'a'.repeat(128), Buffer.alloc(16).toString('base64')),
    ).toBe(false);
    expect(await verifyEd25519Signature(payload, 'a'.repeat(128), 'not-base64!!')).toBe(false);
  });

  test('rejeita payload com hash de tamanho errado (regressão de compatibilidade)', async () => {
    // Garante que o digest usado é sha256 (32 bytes) e não algo maior.
    const { publicKeyB64, privateKey } = await generateKeyPair();
    const payload = randomBytes(64).toString('hex');
    const digest = createHash('sha256').update(payload, 'utf8').digest();
    const sig = await crypto.subtle.sign('Ed25519', privateKey, digest);
    expect(
      await verifyEd25519Signature(payload, Buffer.from(sig).toString('hex'), publicKeyB64),
    ).toBe(true);
  });
});
