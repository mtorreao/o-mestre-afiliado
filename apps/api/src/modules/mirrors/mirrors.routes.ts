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
import { instanceNameFromUserId } from '../../services/evolution.ts';

const mirrorRepo = new MirrorRepository();
const affiliatesRepo = new AffiliatesRepository();

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
        return { success: false, error: 'Não autenticado' };
      }

      const page = parseInt(query.page ?? '1', 10);
      const pageSize = parseInt(query.pageSize ?? '25', 10);
      const status = query.status as string | undefined;
      const search = query.search as string | undefined;

      const result = await mirrorRepo.list({
        status,
        search,
        userId: auth.userId,
        page: isNaN(page) ? 1 : page,
        pageSize: isNaN(pageSize) ? 25 : pageSize,
      });

      return { success: true, ...result };
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
        return { success: false, error: 'Não autenticado' };
      }

      const id = parseInt(params.id, 10);
      if (isNaN(id)) {
        set.status = 400;
        return { success: false, error: 'ID inválido' };
      }

      const mirror = await mirrorRepo.findById(id);
      if (!mirror) {
        set.status = 404;
        return { success: false, error: 'Espelhamento não encontrado' };
      }

      return { success: true, mirror };
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
        return { success: false, error: 'Não autenticado' };
      }

      const mirror = await mirrorRepo.create({
        name: body.name,
        status: body.status ?? 'active',
        userId: auth.userId,
        sourceGroups: body.sourceGroups ?? [],
        targetGroups: body.targetGroups ?? [],
        messageTemplate: body.messageTemplate ?? null,
        subRateLimitMaxMsgs: body.subRateLimitMaxMsgs ?? null,
        subRateLimitWindowSec: body.subRateLimitWindowSec ?? null,
      });

      // Popula cache Redis com os sourceGroups do novo mirror
      if (mirror.sourceGroups && (mirror.sourceGroups as { jid: string; name: string }[]).length > 0) {
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

      return { success: true, mirror };
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
        return { success: false, error: 'Não autenticado' };
      }

      const id = parseInt(params.id, 10);
      if (isNaN(id)) {
        set.status = 400;
        return { success: false, error: 'ID inválido' };
      }

      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.sourceGroups !== undefined) updateData.sourceGroups = body.sourceGroups;
      if (body.targetGroups !== undefined) updateData.targetGroups = body.targetGroups;
      if (body.messageTemplate !== undefined) updateData.messageTemplate = body.messageTemplate;
      if (body.subRateLimitMaxMsgs !== undefined) updateData.subRateLimitMaxMsgs = body.subRateLimitMaxMsgs;
      if (body.subRateLimitWindowSec !== undefined) updateData.subRateLimitWindowSec = body.subRateLimitWindowSec;

      // Busca o mirror ANTES de atualizar para ter a lista antiga de sourceGroups
      const currentMirror = await mirrorRepo.findById(id);
      const oldSourceGroups = (currentMirror?.sourceGroups as { jid: string; name: string }[]) ?? [];

      const mirror = await mirrorRepo.update(id, updateData);
      if (!mirror) {
        set.status = 404;
        return { success: false, error: 'Espelhamento não encontrado' };
      }

      // Atualiza cache Redis se os sourceGroups mudaram
      if (body.sourceGroups !== undefined) {
        const instanceName = instanceNameFromUserId(auth.userId);
        const affiliate = await affiliatesRepo.findByEvolutionInstanceId(instanceName);
        if (affiliate) {
          await replaceSourceGroups(
            oldSourceGroups,
            body.sourceGroups,
            affiliate.id,
            mirror.id, // mirrorId
          );
        }
      }

      return { success: true, mirror };
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
        return { success: false, error: 'Não autenticado' };
      }

      const id = parseInt(params.id, 10);
      if (isNaN(id)) {
        set.status = 400;
        return { success: false, error: 'ID inválido' };
      }

      const validStatuses = ['active', 'inactive'];
      if (!validStatuses.includes(body.status)) {
        set.status = 400;
        return {
          success: false,
          error: `Status inválido. Valores aceitos: ${validStatuses.join(', ')}`,
        };
      }

      const mirror = await mirrorRepo.patchStatus(id, body.status);
      if (!mirror) {
        set.status = 404;
        return { success: false, error: 'Espelhamento não encontrado' };
      }

      // Se desativou, remove sourceGroups do cache Redis
      // Se ativou, adiciona de volta
      if (body.status === 'inactive') {
        const groups = mirror.sourceGroups as { jid: string; name: string }[] | null;
        if (groups && groups.length > 0) {
          await removeSourceGroups(groups.map((g) => g.jid));
        }
      } else if (body.status === 'active') {
        // Re-popula cache ao reativar
        const instanceName = instanceNameFromUserId(auth.userId);
        const affiliate = await affiliatesRepo.findByEvolutionInstanceId(instanceName);
        if (affiliate) {
          const groups = mirror.sourceGroups as { jid: string; name: string }[] | null;
          if (groups && groups.length > 0) {
            await replaceSourceGroups(
              [], // oldGroups: vazio (reativando)
              groups,
              affiliate.id,
              mirror.id,
            );
          }
        }
      }

      return { success: true, mirror };
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
        return { success: false, error: 'Não autenticado' };
      }

      const id = parseInt(params.id, 10);
      if (isNaN(id)) {
        set.status = 400;
        return { success: false, error: 'ID inválido' };
      }

      // Busca o mirror ANTES de deletar para ter os sourceGroups e limpar o cache
      const existingMirror = await mirrorRepo.findById(id);
      if (!existingMirror) {
        set.status = 404;
        return { success: false, error: 'Espelhamento não encontrado' };
      }

      const deleted = await mirrorRepo.delete(id);
      if (!deleted) {
        set.status = 404;
        return { success: false, error: 'Espelhamento não encontrado' };
      }

      // Remove sourceGroups do cache Redis
      const groups = existingMirror.sourceGroups as { jid: string; name: string }[] | null;
      if (groups && groups.length > 0) {
        await removeSourceGroups(groups.map((g) => g.jid));
      }

      return { success: true, message: 'Espelhamento excluído com sucesso' };
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
