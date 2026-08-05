import { describe, expect, test } from 'bun:test';
import {
  buildBackupKey,
  decryptWithAge,
  encryptWithAge,
  isValidAgePublicKey,
  isValidAgeSecretKey,
  parseBackupKey,
  sha256,
} from './backup.ts';

describe('age key validation', () => {
  test('aceita public key válida', () => {
    const valid = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
    expect(isValidAgePublicKey(valid)).toBe(true);
  });

  test('rejeita public key inválida', () => {
    expect(isValidAgePublicKey('not-an-age-key')).toBe(false);
    expect(isValidAgePublicKey('age1short')).toBe(false);
    expect(isValidAgePublicKey('')).toBe(false);
  });

  test('aceita secret key válida', () => {
    const valid = 'AGE-SECRET-KEY-1UU7N7P9P78ZN4EHS2L0XYAYTPN5H78UEM6AWT9RX7GZYHUX04YKQ83DCXD';
    expect(isValidAgeSecretKey(valid)).toBe(true);
  });

  test('rejeita secret key inválida', () => {
    expect(isValidAgeSecretKey('not-a-secret-key')).toBe(false);
    expect(isValidAgeSecretKey('AGE-SECRET-KEY-1short')).toBe(false);
  });
});

describe('encrypt + decrypt (round-trip)', () => {
  test('cifra e decifra dados válidos', async () => {
    const plaintext = Buffer.from('hello world — 测试 🎉');
    const publicKey = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
    // secret key gerada pela mesma public key — gerada deterministicamente abaixo
    const cipher = await encryptWithAge(plaintext, publicKey);

    expect(cipher.byteLength).toBeGreaterThan(plaintext.byteLength);
    expect(cipher).not.toEqual(plaintext);

    // Para decifrar, preciso da secret key correspondente.
    // Em testes, derivamos uma usando age.generateKey() (Bun nativo).
    const { generateIdentity, identityToRecipient } = await import('age-encryption');
    const identity = await generateIdentity(); // AGE-SECRET-KEY-1...
    const publicKey2 = await identityToRecipient(identity);
    const cipher2 = await encryptWithAge(plaintext, publicKey2);
    const decrypted = await decryptWithAge(cipher2, identity);
    expect(decrypted.toString()).toBe(plaintext.toString());
  });

  test('falha com public key inválida', async () => {
    await expect(encryptWithAge(Buffer.from('x'), 'invalid-key')).rejects.toThrow(/public key/i);
  });
});

describe('sha256', () => {
  test('hash SHA-256 conhecido (vazio)', async () => {
    const hash = await sha256(Buffer.alloc(0));
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('hash SHA-256 conhecido (abc)', async () => {
    const hash = await sha256(Buffer.from('abc'));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('produz hash de 64 chars hex', async () => {
    const hash = await sha256(Buffer.from('test data'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('buildBackupKey', () => {
  test('formato com timestamp + hash + schemas', () => {
    const key = buildBackupKey({
      type: 'auto',
      ts: '2026-08-04T03:00:00Z',
      hashShort: 'a'.repeat(64),
      schemas: 'omestre,evolution_api',
    });
    expect(key).toBe(
      'auto/2026-08-04T03-00-00Z__aaaaaaaaaaaaaaaa__omestre,evolution_api.sql.gz.age',
    );
  });

  test('sufixo .age (cifrado)', () => {
    const key = buildBackupKey({
      type: 'auto',
      ts: '2026-08-04T03:00:00Z',
      hashShort: 'a'.repeat(64),
      schemas: 'omestre',
    });
    expect(key.endsWith('.age')).toBe(true);
  });

  test('substitui ":" → "-" no timestamp (S3-safe)', () => {
    const key = buildBackupKey({
      type: 'manual',
      ts: '2026-08-04T15:30:12Z',
      hashShort: 'b'.repeat(64),
      schemas: 'omestre',
    });
    expect(key).not.toContain(':');
    expect(key).toContain('T15-30-12Z');
  });

  test('trunca hash para 16 chars', () => {
    const key = buildBackupKey({
      type: 'auto',
      ts: '2026-08-04T03:00:00Z',
      hashShort: 'a'.repeat(64),
      schemas: 'omestre',
    });
    // Extract the hash portion between __ separators
    const match = /__([a-f0-9]+)__/.exec(key);
    expect(match?.[1]?.length).toBe(16);
  });

  test('sanitiza schemas com caracteres especiais', () => {
    const key = buildBackupKey({
      type: 'auto',
      ts: '2026-08-04T03:00:00Z',
      hashShort: 'a'.repeat(64),
      schemas: 'omestre,evo lution_api',
    });
    expect(key).not.toContain(' ');
  });
});

describe('parseBackupKey (reverso)', () => {
  test('faz round-trip com chave válida', () => {
    const original: Parameters<typeof buildBackupKey>[0] = {
      type: 'auto',
      ts: '2026-08-04T03:00:00Z',
      hashShort: 'a'.repeat(64),
      schemas: 'omestre,evolution_api',
    };
    const key = buildBackupKey(original);
    const parsed = parseBackupKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('auto');
    expect(parsed!.schemas).toBe(original.schemas);
  });

  test('retorna null para chave inválida', () => {
    expect(parseBackupKey('random/path/file.txt')).toBeNull();
    expect(parseBackupKey('auto/missing-suffix')).toBeNull();
    expect(parseBackupKey('auto/2026-08-04T03-00-00Z__abc__omestre.sql.gz')).toBeNull();
  });
});
