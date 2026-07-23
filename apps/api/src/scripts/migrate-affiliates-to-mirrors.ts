#!/usr/bin/env bun
/**
 * scripts/migrate-affiliates-to-mirrors.ts — Migração one-shot
 *
 * Lê todos os affiliates com sourceGroups/targetGroups da tabela affiliates
 * e cria um mirror correspondente na tabela mirrors.
 *
 * Executar da raiz com:
 *   bun run --cwd apps/api src/scripts/migrate-affiliates-to-mirrors.ts
 */

import { getDb, closeDb, MirrorRepository } from '@omestre/db';

const mirrorRepo = new MirrorRepository();

/** Extrai userId do instanceName (formato "user-{userId}") */
function userIdFromInstanceName(instanceName: string): number | null {
  const match = instanceName.match(/^user-(\d+)$/);
  return match ? parseInt(match[1]!, 10) : null;
}

async function main() {
  console.log('=== Migração: affiliates → mirrors ===\n');

  const db = getDb();

  // Busca affiliates com sourceGroups preenchidos via SQL raw
  const raw = await db.execute(
    `SELECT id, evolution_instance_id, source_groups, target_groups, message_template
     FROM omestre.affiliates
     WHERE source_groups IS NOT NULL
       AND jsonb_array_length(source_groups) > 0`,
  );

  const rows = raw.rows ?? raw;
  console.log(`Encontrados ${rows.length} affiliate(s) com sourceGroups.\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const aff of rows as Record<string, unknown>[]) {
    const instanceId = aff.evolution_instance_id as string | null;
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

    // Parse JSONB fields
    let srcGroups: { jid: string; name: string }[];
    let tgtGroups: { jid: string; name: string }[];

    try {
      srcGroups = typeof aff.source_groups === 'string'
        ? JSON.parse(aff.source_groups)
        : (aff.source_groups as { jid: string; name: string }[]);
    } catch {
      console.log(`  ⏭️  Affiliate #${aff.id}: source_groups inválido JSON, pulando`);
      skipped++;
      continue;
    }

    try {
      tgtGroups = typeof aff.target_groups === 'string'
        ? JSON.parse(aff.target_groups as string)
        : ((aff.target_groups as { jid: string; name: string }[] | null) ?? []);
    } catch {
      tgtGroups = [];
    }

    if (!srcGroups || srcGroups.length === 0) {
      console.log(`  ⏭️  Affiliate #${aff.id} (user ${userId}): sem sourceGroups, pulando`);
      skipped++;
      continue;
    }

    // Verifica se já existe mirror para este userId
    const existing = await mirrorRepo.list({ userId, page: 1, pageSize: 1 });
    if (existing.total > 0) {
      console.log(`  ⏭️  Affiliate #${aff.id} (user ${userId}): mirror "${existing.rows[0]!.name}" já existe, pulando`);
      skipped++;
      continue;
    }

    // Cria o mirror
    try {
      const mirror = await mirrorRepo.create({
        name: 'Espelhamento Padrão',
        status: 'active',
        userId,
        sourceGroups: srcGroups,
        targetGroups: tgtGroups,
        messageTemplate: (aff.message_template as string) ?? null,
      });

      console.log(`  ✅ Affiliate #${aff.id} (user ${userId}) → mirror #${mirror.id} "${mirror.name}" criado`);
      console.log(`     SourceGroups: ${srcGroups.map((g) => g.name).join(', ')}`);
      console.log(`     TargetGroups: ${tgtGroups.map((g) => g.name).join(', ')}`);
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
