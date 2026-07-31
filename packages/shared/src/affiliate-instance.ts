/**
 * affiliate-instance — Convenção de nomenclatura de instâncias Evolution.
 *
 * Instâncias de afiliados seguem o padrão `user-{userId}` (ex: "user-7").
 * Este módulo concentra o parse — usado pela API (criação de instância),
 * pelo Ingestor (fan-out do CatalogJob) e pelo backfill do CatalogWorker.
 *
 * Função PURA — sem I/O.
 */

/**
 * Extrai o userId de plataforma de um instanceName no formato `user-<id>`.
 * Retorna null se não casar (ex.: instâncias de dispatcher, `dispatch-x`).
 */
export function parseAffiliateUserId(instanceName: string): number | null {
  const match = instanceName.match(/^user-(\d+)$/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}
