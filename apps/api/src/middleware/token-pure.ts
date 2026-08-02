/**
 * Helpers puros de tokens de sessão (access curto + refresh rotativo).
 *
 * Lógica síncrona, sem I/O, isolada aqui para permitir cobertura de teste
 * de 100% sem depender de PostgreSQL/Redis/network.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

// ─── Constantes de vida ────────────────────────────────────────────────
/** Vida do access token: 1 hora. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** Vida do refresh token: 30 dias. */
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

/** Margem (s) para refresh proativo no front antes da expiração real. */
export const ACCESS_REFRESH_MARGIN_SECONDS = 2 * 60;

/**
 * Unix epoch (segundos) de expiração do ACCESS token a partir de `now`.
 * `now` deve ser ms (Date.now()).
 */
export function buildAccessTokenExpiry(now: number = Date.now()): number {
  return Math.floor(now / 1000) + ACCESS_TOKEN_SECONDS;
}

/**
 * Epoch (segundos) de expiração do REFRESH token a partir de `now`.
 */
export function buildRefreshTokenExpiry(now: number = Date.now()): number {
  return Math.floor(now / 1000) + REFRESH_TOKEN_SECONDS;
}

/**
 * Gera um novo refresh token opaco de 32 bytes em hex (64 chars).
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Hash SHA-256 determinístico do token opaco. Só o hash vai para o banco.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Identificador de família de rotação (UUID v4).
 */
export function newFamilyId(): string {
  return randomUUID();
}

// ─── Emissão de refresh token (monta registro pronto p/ INSERT) ──────────

export interface RefreshTokenIssue {
  /** Token opaco enviado ao cliente (não persiste). */
  token: string;
  /** Hash a persistir no banco. */
  hash: string;
  /** Família de rotação. */
  familyId: string;
  /** Data de expiração (Date) para o INSERT. */
  expiresAt: Date;
}

/**
 * Cria um refresh token completo: token opaco, hash, família e expiração.
 * `expiresAt` é retornado como Date p/ gravação direta no Drizzle.
 */
export function issueRefreshToken(
  nowMs: number = Date.now(),
  familyId?: string,
): RefreshTokenIssue {
  const token = generateRefreshToken();
  const expirySec = buildRefreshTokenExpiry(nowMs);
  return {
    token,
    hash: hashRefreshToken(token),
    familyId: familyId ?? newFamilyId(),
    expiresAt: new Date(expirySec * 1000),
  };
}
