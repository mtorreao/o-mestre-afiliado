import { Elysia, t } from 'elysia';
import { WhatsAppInstanceRepository } from '@omestre/db';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import {
  getConnectionState,
  deleteInstance,
  logoutInstance,
  getQrCode,
  refreshInstance,
  instanceNameFromUserId,
  fetchGroups,
} from '../../services/evolution.ts';
import { cacheGet, cacheSet, cacheDel } from '../../services/redis.ts';
import { removeSourceGroups } from '../../services/group-cache.ts';
import { AffiliatesRepository } from '@omestre/db';

const instanceRepo = new WhatsAppInstanceRepository();
const affiliatesRepo = new AffiliatesRepository();

// Mapeia estado da Evolution API para nosso domínio
function mapStatus(evolutionState: string): string {
  switch (evolutionState) {
    case 'open':
      return 'connected';
    case 'connecting':
      return 'connecting';
    default:
      return 'disconnected';
  }
}

export const whatsAppRoutes = new Elysia()
  .use(createJwtPlugin())

  // ─── POST /api/whatsapp/connect ──────────────────────────────────
  .post(
    '/api/whatsapp/connect',
    async ({ jwt, request, set }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const instanceName = instanceNameFromUserId(auth.userId);

      // ─── 1. Verifica se já tem instância no banco local ──────────
      const existing = await instanceRepo.findByUserId(auth.userId);

      // Se já conectado, retorna erro
      if (existing?.status === 'connected') {
        return { success: false, error: 'WhatsApp já está conectado' };
      }

      // ─── 2. Tenta obter QR da instância existente ────────────────
      const qrResult = await getQrCode(instanceName);

      if (qrResult.success && qrResult.qrcode?.base64) {
        if (existing) {
          await instanceRepo.updateStatus(existing.id, 'connecting');
          return {
            success: true,
            message: 'WhatsApp aguardando escaneamento do QR code',
            qrcode: qrResult.qrcode.base64,
            instanceId: existing.instanceId,
            status: 'connecting',
          };
        }

        // Cria registro no banco
        const instance = await instanceRepo.create({
          userId: auth.userId,
          instanceId: instanceName,
          apiKey: process.env.EVOLUTION_API_KEY || '',
          status: 'connecting',
        });
        return {
          success: true,
          message: 'WhatsApp aguardando escaneamento do QR code',
          qrcode: qrResult.qrcode.base64,
          instanceId: instance.instanceId,
          status: instance.status,
        };
      }

      // ─── 3. Sem QR — refreshInstance limpa e recria ──────────────
      // Remove registro órfão do banco (se existir)
      if (existing) {
        await instanceRepo.deleteByUserId(auth.userId);
      }

      const result = await refreshInstance(instanceName);

      if (!result.success) {
        set.status = 500;
        return { success: false, error: result.error ?? 'Erro ao criar instância WhatsApp' };
      }

      // Salva no banco
      const instance = await instanceRepo.create({
        userId: auth.userId,
        instanceId: instanceName,
        apiKey: process.env.EVOLUTION_API_KEY || '',
        status: result.instance?.status === 'open' ? 'connected' : 'connecting',
      });

      return {
        success: true,
        message: 'WhatsApp aguardando escaneamento do QR code',
        qrcode: result.qrcode!.base64,
        instanceId: instance.instanceId,
        status: instance.status,
      };
    },
    {
      detail: {
        summary: 'Conectar WhatsApp',
        description: 'Cria uma instância WhatsApp via Evolution API e retorna o QR code para escaneamento',
        responses: {
          200: {
            description: 'Sucesso — QR code retornado',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    qrcode: { type: 'string' },
                    instanceId: { type: 'string' },
                    status: { type: 'string' },
                  },
                },
              },
            },
          },
          401: { description: 'Não autenticado' },
        },
      },
    },
  )

  // ─── GET /api/whatsapp/status ────────────────────────────────────
  .get(
    '/api/whatsapp/status',
    async ({ jwt, request, set }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const instance = await instanceRepo.findByUserId(auth.userId);
      if (!instance) {
        return {
          success: true,
          connected: false,
          status: 'disconnected',
          message: 'Nenhuma instância WhatsApp encontrada',
        };
      }

      // Consulta status real na Evolution API
      const instanceName = instanceNameFromUserId(auth.userId);
      const stateResult = await getConnectionState(instanceName);

      if (!stateResult.success) {
        // Se a Evolution API não respondeu, usa o status do banco
        return {
          success: true,
          connected: instance.status === 'connected',
          status: instance.status,
          instanceId: instance.instanceId,
          rateLimitMaxMsgs: instance.rateLimitMaxMsgs,
          rateLimitWindowSec: instance.rateLimitWindowSec,
          cached: true,
        };
      }

      const rawState = stateResult.state!.state;
      let mappedStatus = mapStatus(rawState);

      // Se Evolution reportou "close", verifica se ainda há QR disponível
      // (entre regenerações de QR, o estado pode ficar "close" transitoriamente)
      if (rawState === 'close') {
        const qrCheck = await getQrCode(instanceName);
        if (qrCheck.success && qrCheck.qrcode?.base64) {
          mappedStatus = 'connecting';
        }
      }

      // Atualiza banco se o status mudou
      if (mappedStatus !== instance.status) {
        await instanceRepo.updateStatus(instance.id, mappedStatus);
      }

      return {
        success: true,
        connected: mappedStatus === 'connected',
        status: mappedStatus,
        instanceId: instance.instanceId,
        rateLimitMaxMsgs: instance.rateLimitMaxMsgs,
        rateLimitWindowSec: instance.rateLimitWindowSec,
      };
    },
    {
      detail: {
        summary: 'Status do WhatsApp',
        description: 'Retorna o status da conexão WhatsApp do usuário autenticado',
        responses: {
          200: {
            description: 'Status da conexão',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    connected: { type: 'boolean' },
                    status: { type: 'string' },
                    instanceId: { type: 'string' },
                  },
                },
              },
            },
          },
          401: { description: 'Não autenticado' },
        },
      },
    },
  )

  // ─── GET /api/whatsapp/groups ────────────────────────────────────
  .get(
    '/api/whatsapp/groups',
    async ({ jwt, request, set, query }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      // Verifica se o WhatsApp está conectado
      const instance = await instanceRepo.findByUserId(auth.userId);
      if (!instance || instance.status !== 'connected') {
        return {
          success: false,
          error: 'WhatsApp não está conectado. Conecte-se primeiro.',
        };
      }

      const instanceName = instanceNameFromUserId(auth.userId);
      const cacheKey = `whatsapp:groups:${instanceName}`;
      const force = query?.force === 'true';

      // Tenta cache primeiro (a menos que force=true)
      if (!force) {
        const cached = await cacheGet<{ jid: string; name: string }[]>(cacheKey);
        if (cached) {
          return { success: true, groups: cached, fromCache: true };
        }
      }

      // Busca grupos na Evolution API
      const result = await fetchGroups(instanceName);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Erro ao buscar grupos do WhatsApp',
        };
      }

      const groups = result.groups || [];

      // Atualiza cache (mesmo em force=true, para popular com dados frescos)
      await cacheSet(cacheKey, groups, 300);

      return {
        success: true,
        groups,
        ...(force ? { fromCache: false } : {}),
      };
    },
    {
      detail: {
        summary: 'Listar grupos do WhatsApp',
        description: 'Retorna a lista de grupos do WhatsApp conectado. Suporta ?force=true para bypass do cache.',
        responses: {
          200: { description: 'Lista de grupos' },
          401: { description: 'Não autenticado' },
        },
      },
    },
  )

  // ─── DELETE /api/whatsapp/disconnect ─────────────────────────────
  .delete(
    '/api/whatsapp/disconnect',
    async ({ jwt, request, set }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const instance = await instanceRepo.findByUserId(auth.userId);
      if (!instance) {
        return {
          success: true,
          message: 'Nenhuma instância WhatsApp para desconectar',
        };
      }

      // Tenta logout primeiro (limpa sessão sem deletar)
      const instanceName = instanceNameFromUserId(auth.userId);

      // Invalida cache de grupos
      await cacheDel(`whatsapp:groups:${instanceName}`);

      // Limpa cache de sourceGroups do afiliado
      try {
        const affiliate = await affiliatesRepo.findByEvolutionInstanceId(instanceName);
        if (affiliate?.sourceGroups) {
          const jids = (affiliate.sourceGroups as { jid: string; name: string }[]).map((g) => g.jid);
          if (jids.length > 0) {
            await removeSourceGroups(jids);
            console.log(
              `[whatsapp] Cache de sourceGroups limpo para ${instanceName} ` +
              `(${jids.length} grupo(s) removido(s))`,
            );
          }
        }
      } catch {
        // Falha silenciosa — cache pode já estar vazio
      }

      await logoutInstance(instanceName);

      // Depois deleta da Evolution API
      const deleteResult = await deleteInstance(instanceName);

      // Remove do banco (mesmo se a Evolution falhar — dados locais)
      await instanceRepo.deleteByUserId(auth.userId);

      if (!deleteResult.success) {
        // A instância foi removida do banco mas pode ter falhado na Evolution
        return {
          success: true,
          message: 'WhatsApp desconectado (dados locais removidos)',
          warning: deleteResult.error,
        };
      }

      return {
        success: true,
        message: 'WhatsApp desconectado com sucesso',
      };
    },
    {
      detail: {
        summary: 'Desconectar WhatsApp',
        description: 'Desconecta a instância WhatsApp do usuário',
        responses: {
          200: { description: 'Desconectado com sucesso' },
          401: { description: 'Não autenticado' },
        },
      },
    },
  )

  // ─── POST /api/whatsapp/regenerate-qr ───────────────────────────
  .post(
    '/api/whatsapp/regenerate-qr',
    async ({ jwt, request, set }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const instanceName = instanceNameFromUserId(auth.userId);

      // Verifica se tem instância no banco
      const existing = await instanceRepo.findByUserId(auth.userId);
      if (!existing) {
        set.status = 400;
        return { success: false, error: 'Nenhuma instância WhatsApp encontrada. Conecte-se primeiro.' };
      }

      // Invalida cache de grupos
      await cacheDel(`whatsapp:groups:${instanceName}`);

      // refreshInstance faz logout → delete → createInstanceWithQR
      // (já trata "already in use" automaticamente)
      const result = await refreshInstance(instanceName);

      if (!result.success) {
        set.status = 500;
        return { success: false, error: result.error ?? 'Erro ao recriar instância WhatsApp' };
      }

      // Atualiza status no banco para 'connecting'
      await instanceRepo.updateStatus(existing.id, 'connecting');

      return {
        success: true,
        message: 'QR Code regenerado. Escaneie o novo código.',
        qrcode: result.qrcode!.base64,
        instanceId: existing.instanceId,
        status: 'connecting',
      };
    },
    {
      detail: {
        summary: 'Regenerar QR Code do WhatsApp',
        description: 'Deleta e recria a instância WhatsApp na Evolution API, gerando um novo QR code para escaneamento',
        responses: {
          200: {
            description: 'Novo QR code gerado',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    qrcode: { type: 'string' },
                    instanceId: { type: 'string' },
                    status: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'Nenhuma instância encontrada' },
          401: { description: 'Não autenticado' },
        },
      },
    },
  )

  // ─── PATCH /api/whatsapp/instances/:id/rate-limit ──────────────
  .patch(
    '/api/whatsapp/instances/:id/rate-limit',
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

      const instance = await instanceRepo.findById(id);
      if (!instance) {
        set.status = 404;
        return { success: false, error: 'Instância não encontrada' };
      }

      // Verifica se a instância pertence ao usuário
      if (instance.userId !== auth.userId) {
        set.status = 403;
        return { success: false, error: 'Acesso negado a esta instância' };
      }

      const { maxMsgs, windowSec } = body as { maxMsgs: number; windowSec: number };

      if (typeof maxMsgs !== 'number' || maxMsgs < 1 || maxMsgs > 1000) {
        set.status = 400;
        return { success: false, error: 'maxMsgs deve ser um número entre 1 e 1000' };
      }

      if (typeof windowSec !== 'number' || windowSec < 10 || windowSec > 3600) {
        set.status = 400;
        return { success: false, error: 'windowSec deve ser um número entre 10 e 3600' };
      }

      await instanceRepo.updateRateLimit(id, maxMsgs, windowSec);

      return {
        success: true,
        message: 'Rate limit atualizado com sucesso',
        instance: {
          id: instance.id,
          instanceId: instance.instanceId,
          rateLimitMaxMsgs: maxMsgs,
          rateLimitWindowSec: windowSec,
        },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        maxMsgs: t.Number({ minimum: 1, maximum: 1000 }),
        windowSec: t.Number({ minimum: 10, maximum: 3600 }),
      }),
      detail: {
        summary: 'Configurar rate limit da instância',
        description: 'Altera o limite de mensagens por janela de tempo para uma instância WhatsApp',
      },
    },
  );
