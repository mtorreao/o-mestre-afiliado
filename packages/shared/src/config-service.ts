/**
 * config-service — Loader centralizado de variáveis de ambiente.
 *
 * Substitui leituras dispersas de `process.env` espalhadas pelos apps.
 * Cada app define seu schema declarativamente e o loader:
 *  - Lê uma vez (singleton) por service
 *  - Valida tipos (string, number, boolean, enum)
 *  - Aplica defaults por service
 *  - Falha rápido no startup se obrigatória ausente
 *
 * Design simples:
 *  - Builders (`str`, `num`, `bool`, `enumVar`) aceitam o nome da env var
 *    como primeiro argumento. Cada builder retorna um descritor que
 *    carrega o nome internamente — não precisa do nome da chave do schema.
 *  - `loadConfig(service, schema)` retorna objeto tipado (lazy singleton)
 *  - `resetConfigForTest(service?)` reseta o cache (para testes)
 *
 * Uso:
 *   // config.ts do app:
 *   import { loadConfig, str, num } from '@omestre/shared/config-service';
 *   export const config = loadConfig('api', {
 *     port:        num('API_PORT', { default: 5442 }),
 *     redisUrl:    str('REDIS_URL'),
 *     evolutionUrl: str('EVOLUTION_API_URL', { default: 'http://localhost:5444' }),
 *   });
 *
 *   // index.ts:
 *   import { config } from './config.ts';
 *   server.listen(config.port);
 */

import { makeLogger } from './logger.ts';

const log = makeLogger('config-service');

// ─── Schema types ─────────────────────────────────────────────────────

export type ConfigType =
  | { kind: 'string'; envName: string; required?: boolean; default?: string }
  | { kind: 'number'; envName: string; required?: boolean; default?: number }
  | { kind: 'boolean'; envName: string; required?: boolean; default?: boolean }
  | {
      kind: 'enum';
      envName: string;
      values: readonly string[];
      required?: boolean;
      default?: string;
    };

export type Schema = Record<string, ConfigType>;

/**
 * Infere o tipo TypeScript a partir de um Schema.
 *
 * Exemplo:
 *   type S = { port: { kind: 'number'; envName: 'API_PORT'; default: 5442 } }
 *   type T = InferSchema<S>  // → { port: number }
 */
export type InferSchema<S extends Schema> = {
  [K in keyof S]: S[K] extends { kind: 'string' }
    ? string
    : S[K] extends { kind: 'number' }
      ? number
      : S[K] extends { kind: 'boolean' }
        ? boolean
        : S[K] extends { kind: 'enum'; values: readonly (infer V)[] }
          ? V
          : never;
};

// ─── Builders (mais ergonômicos que objetos literais) ────────────────

/** Define uma env var string. */
export function str(envName: string, opts?: { required?: boolean; default?: string }) {
  return { kind: 'string' as const, envName, ...opts };
}

/** Define uma env var number. */
export function num(envName: string, opts?: { required?: boolean; default?: number }) {
  return { kind: 'number' as const, envName, ...opts };
}

/** Define uma env var boolean ("true" / "1" = true; resto = false). */
export function bool(envName: string, opts?: { required?: boolean; default?: boolean }) {
  return { kind: 'boolean' as const, envName, ...opts };
}

/** Define uma env var com valores permitidos. */
export function enumVar<T extends string>(
  envName: string,
  values: readonly T[],
  opts?: { required?: boolean; default?: T },
) {
  return { kind: 'enum' as const, envName, values, ...opts };
}

// ─── Loader (singleton lazy) ──────────────────────────────────────────

const cache = new Map<string, Record<string, unknown>>();

/**
 * Carrega (ou retorna cache) das env vars conforme o schema do app.
 *
 * Falha rápido (throw) se uma var obrigatória estiver ausente ou tiver
 * tipo inválido. Em produção isso é o desejado — config errada deve
 * impedir o startup.
 *
 * Use `resetConfigForTest(service?)` para resetar entre casos de teste.
 */
export function loadConfig<S extends Schema>(
  service: string,
  schema: S,
): { readonly [K in keyof S]: InferSchema<S>[K] } {
  const cached = cache.get(service);
  if (cached) {
    return cached as { readonly [K in keyof S]: InferSchema<S>[K] };
  }

  const result: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(schema)) {
    result[key] = parseValue(service, type);
  }

  cache.set(service, result);
  return result as { readonly [K in keyof S]: InferSchema<S>[K] };
}

/**
 * Reseta o cache de config para um app. Apenas para testes.
 */
export function resetConfigForTest(service?: string): void {
  if (service) {
    cache.delete(service);
  } else {
    cache.clear();
  }
}

// ─── Internals ────────────────────────────────────────────────────────

function parseValue(service: string, type: ConfigType): unknown {
  const { kind, envName, default: def, required } = type;
  const raw = process.env[envName];

  if (raw === undefined || raw === '') {
    if (def !== undefined) return def;
    if (required) {
      throw new Error(`[${service}] env var obrigatória ausente: ${envName}`);
    }
    return undefined;
  }

  switch (kind) {
    case 'string':
      return raw;

    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`[${service}] ${envName} inválida: "${raw}" não é número`);
      }
      return n;
    }

    case 'boolean':
      return raw === 'true' || raw === '1';

    case 'enum': {
      if (!type.values.includes(raw)) {
        throw new Error(
          `[${service}] ${envName} inválida: "${raw}" não está em [${type.values.join(', ')}]`,
        );
      }
      return raw;
    }
  }
}

// ─── Helpers para uso comum ───────────────────────────────────────────

/**
 * Schema base compartilhado entre todos os apps. Cada app pode estender
 * com seus próprios campos (API_PORT, BLACKLIST_PATH, etc).
 *
 * Defaults refletem o ambiente Docker local (portas 5444/5455).
 * Em produção, basta definir as env vars correspondentes.
 */
export const baseConfigSchema = {
  REDIS_URL: str('REDIS_URL', { default: 'redis://localhost:5455' }),
  EVOLUTION_API_URL: str('EVOLUTION_API_URL', { default: 'http://localhost:5444' }),
  EVOLUTION_API_KEY: str('EVOLUTION_API_KEY'),
} as const;

/**
 * Carrega o config base compartilhado.
 */
export function loadBaseConfig() {
  return loadConfig('base', baseConfigSchema);
}
