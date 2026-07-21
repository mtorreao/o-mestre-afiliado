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
} from '../../services/evolution.ts';

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

      // Verifica se já existe uma instância para o usuário
      const existing = await instanceRepo.findByUserId(auth.userId);
      if (existing) {
        // Se já estiver conectada, retorna erro
        if (existing.status === 'connected') {
          return { success: false, error: 'WhatsApp já está conectado' };
        }

        // Se estiver em connecting, retorna QR code novamente
        if (existing.status === 'connecting') {
          const instanceName = instanceNameFromUserId(auth.userId);
          const qrResult = await getQrCode(instanceName);

          if (!qrResult.success) {
            // Pode ser que a instância expirou — tenta recriar
            await instanceRepo.deleteByUserId(auth.userId);
            await deleteInstance(instanceName);
          } else {
            return {
              success: true,
              message: 'WhatsApp aguardando escaneamento do QR code',
              qrcode: qrResult.qrcode?.base64 ?? null,
              instanceId: existing.instanceId,
              status: 'connecting',
            };
          }
        }
      }

      // Cria instância na Evolution API
      const instanceName = instanceNameFromUserId(auth.userId);
      const result = await createInstance(instanceName);

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

      const mappedStatus = mapStatus(stateResult.state!.state);

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
  );
