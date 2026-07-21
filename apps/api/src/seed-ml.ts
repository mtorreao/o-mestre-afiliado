/**
 * Seed: migra dados do JSON store legado para o PostgreSQL.
 *
 * Uso:
 *   bun run src/seed-ml.ts
 *
 * (de dentro do workspace apps/api, que tem @omestre/db como dependência)
 *
 * Lê data/ml-affiliates.json e faz upsert na tabela omestre.ml_affiliates.
 * Idempotente — pode rodar múltiplas vezes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MlAffiliateRepository } from '@omestre/db';

const STORE_PATH = join(import.meta.dir, '../../../data/ml-affiliates.json');

interface JsonAffiliateRecord {
  mlUserId: string;
  nickname: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  connectedAt: string;
  lastUsedAt: string;
  meliid?: string;
  melitat?: string;
  sessionCookies?: string;
}

async function main() {
  if (!existsSync(STORE_PATH)) {
    console.log(`❌ JSON store não encontrado: ${STORE_PATH}`);
    process.exit(1);
  }

  const raw = readFileSync(STORE_PATH, 'utf-8');
  const store: Record<string, JsonAffiliateRecord> = JSON.parse(raw);
  const entries = Object.values(store);

  if (entries.length === 0) {
    console.log('⚠️  Nenhum afiliado no JSON store.');
    process.exit(0);
  }

  console.log(`📄 Lidos ${entries.length} afiliado(s) do JSON.`);

  const repo = new MlAffiliateRepository();
  let imported = 0;
  let updated = 0;

  for (const record of entries) {
    const existing = await repo.findByUserId(record.mlUserId);

    if (existing) {
      await repo.upsert({
        mlUserId: record.mlUserId,
        nickname: record.nickname,
        accessToken: record.accessToken,
        refreshToken: record.refreshToken,
        expiresIn: Math.max(1, Math.floor((new Date(record.expiresAt).getTime() - Date.now()) / 1000)),
        connectedAt: existing.connectedAt,
        meliid: existing.meliid ?? record.meliid ?? null,
        melitat: existing.melitat ?? record.melitat ?? null,
        sessionCookies: existing.sessionCookies ?? record.sessionCookies ?? null,
      });
      updated++;
    } else {
      await repo.upsert({
        mlUserId: record.mlUserId,
        nickname: record.nickname,
        accessToken: record.accessToken,
        refreshToken: record.refreshToken,
        expiresIn: Math.max(1, Math.floor((new Date(record.expiresAt).getTime() - Date.now()) / 1000)),
        connectedAt: new Date(record.connectedAt),
        meliid: record.meliid ?? null,
        melitat: record.melitat ?? null,
        sessionCookies: record.sessionCookies ?? null,
      });
      imported++;
    }
  }

  const all = await repo.findAll();
  console.log(`✅ Seed concluído: ${imported} importados, ${updated} atualizados.`);
  console.log(`📊 Total no banco: ${all.length} afiliado(s).`);

  for (const a of all) {
    const status = a.expired ? '🔴 expirado' : '🟢 ativo';
    console.log(`  ${a.nickname.padEnd(16)} ${status}  cookies:${a.hasSessionCookies ? '✅' : '❌'}  melitat:${a.melitat ?? '—'}`);
  }
}

main().catch((err) => {
  console.error('❌ Erro no seed:', err);
  process.exit(1);
});
