import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Schema Postgres `omestre_admin` — dedicado ao admin-api.
 *
 * Decisão (rodada 3 do desenho): mesmo Postgres do Contabo, schema
 * separado dos existentes (`omestre`, `evolution_api`). Permite JOIN
 * direto entre app + admin, e um único backup cobre tudo.
 *
 * Aplica princípio de "single database, separate schemas" — o admin-api
 * compartilha a instância Postgres `omestre_db` mas opera em tabelas
 * próprias, isoladas das tabelas do app e da Evolution API.
 */
export const omestreAdmin = pgSchema('omestre_admin');
