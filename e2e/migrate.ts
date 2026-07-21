/**
 * Script de migração automática para E2E.
 * Conecta ao banco e aplica as migrations pendentes.
 *
 * Uso: bun run e2e/migrate.ts
 */

import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error('POSTGRES_URL não definida');
  process.exit(1);
}

const MIGRATIONS_DIR = join(import.meta.dir, '../packages/db/src/migrations');

// Lê o journal para saber quais migrations já foram aplicadas
const journalPath = join(MIGRATIONS_DIR, 'meta/_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
const entries = journal.entries as Array<{ tag: string; idx: number }>;

console.log(`⏳ Aplicando ${entries.length} migration(s)...`);

const sql = postgres(url, { max: 1 });

try {
  // Cria tabela de controle se não existir
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS omestre.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    );
  `);

  // Busca migrations já aplicadas
  const applied = await sql.unsafe<Array<{ hash: string }>>(
    `SELECT hash FROM omestre.__drizzle_migrations`,
  );
  const appliedSet = new Set(applied.map((r) => r.hash));

  for (const entry of entries) {
    if (appliedSet.has(entry.tag)) {
      console.log(`  ↺ ${entry.tag} — já aplicada`);
      continue;
    }

    const filePath = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    const sqlContent = readFileSync(filePath, 'utf-8');

    // Divide em statements (separados por --> statement-breakpoint)
    const statements = sqlContent
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }

    await sql.unsafe(
      `INSERT INTO omestre.__drizzle_migrations (hash) VALUES ($1)`,
      [entry.tag],
    );

    console.log(`  ✓ ${entry.tag} — aplicada`);
  }

  console.log('✅ Migrations concluídas');
} finally {
  await sql.end();
}
