#!/usr/bin/env bun
/**
 * scripts/migrate-affiliates-to-mirrors.ts — Migração one-shot
 *
 * Lê todos os affiliates com sourceGroups/targetGroups da tabela affiliates
 * e cria um mirror correspondente na tabela mirrors.
 *
 * Segurança:
 * - Idempotente: verifica se já existe mirror para o userId antes de criar
 * - Loga cada operação
 * - Rollback implícito (não altera dados existentes, só insere)
 *
 * Uso:
 *   bun run scripts/migrate-affiliates-to-mirrors.ts
 */

import { getDb, closeDb, affiliates, mirrors } from '@omestre/db';
import { eq, sql } from 'drizzle-orm';

/** Extrai userId do instanceName (formato "user-{userId}") */
function userIdFromInstanceName(instanceName: string): number | null {
  const match = instanceName.match(/^user-(\d+)$/);
  return match ? parseInt(match[1]!, 10) : null;
}

interface AffiliateRow {
  id: number;
  evolutionInstanceId: string | null;
  sourceGroups: unknown;
  targetGroups: unknown;
  messageTemplate: string | null;
}

interface MirrorRow {
  id: number;
  userId: number | null;
}

async function main() {
  console.log('=== Migração: affiliates → mirrors ===\n');

  const db = getDb();

  // 1. Busca todos os affiliates com sourceGroups
  const allAffiliates = await db
    .select({
      id: affiliates.id,
      evolutionInstanceId: affiliates.evolutionInstanceId,
      sourceGroups: affiliates.sourceGroups,
      targetGroups: affiliates.targetGroups,
      messageTemplate: affiliates.messageTemplate,
    })
    .from(affiliates)
    .where(sql`jsonb_array_length(${affiliates.sourceGroups}) > 0`);

  console.log(`Encontrados ${allAffiliates.length} affiliate(s) com sourceGroups.\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const aff of allAffiliates) {
    const instanceId = aff.evolutionInstanceId;
    if (!instanceId) {
      console.log(`  ⏭️  Affiliate #${aff.id}: sem evolutionInstanceId, pulando`);
      skipped++;
      continue;
    }

    const userId = userIdFromInstanceName(instanceId);
    if (!userId) {
      console.log(`  ⏭️  Affiliate #${aff.id}: evolutionInstanceId "${instanceId}" não é "user-N", pulando`);
      skipped++;
      continue;
    }

    const srcGroups = aff.sourceGroups as { jid: string; name: string }[] | null;
    const tgtGroups = aff.targetGroups as { jid: string; name: string }[] | null;

    if (!srcGroups || srcGroups.length === 0) {
      console.log(`  ⏭️  Affiliate #${aff.id} (user ${userId}): sem sourceGroups, pulando`);
      skipped++;
      continue;
    }

    // 2. Verifica se já existe mirror para este userId
    const existing = await db
      .select({ id: mirrors.id, userId: mirrors.userId })
      .from(mirrors)
      .where(eq(mirrors.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ⏭️  Affiliate #${aff.id} (user ${userId}): mirror #${existing[0]!.id} já existe, pulando`);
      skipped++;
      continue;
    }

    // 3. Cria o mirror
    try {
      const [row] = await db
        .insert(mirrors)
        .values({
          name: 'Espelhamento Padrão',
          status: 'active',
          userId,
          sourceGroups: srcGroups,
          targetGroups: tgtGroups ?? [],
          messageTemplate: aff.messageTemplate ?? null,
        })
        .returning();

      console.log(`  ✅ Affiliate #${aff.id} (user ${userId}) → mirror #${row!.id} "${row!.name}" criado`);
      console.log(`     SourceGroups: ${srcGroups.map((g) => g.name).join(', ')}`);
      console.log(`     TargetGroups: ${(tgtGroups ?? []).map((g) => g.name).join(', ')}`);
      created++;
    } catch (err) {
      console.error(`  ❌ Affiliate #${aff.id} (user ${userId}): erro ao criar mirror:`, err);
      errors++;
    }
  }

  console.log(`\n=== Resumo ===`);
  console.log(`  ✅ ${created} mirror(s) criado(s)`);
  console.log(`  ⏭️  ${skipped} affiliate(s) pulado(s)`);
  console.log(`  ❌ ${errors} erro(s)`);
  console.log('');

  if (created > 0) {
    console.log('🔔 Lembrete: reinicie a API para que o warm cache carregue os novos mirrors.');
    console.log('   docker compose -f docker-compose.dev.yml restart api');
  }

  await closeDb();
  process.exit(errors > 0 ? 1 : 0);
}

main();
