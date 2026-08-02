/**
 * Lógica de rotação de sessão com dependências injetáveis.
 *
 * A rota /api/auth/refresh é um thin wrapper sobre refreshSession(); toda a
 * decisão (classify → not_found/expired/replay/valid) vive aqui, permitindo
 * testes unitários com mocks de objeto (sem mock.module global).
 */
import { classifyRefreshToken } from '../../middleware/token-refresh-pure.ts';
import {
  buildAccessTokenExpiry,
  hashRefreshToken,
  issueRefreshToken,
} from '../../middleware/token-pure.ts';

export interface RefreshTokenRowLike {
  id: number;
  userId: number;
  familyId: string;
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

export interface RefreshSessionDeps {
  refreshTokenRepo: {
    findByHashIncludingRevoked(hash: string): Promise<RefreshTokenRowLike | null>;
    revokeById(id: number): Promise<unknown>;
    revokeFamilyByFamilyId(familyId: string): Promise<unknown>;
    create(row: {
      userId: number;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
    }): Promise<unknown>;
  };
  userRepo: {
    findById(id: number): Promise<{ id: number; email: string; isAdmin: boolean } | null>;
  };
  jwtSign(payload: {
    userId: number;
    userEmail: string;
    isAdmin: boolean;
    exp: number;
  }): Promise<string>;
  nowMs?: number;
}

export type RefreshSessionResult =
  | { ok: true; status: 200; token: string; refreshToken: string }
  | { ok: false; status: 400; error: string }
  | { ok: false; status: 401; error: string };

export async function refreshSession(
  rawRefreshToken: string | undefined,
  deps: RefreshSessionDeps,
): Promise<RefreshSessionResult> {
  if (!rawRefreshToken) {
    return { ok: false, status: 400, error: 'refreshToken é obrigatório' };
  }

  const now = deps.nowMs ?? Date.now();
  const hash = hashRefreshToken(rawRefreshToken);
  const row = await deps.refreshTokenRepo.findByHashIncludingRevoked(hash);
  const verdict = classifyRefreshToken(
    row ? { revokedAt: row.revokedAt, expiresAt: row.expiresAt } : null,
    now,
  );

  if (verdict === 'not_found' || verdict === 'expired') {
    return { ok: false, status: 401, error: 'Refresh token inválido' };
  }

  if (verdict === 'replay') {
    if (row) {
      await deps.refreshTokenRepo.revokeFamilyByFamilyId(row.familyId);
    }
    return { ok: false, status: 401, error: 'Sessão revogada, faça login novamente' };
  }

  if (row) {
    const user = await deps.userRepo.findById(row.userId);
    if (!user) {
      return { ok: false, status: 401, error: 'Refresh token inválido' };
    }
    const issue = issueRefreshToken(now, row.familyId);
    await deps.refreshTokenRepo.revokeById(row.id);
    await deps.refreshTokenRepo.create({
      userId: row.userId,
      tokenHash: issue.hash,
      familyId: row.familyId,
      expiresAt: issue.expiresAt,
    });
    const token = await deps.jwtSign({
      userId: row.userId,
      userEmail: user.email,
      isAdmin: user.isAdmin,
      exp: buildAccessTokenExpiry(),
    });
    return { ok: true, status: 200, token, refreshToken: issue.token };
  }

  return { ok: false, status: 401, error: 'Refresh token inválido' };
}
