/**
 * Backup helpers — cifragem client-side via age + dump postgres.
 *
 * API moderna age-encryption (>=0.3.0): usa a classe Encrypter/Decrypter
 * (não mais funções top-level age.encrypt()/decrypt()).
 *
 * Esta lib NÃO roda o dump diretamente (precisa de Drizzle schema do
 * admin-center). Apenas helpers de:
 *   - buildBackupKey()    — gera a chave do blob no R2
 *   - encryptWithAge()    — cifra bytes com age (public key)
 *   - decryptWithAge()    — decifra com age (secret key)
 *   - sha256()            — checksum pra histórico
 *
 * Quem orquestra é o admin-center (apps/admin-api).
 */
import { Encrypter, Decrypter } from 'age-encryption';

export type BackupType = 'auto' | 'manual';

export interface BackupKeyParts {
  type: BackupType;
  /** ISO 8601 timestamp, ex: "2026-08-04T03:00:00Z" (":" → "-" p/ S3-safe). */
  ts: string;
  /** SHA256 hex do conteúdo (16 chars, truncation). */
  hashShort: string;
  /** Schemas incluídos, ex: "omestre,evolution_api". */
  schemas: string;
}

/**
 * Gera a chave do blob no R2. Formato:
 *   auto/2026-08-04T03-00-00Z__abc123def456__omestre,evolution_api.sql.gz.age
 *
 * - Tipo no prefixo facilita lifecycle policies (auto vs manual)
 * - Timestamp ISO 8601 (com ":" → "-") é S3-safe
 * - Hash curto no meio evita colisão de nomes
 * - Sufixo `.age` indica cifrado
 */
export function buildBackupKey(parts: BackupKeyParts): string {
  const safeTs = parts.ts.replace(/:/g, '-');
  const safeHash = parts.hashShort.slice(0, 16);
  const schemaPart = parts.schemas.replace(/[^a-z0-9,_-]/gi, '_');
  return `${parts.type}/${safeTs}__${safeHash}__${schemaPart}.sql.gz.age`;
}

/** Parse de uma chave R2 (reverso de buildBackupKey). */
export function parseBackupKey(key: string): BackupKeyParts | null {
  const match = /^([a-z]+)\/([^_]+)__([a-f0-9]+)__(.+)\.sql\.gz\.age$/.exec(key);
  if (!match) return null;
  const [, type, ts, hashShort, schemas] = match;
  return {
    type: (type ?? 'auto') as BackupType,
    ts: (ts ?? '').replace(/-/g, ':').replace(/Z$/, 'Z'),
    hashShort: hashShort || '',
    schemas: schemas || '',
  };
}

/** Cifra bytes com age (public key). Retorna ciphertext. */
export async function encryptWithAge(plaintext: Buffer, publicKey: string): Promise<Buffer> {
  if (!isValidAgePublicKey(publicKey)) {
    throw new Error('Invalid age public key format (expected "age1...")');
  }
  const encrypter = new Encrypter();
  encrypter.addRecipient(publicKey);
  const ciphertext = await encrypter.encrypt(plaintext);
  return Buffer.from(ciphertext);
}

/** Decifra com age (secret key, formato "AGE-SECRET-KEY-1..."). */
export async function decryptWithAge(ciphertext: Buffer, identity: string): Promise<Buffer> {
  if (!isValidAgeSecretKey(identity)) {
    throw new Error('Invalid age secret key format (expected "AGE-SECRET-KEY-1...")');
  }
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const plaintext = await decrypter.decrypt(ciphertext);
  return Buffer.from(plaintext);
}

/** SHA-256 hex de um buffer. */
export async function sha256(data: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Quick check do formato de chaves age. */
export function isValidAgePublicKey(key: string): boolean {
  return /^age1[a-z0-9]{58}$/.test(key);
}

export function isValidAgeSecretKey(key: string): boolean {
  return /^AGE-SECRET-KEY-1[A-Z0-9]{58}$/.test(key);
}
