/**
 * Decisão de rotacionamento de refresh token — pura, sem I/O.
 *
 * Dado o registro encontrado no banco (ou null) e o timestamp atual,
 * classifica o refresh token em um veredito de segurança:
 *   - not_found : hash não existe no banco → inválido.
 *   - expired   : existia mas expirou (independente de revogado) → inválido.
 *   - replay    : já revogado e ainda dentro da janela (reuso do token ANTERIOR
 *                 após rotação) → deve revogar a família inteira (provável roubo).
 *   - valid     : vivo e não expirado → permitido rotacionar.
 */
export type RefreshRowLike = {
  revokedAt: Date | null;
  expiresAt: Date;
};

export type RefreshVerdict = 'not_found' | 'expired' | 'replay' | 'valid';

export function classifyRefreshToken(row: RefreshRowLike | null, nowMs: number): RefreshVerdict {
  if (!row) return 'not_found';
  const expired = row.expiresAt.getTime() <= nowMs;
  const revoked = row.revokedAt != null;

  if (!revoked && !expired) return 'valid';
  // Revogado mas ainda no prazo: é reuso de um token que já foi rotacionado.
  if (revoked && !expired) return 'replay';
  return 'expired';
}
