/**
 * Conexão com PostgreSQL via `postgres` (porsager/postgres).
 *
 * Uso:
 *   import { db } from '@omestre/db';
 *   const rows = await db.select().from(affiliates);
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

/**
 * Retorna a URL de conexão ao banco.
 *
 * Prioridade:
 *   1. POSTGRES_URL (para apps dentro do Docker, URI completa)
 *   2. Constroi a partir de variáveis individuais
 */
function getConnectionUrl(): string {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;

  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT ? String(process.env.POSTGRES_PORT) : '5443';
  const user = process.env.POSTGRES_USERNAME || 'evolution';
  const password = process.env.POSTGRES_PASSWORD || 'evolution_pass';
  const database = process.env.POSTGRES_DATABASE || 'omestre_db';
  const schema = process.env.POSTGRES_SCHEMA || 'omestre';

  return `postgresql://${user}:${password}@${host}:${port}/${database}?options=--search_path%3D${schema}`;
}

/**
 * Singleton query client.
 * Cada `drizzle()` cria um pool — mantemos um único.
 */
let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

/**
 * Inicia ou retorna a conexão Drizzle já existente.
 * Thread-safe para Bun (single-threaded).
 */
export function getDb() {
  if (_db) return _db;

  const url = getConnectionUrl();
  _client = postgres(url, {
    max: 5,            // máximo de conexões no pool
    ssl: false,
    prepare: false,    // Bun não suporta prepared statements nomeados
    connect_timeout: 10,   // segundos — não travar se banco estiver offline
    idle_timeout: 15,      // segundos — conexão ociosa é reciclada
    max_lifetime: 60 * 5,  // segundos — reconecta periodicamente
    connection: {
      statement_timeout: 15000,  // ms — query lenta é cancelada
    },
  });

  _db = drizzle(_client, { schema });
  return _db;
}

/**
 * Encerra o pool de conexões (graceful shutdown).
 */
export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

/**
 * Verifica se o banco está respondendo.
 * Retorna { ok, latencyMs } ou lança erro com a mensagem.
 */
export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  const client = getClient();
  await client`SELECT 1`;
  return { ok: true, latencyMs: Date.now() - start };
}

/**
 * Para uso direto (raw queries) quando necessário.
 */
export function getClient() {
  if (_client) return _client;
  getDb();
  return _client!;
}
