/**
 * Lógica PURA de manipulação de tracking IDs da Amazon.
 *
 * Separa as operações de array (adicionar/remover/atualizar/consultar
 * tracking IDs) da camada de I/O (DB). Todas as funções aqui são
 * síncronas, não dependem de serviços externos e são 100% testáveis
 * sem conexão ao PostgreSQL.
 *
 * Mantém as regras de negócio:
 *  - Limite de 100 tracking IDs (Amazon Associates).
 *  - Primeiro ID vira `isDefault` automaticamente.
 *  - Ao remover o default, o primeiro `active` restante é promovido.
 *  - Ao marcar `isDefault: true` num ID, os demais são desmarcados.
 */
import type { AmazonAffiliate, AmazonTrackingIdInput } from './amazonAffiliates.repository.ts';
import type { AmazonTrackingId } from '../schema/index.ts';
import { detectRegion } from './amazonAffiliates.repository.ts';

// Re-exporta detectRegion (helper de região) para centralizar as puras
// de tracking ID da Amazon neste módulo.
export { detectRegion };

export const MAX_TRACKING_IDS = 100;

/**
 * Constrói um TrackingId a partir do input, derivando região e default.
 * `createdAt` é gerado no momento da criação (caller pode sobrescrever
 * via input em casos de replay, mas o padrão é now).
 */
export function buildTrackingId(
  input: AmazonTrackingIdInput,
  current: AmazonTrackingId[],
  now: () => string = () => new Date().toISOString(),
): AmazonTrackingId {
  const hasAnyDefault = current.some((t) => t.isDefault);
  return {
    tag: input.tag,
    label: input.label,
    region: input.region ?? detectRegion(input.tag),
    active: input.active ?? true,
    isDefault: input.isDefault ?? !hasAnyDefault,
    createdAt: now(),
  };
}

/**
 * Adiciona um tracking ID ao array atual.
 * Lança Error se exceder MAX_TRACKING_IDS.
 * Retorna um NOVO array (não muta o original).
 */
export function addTrackingIdPure(
  current: AmazonTrackingId[],
  input: AmazonTrackingIdInput,
  now: () => string = () => new Date().toISOString(),
): AmazonTrackingId[] {
  const base = current ?? [];
  if (base.length >= MAX_TRACKING_IDS) {
    throw new Error(
      `Limite de ${MAX_TRACKING_IDS} tracking IDs por afiliado excedido (regra Amazon Associates)`,
    );
  }
  return [...base, buildTrackingId(input, base, now)];
}

/**
 * Remove um tracking ID pelo tag.
 * Se removeu o default, promove o primeiro `active` restante a default.
 * Retorna um NOVO array (não muta o original).
 */
export function removeTrackingIdPure(current: AmazonTrackingId[], tag: string): AmazonTrackingId[] {
  const base = current ?? [];
  const filtered = base.filter((t) => t.tag !== tag);
  if (filtered.length === base.length) return base; // tag não existia

  const wasDefaultRemoved = base.find((t) => t.tag === tag)?.isDefault ?? false;
  if (wasDefaultRemoved) {
    const firstActive = filtered.find((t) => t.active);
    if (firstActive) firstActive.isDefault = true;
  }
  return filtered;
}

/**
 * Atualiza campos parciais de um tracking ID (label, active, isDefault).
 * Se marcou `isDefault: true`, desmarca os outros. `tag` e `createdAt`
 * são imutáveis.
 * Retorna um NOVO array (não muta o original). Se o tag não existe,
 * retorna o array original inalterado.
 */
export function updateTrackingIdPure(
  current: AmazonTrackingId[],
  tag: string,
  patch: Partial<Omit<AmazonTrackingId, 'tag' | 'createdAt'>>,
): AmazonTrackingId[] {
  const base = current ?? [];
  const idx = base.findIndex((t) => t.tag === tag);
  if (idx === -1) return base;

  const updated = [...base];
  const currentItem = updated[idx]!;
  const patched: AmazonTrackingId = { ...currentItem, ...patch };

  if (patch.isDefault === true) {
    updated.forEach((t, i) => {
      if (i !== idx) t.isDefault = false;
    });
  }

  updated[idx] = patched;
  return updated;
}

/**
 * Retorna o tag do tracking ID default ATIVO.
 * `null` se não houver nenhum default ativo.
 */
export function getDefaultTrackingIdPure(
  trackingIds: AmazonTrackingId[] | null | undefined,
): string | null {
  const ids = trackingIds ?? [];
  const defaultItem = ids.find((t) => t.isDefault && t.active);
  return defaultItem?.tag ?? null;
}

/**
 * Retorna o tag de um tracking ID específico, validando que está ativo.
 * `null` se não existir ou não estiver ativo.
 */
export function getActiveTrackingIdPure(
  trackingIds: AmazonTrackingId[] | null | undefined,
  tag: string,
): string | null {
  const ids = trackingIds ?? [];
  const item = ids.find((t) => t.tag === tag && t.active);
  return item?.tag ?? null;
}

/**
 * Constrói o sumário de um afiliado Amazon (contagem de ativos, etc.).
 * Função pura sobre o modelo persistido.
 */
export function toAmazonSummary(affiliate: AmazonAffiliate): {
  id: number;
  userId: number;
  nickname: string | null;
  trackingIds: AmazonTrackingId[];
  activeTrackingCount: number;
  active: boolean;
  connectedAt: Date;
  lastUsedAt: Date;
} {
  const ids: AmazonTrackingId[] = affiliate.trackingIds ?? [];
  return {
    id: affiliate.id,
    userId: affiliate.userId,
    nickname: affiliate.nickname,
    trackingIds: ids,
    activeTrackingCount: ids.filter((t) => t.active).length,
    active: affiliate.active,
    connectedAt: affiliate.connectedAt,
    lastUsedAt: affiliate.lastUsedAt,
  };
}
