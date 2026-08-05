/**
 * Conexão Postgres do admin-api (mesmo cluster do app principal).
 *
 * Schema: `omestre_admin` (separado dos schemas `omestre` e `evolution_api`).
 *
 * Variáveis de ambiente (todas já existem no .env do projeto):
 *   POSTGRES_HOST       default: postgres
 *   POSTGRES_PORT       default: 5432
 *   POSTGRES_USERNAME   default: evolution
 *   POSTGRES_PASSWORD   required
 *   POSTGRES_DATABASE   default: omestre_db
 *
 * Sem POSTGRES_URL — construímos a connection string com search_path
 * apontando para `omestre_admin` (assim Drizzle não precisa qualificar
 * schema em cada query).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export interface AdminDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  schema: string;
}

/**
 * Monta URL de conexão com search_path pré-fixado. Garante que
 * **todas** as queries do admin-api operem no schema `omestre_admin`,
 * mesmo que outras tabelas (omestre, evolution_api) coexistam.
 */
export function buildAdminDbUrl(config: AdminDbConfig): string {
  const user = encodeURIComponent(config.user);
  const pass = encodeURIComponent(config.password);
  const host = config.host;
  const port = config.port;
  const db = config.database;
  const schema = config.schema;
  return `postgresql://${user}:${pass}@${host}:${port}/${db}?options=-c%20search_path%3D${schema}`;
}

export function readAdminDbConfig(
  env: Record<string, string | undefined> = process.env,
): AdminDbConfig {
  const password = env['POSTGRES_PASSWORD'];
  if (!password) {
    throw new Error('admin-db: POSTGRES_PASSWORD is required');
  }
  return {
    host: env['POSTGRES_HOST'] ?? 'postgres',
    port: Number(env['POSTGRES_PORT'] ?? '5432'),
    user: env['POSTGRES_USERNAME'] ?? 'evolution',
    password,
    database: env['POSTGRES_DATABASE'] ?? 'omestre_db',
    schema: env['POSTGRES_ADMIN_SCHEMA'] ?? 'omestre_admin',
  };
}

export type AdminDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Cria a conexão Drizzle. Use `await client.end()` no shutdown.
 *
 * O Postgres client (`postgres.js`) gerencia o pool internamente.
 * Limite de 5 conexões é suficiente para um admin-api single-user.
 */
export function createAdminDb(config: AdminDbConfig): AdminDb {
  const url = buildAdminDbUrl(config);
  const client = postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false, // pgcrypto + search_path nem sempre funciona com prepared
  });
  return drizzle(client, { schema });
}
