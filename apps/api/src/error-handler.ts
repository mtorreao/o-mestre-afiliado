/**
 * Handler global de erros do Elysia (usado em apps/api/src/index.ts).
 *
 * Regra do projeto: NUNCA devolver 5xx para erro de cliente.
 * Erros de validação de entrada (body/query/params — code === 'VALIDATION')
 * viram HTTP 400 com mensagem descritiva; erros de banco viram 503;
 * o resto vira 500.
 */
import { makeLogger } from '@omestre/shared';

const log = makeLogger('api');

interface ErrorHandlerContext {
  // `code` do Elysia é `number | union de literais` (ex: 'VALIDATION').
  code: number | string;
  error: unknown;
  set: { status?: number | string };
}

export function globalErrorHandler({ code, error, set }: ErrorHandlerContext) {
  // Erro de validação de entrada (body/query/params) — erro de cliente, nunca 5xx
  if (code === 'VALIDATION') {
    // No Elysia 1.x o ValidationError serializa `property`/`summary` no JSON
    // da própria `message` (ex: {"property":"/enabled","summary":"Expected boolean"}).
    let field: string | null = null;
    let detail = 'valor inválido';
    try {
      const parsed = JSON.parse((error as Error).message) as {
        property?: string;
        summary?: string;
      };
      field =
        parsed.property && parsed.property !== '/' ? parsed.property.replace(/^\//, '') : null;
      detail = parsed.summary ?? detail;
    } catch {
      detail = (error as Error).message || detail;
    }
    set.status = 400;
    return {
      success: false,
      error: field
        ? `Dados inválidos no campo '${field}': ${detail}`
        : `Dados inválidos: ${detail}`,
    };
  }

  // Se for erro de banco (timeout, conexão), retorna 503
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    msg.includes('timeout') ||
    msg.includes('connect') ||
    msg.includes('database') ||
    msg.includes('postgres') ||
    msg.includes('connection') ||
    msg.includes('pool') ||
    msg.includes('select') ||
    msg.includes('relation') ||
    msg.includes('db is')
  ) {
    set.status = 503;
    return {
      success: false,
      error: 'Serviço temporariamente indisponível. O banco de dados pode estar reiniciando.',
    };
  }

  // Erros internos não tratados
  log('error', 'Erro não tratado', { error: String(error) });
  set.status = 500;
  return { success: false, error: 'Erro interno do servidor' };
}
