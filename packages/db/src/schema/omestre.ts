import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Schema \"omestre\" — isolado do schema \"evolution_api\" usado pela Evolution API.
 * Definido em arquivo separado para evitar circular dependency.
 */
export const omestre = pgSchema('omestre');
