/**
 * Extension Logs Routes — POST /api/extension/logs
 *
 * Endpoint dedicado para a extensão Chrome enviar logs estruturados.
 *
 * Auth: API key dedicada no header `X-Extension-Logs-Key` (escopo apenas
 * inserir). Configurada via env `EXTENSION_LOGS_API_KEY`. Se vazia, o
 * endpoint rejeita TODAS as requisições (fail-closed).
 *
 * Validação, rate limit por sessionId e tamanho de batch ficam em
 * extension-logs-pure.ts (testável sem I/O).
 *
 * Sem leitura por enquanto — GET /api/extension/logs será adicionado
 * separadamente como rota admin-only (JWT + isAdmin).
 */
import { Elysia, t } from 'elysia';
import { ExtensionLogRepository } from '@omestre/db';
import { makeLogger } from '@omestre/shared';
import { config } from '../../config.ts';
import { LogValidationError, RateLimiter, validateLogBatch } from './extension-logs-pure.ts';

const log = makeLogger('extension-logs');
const repo = new ExtensionLogRepository();

/** Comparação constant-time para evitar timing attacks na API key. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Rate limiter compartilhado entre todas as requests.
// Singleton dentro do módulo — sobrevive entre requests no mesmo processo.
const rateLimiter = new RateLimiter();

export const extensionLogRoutes = new Elysia()
  // ─── POST /api/extension/logs ─────────────────────────────────────
  .post(
    '/api/extension/logs',
    async ({ request, set, body }) => {
      const expectedKey = config.EXTENSION_LOGS_API_KEY;
      if (!expectedKey) {
        log('warn', 'logs.endpoint.disabled');
        set.status = 503;
        return {
          success: false,
          error: 'Endpoint desabilitado. Configure EXTENSION_LOGS_API_KEY.',
        };
      }

      const providedKey = request.headers.get('x-extension-logs-key');
      if (!providedKey || !safeEqual(providedKey, expectedKey)) {
        log('warn', 'logs.auth.failed', { hasKey: Boolean(providedKey) });
        set.status = 401;
        return { success: false, error: 'API key inválida' };
      }

      // Validação do batch inteiro (tamanho + cada entry).
      let validated;
      try {
        validated = validateLogBatch(body);
      } catch (err) {
        if (err instanceof LogValidationError) {
          log('warn', 'logs.validation.failed', { code: err.code, message: err.message });
          set.status = 400;
          return { success: false, error: err.message, code: err.code };
        }
        throw err;
      }

      // Rate limit por sessionId (primeira entry basta — todas compartilham).
      const sessionId = validated[0]!.sessionId;
      if (!rateLimiter.check(sessionId)) {
        log('warn', 'logs.rate_limit.exceeded', { sessionId, count: validated.length });
        set.status = 429;
        return {
          success: false,
          error: 'Rate limit excedido. Aguarde alguns segundos.',
        };
      }
      // Periodicamente limpa entries antigas do rate limiter.
      rateLimiter.prune();

      // Insere no banco.
      try {
        const ids = await repo.insertBatch(validated);
        log('info', 'logs.inserted', { count: ids.length, sessionId });
        return { success: true, inserted: ids.length, ids };
      } catch (err) {
        log('error', 'logs.insert.failed', {
          error: String(err),
          sessionId,
          count: validated.length,
        });
        set.status = 503;
        return { success: false, error: 'Falha ao persistir logs' };
      }
    },
    {
      body: t.Array(t.Any()),
      detail: {
        summary: 'Inserir logs da extensão (POST-only)',
        description:
          'Recebe batch de logs da extensão Chrome. Auth via header X-Extension-Logs-Key.',
      },
    },
  );
