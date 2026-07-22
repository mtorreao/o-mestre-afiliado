/**
 * @omestre/db — Criptografia AES-256-GCM para dados sensíveis
 * ====================================================================
 *
 * Usa a ENCRYPTION_KEY do ambiente (32 bytes em hex) como chave.
 * Formato armazenado: base64(iv + authTag + ciphertext)
 *
 * Uso:
 *   import { encrypt, decrypt } from '@omestre/db';
 *   const encrypted = encrypt('texto-sensivel');
 *   const decrypted = decrypt(encrypted);
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96 bits — recomendado para GCM
const TAG_LENGTH = 16;  // 128 bits — auth tag

/** Cache da chave derivada — evita parse a cada chamada. */
let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY não configurada. Defina uma chave de 32 bytes em hex ' +
      '(64 caracteres hex). Ex: openssl rand -hex 32',
    );
  }

  const normalized = raw.trim();
  // Aceita hex (64 chars) ou base64 (44 chars)
  if (normalized.length === 64 && /^[0-9a-f]{64}$/i.test(normalized)) {
    _key = Buffer.from(normalized, 'hex');
  } else if (normalized.length === 44 && /^[A-Za-z0-9+/]{44}=?$/i.test(normalized)) {
    _key = Buffer.from(normalized, 'base64');
  } else {
    // Tenta como raw string — faz hash para obter 32 bytes determinísticos
    // Aviso: menos seguro, mas evita crash em dev
    console.warn(
      '[crypto] ENCRYPTION_KEY com formato desconhecido — usando SHA-256. ' +
      'Para produção, gere uma chave de 32 bytes com: openssl rand -hex 32',
    );
    _key = createHash('sha256').update(normalized).digest();
  }

  return _key!;
}

/**
 * Criptografa um texto com AES-256-GCM.
 *
 * @param plaintext - Texto plano a ser criptografado
 * @returns String base64 contendo: iv (12) + authTag (16) + ciphertext
 *          Retorna null se plaintext for null/undefined/vazio
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Formato: iv + authTag + ciphertext → base64
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return payload.toString('base64');
}

/**
 * Descriptografa um texto previamente criptografado com encrypt().
 *
 * @param encrypted - String base64 no formato iv + authTag + ciphertext
 * @returns Texto plano original, ou null se entrada for null/undefined/vazia
 */
export function decrypt(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;

  const key = getKey();
  const payload = Buffer.from(encrypted, 'base64');

  if (payload.length < IV_LENGTH + TAG_LENGTH + 1) {
    console.warn('[crypto] Dados criptografados inválidos (muito curtos)');
    return null;
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf-8');
  } catch {
    console.warn(
      '[crypto] Falha ao descriptografar — chave pode ter mudado ou dados corrompidos',
    );
    return null;
  }
}
