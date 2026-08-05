import { buildBackupKey, encryptWithAge, sha256, type BackupType } from '@omestre/r2-sdk';
import { R2Client } from '@omestre/r2-sdk';
import { runPgDump, type PgDumpResult } from './postgres-dump-pure.ts';

export interface BackupWriterConfig {
  r2: R2Client;
  agePublicKey: string;
  postgres: {
    container: string;
    dbUser: string;
    dbName: string;
    schemas: string[];
  };
  /** Quem disparou (p/ logs/telemetria). */
  actor: string;
}

export interface BackupWriterDeps {
  now?: () => Date;
  /** Função injetável p/ teste (default: runPgDump). */
  runPgDump?: typeof runPgDump;
}

export interface BackupSuccess {
  status: 'success';
  type: BackupType;
  r2Key: string;
  size: number;
  ciphertextSize: number;
  sha256: string;
  pgDumpMs: number;
  encryptMs: number;
  uploadMs: number;
  totalMs: number;
}

export interface BackupFailure {
  status: 'failed';
  type: BackupType;
  r2Key: string;
  errorCode: string;
  errorMessage: string;
  pgDumpMs: number;
}

export type BackupResult = BackupSuccess | BackupFailure;

/**
 * BackupWriter — orquestra o ciclo completo de um backup:
 *
 *   1. pg_dump (custom format, comprimido)
 *   2. SHA-256 do plaintext (p/ histórico)
 *   3. age encrypt (com pubkey)
 *   4. Upload cifrado para R2
 *
 * Retorna sempre BackupResult (sucesso ou falha com diagnóstico) —
 * quem chama (route ou cron) decide como reagir.
 */
export class BackupWriter {
  constructor(
    private readonly config: BackupWriterConfig,
    private readonly deps: BackupWriterDeps = {},
  ) {}

  async run(type: BackupType = 'auto'): Promise<BackupResult> {
    const start = Date.now();
    const now = this.deps.now ?? (() => new Date());
    const runPgDumpImpl = this.deps.runPgDump ?? runPgDump;
    const ts = now().toISOString().replace(/[:.]/g, '-');

    // 1. pg_dump
    const pgDumpResult = await this.safePgDump(runPgDumpImpl, type, ts);

    if ('errorCode' in pgDumpResult) {
      return {
        status: 'failed',
        type,
        r2Key: pgDumpResult.r2Key,
        errorCode: pgDumpResult.errorCode,
        errorMessage: pgDumpResult.errorMessage,
        pgDumpMs: pgDumpResult.pgDumpMs,
      };
    }

    const { data: dumpData, size, sha256: dumpSha, durationMs: pgDumpMs } = pgDumpResult;

    // 2. Build key
    const r2Key = buildBackupKey({
      type,
      ts: now().toISOString(),
      hashShort: dumpSha,
      schemas: this.config.postgres.schemas.join(','),
    });

    try {
      // 3. Encrypt
      const encStart = Date.now();
      const ciphertext = await encryptWithAge(Buffer.from(dumpData), this.config.agePublicKey);
      const encryptMs = Date.now() - encStart;

      // 4. Upload
      const uploadStart = Date.now();
      await this.config.r2.put(r2Key, ciphertext, {
        contentType: 'application/octet-stream',
        metadata: {
          sha256: dumpSha,
          schema: this.config.postgres.schemas.join(','),
          actor: this.config.actor,
        },
      });
      const uploadMs = Date.now() - uploadStart;

      return {
        status: 'success',
        type,
        r2Key,
        size,
        ciphertextSize: ciphertext.byteLength,
        sha256: dumpSha,
        pgDumpMs,
        encryptMs,
        uploadMs,
        totalMs: Date.now() - start,
      };
    } catch (err) {
      return {
        status: 'failed',
        type,
        r2Key,
        errorCode: classifyError(err),
        errorMessage: err instanceof Error ? err.message : String(err),
        pgDumpMs,
      };
    }
  }

  private async safePgDump(
    runPgDumpImpl: typeof runPgDump,
    type: BackupType,
    ts: string,
  ): Promise<
    | (PgDumpResult & { sha256: string })
    | { r2Key: string; errorCode: string; errorMessage: string; pgDumpMs: number }
  > {
    const start = Date.now();
    try {
      const result = await runPgDumpImpl({
        container: this.config.postgres.container,
        dbUser: this.config.postgres.dbUser,
        dbName: this.config.postgres.dbName,
        schemas: this.config.postgres.schemas,
        format: 'c',
      });
      const dumpSha = await sha256(Buffer.from(result.data));
      return { ...result, sha256: dumpSha };
    } catch (err) {
      // Em caso de falha no pg_dump, ainda temos um r2Key placeholder p/ log
      const r2Key = `${type}/${ts}__FAILED__${this.config.postgres.schemas.join(',')}.sql.gz.age`;
      return {
        r2Key,
        errorCode: classifyError(err),
        errorMessage: err instanceof Error ? err.message : String(err),
        pgDumpMs: Date.now() - start,
      };
    }
  }
}

function classifyError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes('pg_dump failed')) return 'pg_dump_failed';
    if (err.message.includes('R2 PUT failed')) return 'r2_upload_failed';
    if (err.message.includes('public key')) return 'invalid_age_public_key';
    if (err.message.includes('encrypter')) return 'age_encrypt_failed';
    return 'internal_error';
  }
  return 'unknown_error';
}
