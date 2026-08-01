/**
 * Rotas CRUD para espelhamentos (mirrors).
 *
 * Endpoints:
 *   GET    /api/mirrors            — Listar espelhamentos (paginado)
 *   GET    /api/mirrors/:id        — Detalhe de um espelhamento
 *   POST   /api/mirrors            — Criar espelhamento
 *   PUT    /api/mirrors/:id        — Atualizar espelhamento
 *   PATCH  /api/mirrors/:id/status — Ativar/desativar espelhamento
 *   DELETE /api/mirrors/:id        — Excluir espelhamento
 *
 * Arquitetura: middleware (auth) → routes (validação + orquestração) → repository
 */
import { Elysia, t } from 'elysia';
import { MirrorRepository, AffiliatesRepository } from '@omestre/db';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import { replaceSourceGroups, removeSourceGroups } from '../../services/group-cache.ts';
import { fetchGroups, instanceNameFromUserId } from '../../services/evolution.ts';
import {
  parseListQuery,
  parseIdParam,
  isValidMirrorStatus,
  buildInvalidStatusError,
  buildCreateMirrorInput,
  buildUpdateData,
  updateTouchesSourceGroups,
  hasSourceGroups,
  sourceGroupJids,
  buildErrorResult,
  buildDetailResponse,
  buildListResponse,
  buildDeletedResponse,
  type GroupItem,
} from './mirrors-pure.ts';

const mirrorRepo = new MirrorRepository();
const affiliatesRepo = new AffiliatesRepository();

async function findUnauthorizedTargetGroup(
  userId: number,
  targetGroups: GroupItem[] | undefined,
): Promise<GroupItem | null> {
  if (!targetGroups?.length) return null;
  const result = await fetchGroups(instanceNameFromUserId(userId));
  const adminJids = new Set(
    result.groups?.filter((group) => group.isAdmin).map((group) => group.jid),
  );
  return targetGroups.find((group) => !adminJids.has(group.jid)) ?? null;
}

// ─── Schemas de validação (Zod via Elysia t) ─────────────────────────

const groupItemSchema = t.Object({
  jid: t.String(),
  name: t.String(),
});

const createBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  status: t.Optional(t.String()), // default 'active'
  sourceGroups: t.Optional(t.Array(groupItemSchema)),
  targetGroups: t.Optional(t.Array(groupItemSchema)),
  messageTemplate: t.Optional(t.Nullable(t.String())),
  subRateLimitMaxMsgs: t.Optional(t.Nullable(t.Number())),
  subRateLimitWindowSec: t.Optional(t.Nullable(t.Number())),
});

const updateBodySchema = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  status: t.Optional(t.String()),
  sourceGroups: t.Optional(t.Array(groupItemSchema)),
  targetGroups: t.Optional(t.Array(groupItemSchema)),
  messageTemplate: t.Optional(t.Nullable(t.String())),
  subRateLimitMaxMsgs: t.Optional(t.Nullable(t.Number())),
  subRateLimitWindowSec: t.Optional(t.Nullable(t.Number())),
});

const patchStatusBodySchema = t.Object({
  status: t.String({ minLength: 1 }),
});

// ─── Routes ──────────────────────────────────────────────────────────

export const mirrorRoutes = new Elysia()
  .use(createJwtPlugin())

  // ─── GET /api/mirrors — Listar (paginado) ─────────────────────────
  .get(
    '/api/mirrors',
    async ({ jwt, request, set, query }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return buildErrorResult('Não autenticado');
      }

      const { status, search, page, pageSize } = parseListQuery(query);

      const result = await mirrorRepo.list({
        status,
        search,
        userId: auth.userId,
        page,
        pageSize,
      });

      return buildListResponse(result);
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    },
  )

  // ─── GET /api/mirrors/:id — Detalhe ───────────────────────────────
  .get(
    '/api/mirrors/:id',
    async ({ jwt, request, set, params }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return buildErrorResult('Não autenticado');
      }

      const idParsed = parseIdParam(params.id);
      if (!idParsed.ok) {
        set.status = 400;
        return buildErrorResult('ID inválido');
      }
      const id = idParsed.id;

      const mirror = await mirrorRepo.findById(id);
      if (!mirror || mirror.userId !== auth.userId) {
        set.status = 404;
        return buildErrorResult('Espelhamento não encontrado');
      }

      return buildDetailResponse(mirror);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // ─── POST /api/mirrors — Criar ────────────────────────────────────
  .post(
    '/api/mirrors',
    async ({ jwt, request, set, body }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return buildErrorResult('Não autenticado');
      }

      const unauthorizedTarget = await findUnauthorizedTargetGroup(auth.userId, body.targetGroups);
      if (unauthorizedTarget) {
        set.status = 400;
        return buildErrorResult(
          `Você precisa ser administrador do grupo de destino "${unauthorizedTarget.name}"`,
        );
      }

      const mirror = await mirrorRepo.create(buildCreateMirrorInput(body, auth.userId));

      // Popula cache Redis com os sourceGroups do novo mirror
      if (hasSourceGroups(mirror.sourceGroups as GroupItem[] | null)) {
        const instanceName = instanceNameFromUserId(auth.userId);
        const affiliate = await affiliatesRepo.findByEvolutionInstanceId(instanceName);
        if (affiliate) {
          await replaceSourceGroups(
            [], // oldGroups: vazio (mirror novo)
            mirror.sourceGroups as { jid: string; name: string }[],
            affiliate.id,
            mirror.id, // mirrorId — marca que este grupo pertence a um mirror
          );
        }
      }

      return buildDetailResponse(mirror);
    },
    {
      body: createBodySchema,
    },
  )

  // ─── PUT /api/mirrors/:id — Atualizar ─────────────────────────────
  .put(
    '/api/mirrors/:id',
    async ({ jwt, request, set, params, body }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return buildErrorResult('Não autenticado');
      }

      const idParsed = parseIdParam(params.id);
      if (!idParsed.ok) {
        set.status = 400;
        return buildErrorResult('ID inválido');
      }
      const id = idParsed.id;

      const unauthorizedTarget = await findUnauthorizedTargetGroup(auth.userId, body.targetGroups);
      if (unauthorizedTarget) {
        set.status = 400;
        return buildErrorResult(
          `Você precisa ser administrador do grupo de destino "${unauthorizedTarget.name}"`,
        );
      }

      const updateData = buildUpdateData(body);

      // Busca o mirror ANTES de atualizar para ter a lista antiga de sourceGroups
      const currentMirror = await mirrorRepo.findById(id);
      if (!currentMirror || currentMirror.userId !== auth.userId) {
        set.status = 404;
        return buildErrorResult('Espelhamento não encontrado');
      }
      const oldSourceGroups =
        (currentMirror?.sourceGroups as { jid: string; name: string }[]) ?? [];

      const mirror = await mirrorRepo.update(id, updateData);
      if (!mirror) {
        set.status = 404;
        return buildErrorResult('Espelhamento não encontrado');
      }

      // Atualiza cache Redis se os sourceGroups mudaram
      if (updateTouchesSourceGroups(body)) {
        const instanceName = instanceNameFromUserId(auth.userId);
        const affiliate = await affiliatesRepo.findByEvolutionInstanceId(instanceName);
        if (affiliate) {
          await replaceSourceGroups(
            oldSourceGroups,
            body.sourceGroups ?? [],
            affiliate.id,
            mirror.id, // mirrorId
          );
        }
      }

      return buildDetailResponse(mirror);
    },
    {
      params: t.Object({ id: t.String() }),
      body: updateBodySchema,
    },
  )

  // ─── PATCH /api/mirrors/:id/status — Ativar/Desativar ─────────────
  .patch(
    '/api/mirrors/:id/status',
    async ({ jwt, request, set, params, body }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return buildErrorResult('Não autenticado');
      }

      const idParsed = parseIdParam(params.id);
      if (!idParsed.ok) {
        set.status = 400;
        return buildErrorResult('ID inválido');
      }
      const id = idParsed.id;

      if (!isValidMirrorStatus(body.status)) {
        set.status = 400;
        return buildErrorResult(buildInvalidStatusError());
      }

      const mirror = await mirrorRepo.patchStatus(id, body.status);
      if (!mirror || mirror.userId !== auth.userId) {
        set.status = 404;
        return buildErrorResult('Espelhamento não encontrado');
      }

      // Se desativou, remove sourceGroups do cache Redis
      // Se ativou, adiciona de volta
      if (body.status === 'inactive') {
        const groups = mirror.sourceGroups as { jid: string; name: string }[] | null;
        if (hasSourceGroups(groups)) {
          await removeSourceGroups(sourceGroupJids(groups));
        }
      } else if (body.status === 'active') {
        // Re-popula cache ao reativar
        const instanceName = instanceNameFromUserId(auth.userId);
        const affiliate = await affiliatesRepo.findByEvolutionInstanceId(instanceName);
        if (affiliate) {
          const groups = mirror.sourceGroups as { jid: string; name: string }[] | null;
          if (hasSourceGroups(groups)) {
            await replaceSourceGroups(
              [], // oldGroups: vazio (reativando)
              groups as { jid: string; name: string }[],
              affiliate.id,
              mirror.id,
            );
          }
        }
      }

      return buildDetailResponse(mirror);
    },
    {
      params: t.Object({ id: t.String() }),
      body: patchStatusBodySchema,
    },
  )

  // ─── DELETE /api/mirrors/:id — Excluir ────────────────────────────
  .delete(
    '/api/mirrors/:id',
    async ({ jwt, request, set, params }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return buildErrorResult('Não autenticado');
      }

      const idParsed = parseIdParam(params.id);
      if (!idParsed.ok) {
        set.status = 400;
        return buildErrorResult('ID inválido');
      }
      const id = idParsed.id;

      // Busca o mirror ANTES de deletar para ter os sourceGroups e limpar o cache
      const existingMirror = await mirrorRepo.findById(id);
      if (!existingMirror) {
        set.status = 404;
        return buildErrorResult('Espelhamento não encontrado');
      }

      const deleted = await mirrorRepo.delete(id);
      if (!deleted) {
        set.status = 404;
        return buildErrorResult('Espelhamento não encontrado');
      }

      // Remove sourceGroups do cache Redis
      const groups = existingMirror.sourceGroups as { jid: string; name: string }[] | null;
      if (hasSourceGroups(groups)) {
        await removeSourceGroups(sourceGroupJids(groups));
      }

      return buildDeletedResponse('Espelhamento excluído com sucesso');
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
