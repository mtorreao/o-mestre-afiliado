/**
 * Verificação de assinatura Ed25519 — valida webhooks do GitHub Action.
 *
 * O GitHub Action assina o payload do deploy com a chave PRIVADA (guardada
 * no GitHub Secrets). O admin-api valida com a chave PÚBLICA (no .env).
 * Assinatura: `signature = ed25519_sign(privKey, sha256(payload))`.
 *
 * Usa WebCrypto (disponível no Bun nativamente) — sem dependências.
 */

import { createHash } from 'node:crypto';

/**
 * Valida payload JSON + assinatura hex + chave pública base64 (32 bytes).
 *
 * @param payload      corpo cru do request (string JSON)
 * @param signature    hex do ed25519 (64 bytes = 128 chars hex)
 * @param publicKeyB64 chave pública ed25519 em base64
 * @returns true se a assinatura é válida para o payload
 */
export async function verifyEd25519Signature(
  payload: string,
  signature: string,
  publicKeyB64: string,
): Promise<boolean> {
  if (!signature || !publicKeyB64) return false;
  if (!/^[0-9a-fA-F]{128}$/.test(signature)) return false;

  try {
    const pubKeyRaw = Uint8Array.from(Buffer.from(publicKeyB64, 'base64'));
    if (pubKeyRaw.length !== 32) return false;

    const key = await crypto.subtle.importKey('raw', pubKeyRaw, { name: 'Ed25519' }, false, [
      'verify',
    ]);

    const sigBytes = Uint8Array.from(Buffer.from(signature, 'hex'));
    const digest = createHash('sha256').update(payload, 'utf8').digest();
    return await crypto.subtle.verify('Ed25519', key, sigBytes, digest);
  } catch {
    return false;
  }
}
