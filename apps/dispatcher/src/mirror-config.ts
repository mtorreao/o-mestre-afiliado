/**
 * Resolve a configuração de envio a partir do mirrorId.
 *
 * O SendEvent carrega apenas o mirrorId; o Dispatcher busca a config
 * completa (instanceName, targetGroup, affiliateId, rate limits).
 *
 * Retorna null se o mirror não existir ou estiver inativo.
 */
import { eq } from 'drizzle-orm';
import type { MirrorSendConfig } from '@omestre/shared';
import { getDb, mirrors, affiliates } from '@omestre/db';

function log(level: 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'dispatcher',
    message,
    ...(data ? { data } : {}),
  };
  console.error(JSON.stringify(entry));
}

export async function getMirrorSendConfig(mirrorId: number): Promise<MirrorSendConfig | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: mirrors.id,
        status: mirrors.status,
        userId: mirrors.userId,
        targetGroups: mirrors.targetGroups,
        subRateLimitMaxMsgs: mirrors.subRateLimitMaxMsgs,
        subRateLimitWindowSec: mirrors.subRateLimitWindowSec,
      })
      .from(mirrors)
      .where(eq(mirrors.id, mirrorId))
      .limit(1);

    const m = rows[0];
    if (!m) return null;
    if (m.status === 'inactive') return null;

    // Resolve instanceName + affiliateId a partir do userId
    const userId = m.userId ?? 0;
    const affRows = await db
      .select({
        id: affiliates.id,
        evolutionInstanceId: affiliates.evolutionInstanceId,
      })
      .from(affiliates)
      .where(eq(affiliates.id, userId))
      .limit(1);

    const affiliate = affRows[0];
    const instanceName = affiliate?.evolutionInstanceId ?? `user-${userId}`;
    const affiliateId = affiliate?.id ?? userId;

    // 1 mirror = 1 targetGroup (primeiro da lista)
    const targetGroupList = (m.targetGroups as { jid: string; name: string }[]) ?? [];
    const targetGroup = targetGroupList[0] ?? { jid: '', name: '(desconhecido)' };

    return {
      instanceName,
      targetGroupJid: targetGroup.jid,
      targetGroupName: targetGroup.name,
      affiliateId,
      status: m.status,
      subRateMaxMsgs: m.subRateLimitMaxMsgs ?? 0,
      subRateWindowSec: m.subRateLimitWindowSec ?? 300,
    };
  } catch (err) {
    log('error', 'Erro ao buscar configuração do mirror', {
      mirrorId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
