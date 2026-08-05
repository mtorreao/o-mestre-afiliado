/**
 * Constantes e helpers para chaves do Redis compartilhadas entre apps que
 * usam feature flags. Separa o formato de chave do resto da infra Redis para
 * que mudanças de schema sejam feitas num único lugar.
 *
 * Especificação:
 *   - `omestre:flag:stats:{key}:{YYYYMMDDHHMM}` — bucket de 1 minuto p/ métrica
 *     de impacto (quantas vezes a flag foi consultada).
 *   - `omestre:flag:invalidate`                   — canal PubSub p/ invalidação
 *     de cache (mensagem = key da flag a invalidar).
 */

export const FLAG_STATS_KEY_PREFIX = 'omestre:flag:stats:';
export const FLAG_INVALIDATE_CHANNEL = 'omestre:flag:invalidate';

/**
 * Formato do bucket de tempo usado como sufixo da chave de métrica.
 * Mantido em UTC para garantir consistência entre processos espalhados
 * por fusos diferentes.
 */
export type FlagStatsBucket = `${number}`; // YYYYMMDDHHMM

/**
 * Gera a chave Redis de stats para um bucket de minuto específico.
 * Aceita `Date` ou número Epoch em ms.
 */
export function buildFlagStatsKey(flagKey: string, date: Date | number): string {
  const ts = typeof date === 'number' ? date : date.getTime();
  return `${FLAG_STATS_KEY_PREFIX}${flagKey}:${bucketAt(ts)}`;
}

/**
 * Serializa um instante no formato `YYYYMMDDHHMM` (UTC).
 * Exposto publicamente para reuso na métrica (countFlagChecks).
 */
export function bucketAt(epochMs: number): FlagStatsBucket {
  const d = new Date(epochMs);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mi = d.getUTCMinutes().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}` as FlagStatsBucket;
}
