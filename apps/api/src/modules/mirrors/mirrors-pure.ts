/**
 * mirrors-pure.ts — Lógica PURA (sem I/O) das rotas de espelhamentos.
 *
 * Separa a parte de DECISÃO/CONSTRUÇÃO das rotas HTTP (parse de query
 * params, validação de body, normalização de id, montagem do input do
 * repositório e do envelope de resposta) da camada de I/O (repo DB, Redis,
 * Evolution). As funções aqui são síncronas e 100% testáveis sem conexão
 * real. A camada de I/O vive em `mirrors.routes.ts`, que importa e delega.
 *
 * IMPORTANTE: este módulo NÃO deve importar de `mirrors.routes.ts`
 * (circular import → TDZ).
 */
import type { MirrorListResponse } from '@omestre/db';

// ─── Tipos ─────────────────────────────────────────────────────────────

/** Status válidos para um espelhamento. */
export const VALID_MIRROR_STATUSES = ['active', 'inactive'] as const;
export type MirrorStatus = (typeof VALID_MIRROR_STATUSES)[number];

/** Shape estrutural de um grupo (source/target) nos bodies. */
export interface GroupItem {
  jid: string;
  name: string;
}

/** Shape estrutural do body de criação (POST). */
export interface CreateMirrorBody {
  name: string;
  status?: string;
  sourceGroups?: GroupItem[];
  targetGroups?: GroupItem[];
  messageTemplate?: string | null;
  subRateLimitMaxMsgs?: number | null;
  subRateLimitWindowSec?: number | null;
}

/** Shape estrutural do body de atualização (PUT). */
export interface UpdateMirrorBody {
  name?: string;
  status?: string;
  sourceGroups?: GroupItem[];
  targetGroups?: GroupItem[];
  messageTemplate?: string | null;
  subRateLimitMaxMsgs?: number | null;
  subRateLimitWindowSec?: number | null;
}

// ─── Parse de query params (lista paginada) ────────────────────────────

export interface MirrorListQuery {
  status: string | undefined;
  search: string | undefined;
  page: number;
  pageSize: number;
}

/**
 * Faz o parse dos query params da listagem (todos chegam como string na
 * URL). Aplica defaults e protege contra NaN: page→1, pageSize→25.
 * `status`/`search` passam transparentes (undefined se ausentes).
 */
export function parseListQuery(query: {
  page?: string;
  pageSize?: string;
  status?: string;
  search?: string;
}): MirrorListQuery {
  const page = parseInt(query.page ?? '1', 10);
  const pageSize = parseInt(query.pageSize ?? '25', 10);
  return {
    status: query.status,
    search: query.search,
    page: isNaN(page) ? 1 : page,
    pageSize: isNaN(pageSize) ? 25 : pageSize,
  };
}

// ─── Parse/validação de :id ───────────────────────────────────────────

export type ParseIdResult = { ok: true; id: number } | { ok: false; reason: 'invalid' };

/**
 * Converte o parâmetro de rota `:id` (string) em número.
 * Retorna discriminated union para o handler decidir o status HTTP.
 */
export function parseIdParam(idStr: string): ParseIdResult {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return { ok: false, reason: 'invalid' };
  return { ok: true, id };
}

// ─── Validação de status (PATCH /:id/status) ──────────────────────────

/** Verifica se um status é aceito (active | inactive). */
export function isValidMirrorStatus(status: string): boolean {
  return (VALID_MIRROR_STATUSES as readonly string[]).includes(status);
}

/** Monta a mensagem de erro de status inválido. */
export function buildInvalidStatusError(): string {
  return `Status inválido. Valores aceitos: ${VALID_MIRROR_STATUSES.join(', ')}`;
}

// ─── Construção do input do repositório ───────────────────────────────

/** Monta o objeto de criação (NewMirror) a partir do body + userId. */
export function buildCreateMirrorInput(body: CreateMirrorBody, userId: number) {
  return {
    name: body.name,
    status: body.status ?? 'active',
    userId,
    sourceGroups: body.sourceGroups ?? [],
    targetGroups: body.targetGroups ?? [],
    messageTemplate: body.messageTemplate ?? null,
    subRateLimitMaxMsgs: body.subRateLimitMaxMsgs ?? null,
    subRateLimitWindowSec: body.subRateLimitWindowSec ?? null,
  };
}

/**
 * Monta o objeto de atualização parcial (PATCH semantics) a partir do body.
 * Só inclui os campos presentes (undefined → omitido).
 */
export function buildUpdateData(body: UpdateMirrorBody): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.sourceGroups !== undefined) updateData.sourceGroups = body.sourceGroups;
  if (body.targetGroups !== undefined) updateData.targetGroups = body.targetGroups;
  if (body.messageTemplate !== undefined) updateData.messageTemplate = body.messageTemplate;
  if (body.subRateLimitMaxMsgs !== undefined) {
    updateData.subRateLimitMaxMsgs = body.subRateLimitMaxMsgs;
  }
  if (body.subRateLimitWindowSec !== undefined) {
    updateData.subRateLimitWindowSec = body.subRateLimitWindowSec;
  }
  return updateData;
}

/** Indica se a atualização toca os sourceGroups (precisa recompor cache). */
export function updateTouchesSourceGroups(body: UpdateMirrorBody): boolean {
  return body.sourceGroups !== undefined;
}

// ─── Helpers de sourceGroups ──────────────────────────────────────────

/** Extrai os JIDs de uma lista de grupos (null/undefined → []). */
export function sourceGroupJids(
  groups: { jid: string; name?: string }[] | null | undefined,
): string[] {
  return (groups ?? []).map((g) => g.jid);
}

/** Verdadeiro se a lista de grupos existe e não está vazia. */
export function hasSourceGroups(
  groups: { jid: string; name?: string }[] | null | undefined,
): boolean {
  return Boolean(groups && groups.length > 0);
}

// ─── Envelopes de resposta ─────────────────────────────────────────────

/** Envelope de sucesso padrão para ações sem payload extra. */
export function buildSuccessResult(): { success: true } {
  return { success: true };
}

/** Envelope de erro padrão. */
export function buildErrorResult(error: string): { success: false; error: string } {
  return { success: false, error };
}

/** Resposta de detalhe (GET /:id e updates). */
export function buildDetailResponse<T>(mirror: T): { success: true; mirror: T } {
  return { success: true, mirror };
}

/** Resposta da listagem paginada — espalha o resultado do repositório. */
export function buildListResponse(result: MirrorListResponse): {
  success: true;
} & MirrorListResponse {
  return { success: true, ...result };
}

/** Resposta de exclusão (mensagem de confirmação). */
export function buildDeletedResponse(message: string): { success: true; message: string } {
  return { success: true, message };
}
