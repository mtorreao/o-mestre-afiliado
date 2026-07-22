import { Elysia } from 'elysia';
import { WhatsAppInstanceRepository } from '@omestre/db';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import {
  createInstance,
  getConnectionState,
  deleteInstance,
  logoutInstance,
  getQrCode,
  instanceNameFromUserId,
  fetchGroups,
} from '../../services/evolution.ts';
import { cacheGet, cacheSet, cacheDel } from '../../services/redis.ts';

const instanceRepo = new WhatsAppInstanceRepository();

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

      // ─── 2. Tenta obter QR da instância na Evolution API ────────
      // Cobrindo 3 cenários:
      //   a) Tem registro no banco como 'connecting' → QR renovado
      //   b) Tem registro no banco como 'disconnected' → reconectar
      //   c) Nenhum registro no banco → Evolution ainda pode ter instância
      const qrResult = await getQrCode(instanceName);

      if (qrResult.success && qrResult.qrcode?.base64) {
        // Se já existe no banco, só atualiza o status
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

        // Se não existe no banco, cria registro
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

      // ─── 3. Sem QR disponível — limpa e cria nova instância ─────
      // Remove registro órfão do banco (se existir)
      if (existing) {
        await instanceRepo.deleteByUserId(auth.userId);
      }

      // Tenta logout + delete na Evolution (ignora erros)
      await logoutInstance(instanceName);
      await deleteInstance(instanceName);

      const result = await createInstance(instanceName);

      // Se ainda deu "already in use", tenta força bruta
      if (!result.success && result.error?.includes('already in use')) {
        await logoutInstance(instanceName);
        await deleteInstance(instanceName);
        const retry = await createInstance(instanceName);
        if (!retry.success) {
          set.status = 500;
          return { success: false, error: retry.error ?? 'Erro ao criar instância WhatsApp (após retry)' };
        }
        const instance = await instanceRepo.create({
          userId: auth.userId,
          instanceId: instanceName,
          apiKey: process.env.EVOLUTION_API_KEY || '',
          status: retry.instance?.status === 'open' ? 'connected' : 'connecting',
        });
        return {
          success: true,
          message: 'Instância WhatsApp criada. Escaneie o QR code.',
          qrcode: retry.qrcode?.base64 ?? null,
          instanceId: instance.instanceId,
          status: instance.status,
        };
      }

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
        message: 'Instância WhatsApp criada. Escaneie o QR code.',
        qrcode: result.qrcode?.base64 ?? null,
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
                    qrcode: { type: 'string', nullable: true },
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
    async ({ jwt, request, set }) => {
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

      // Tenta cache primeiro
      const cached = await cacheGet<{ jid: string; name: string }[]>(cacheKey);
      if (cached) {
        return { success: true, groups: cached, fromCache: true };
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

      // Cache por 5 minutos
      await cacheSet(cacheKey, groups, 300);

      return {
        success: true,
        groups,
      };
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

      // Deleta a instância na Evolution API (ignora 404)
      await logoutInstance(instanceName);
      await deleteInstance(instanceName);

      // Cria nova instância com o mesmo nome
      const result = await createInstance(instanceName);

      if (!result.success) {
        // Se deu "already in use", tenta força bruta (delete + create)
        if (result.error?.includes('already in use')) {
          await logoutInstance(instanceName);
          await deleteInstance(instanceName);
          const retry = await createInstance(instanceName);
          if (!retry.success) {
            set.status = 500;
            return { success: false, error: retry.error ?? 'Erro ao recriar instância WhatsApp' };
          }
          // Atualiza status no banco
          await instanceRepo.updateStatus(existing.id, 'connecting');
          return {
            success: true,
            message: 'QR Code regenerado. Escaneie o novo código.',
            qrcode: retry.qrcode?.base64 ?? null,
            instanceId: existing.instanceId,
            status: 'connecting',
          };
        }
        set.status = 500;
        return { success: false, error: result.error ?? 'Erro ao recriar instância WhatsApp' };
      }

      // Atualiza status no banco para 'connecting'
      await instanceRepo.updateStatus(existing.id, 'connecting');

      return {
        success: true,
        message: 'QR Code regenerado. Escaneie o novo código.',
        qrcode: result.qrcode?.base64 ?? null,
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
                    qrcode: { type: 'string', nullable: true },
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
  );
