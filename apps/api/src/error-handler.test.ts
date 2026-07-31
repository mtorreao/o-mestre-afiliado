/**
 * Testes unitários do handler global de erros (error-handler.ts).
 *
 * O arquivo é lógica pura (sem I/O) — os caminhos VALIDATION → 400,
 * banco → 503 e interno → 500 são verificados diretamente com um
 * contexto fake, sem subir servidor.
 */
import { describe, expect, it } from 'bun:test';
import { globalErrorHandler } from './error-handler.ts';

interface FakeSet {
  status?: number | string;
}

function call(code: string, error: unknown) {
  const set: FakeSet = {};
  const result = globalErrorHandler({ code, error, set }) as {
    success: boolean;
    error: string;
  };
  return { status: set.status, result };
}

describe('globalErrorHandler', () => {
  it('VALIDATION com campo → 400 com mensagem descritiva do campo', () => {
    const { status, result } = call(
      'VALIDATION',
      new Error(JSON.stringify({ property: '/enabled', summary: 'Expected boolean' })),
    );
    expect(status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error).toContain("'enabled'");
    expect(result.error).toContain('Expected boolean');
  });

  it('VALIDATION com property "/" → 400 com mensagem genérica (sem campo)', () => {
    const { status, result } = call(
      'VALIDATION',
      new Error(JSON.stringify({ property: '/', summary: 'Expected object' })),
    );
    expect(status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Expected object');
    expect(result.error).not.toContain("campo '");
  });

  it('VALIDATION com message não-JSON → 400 com fallback do texto bruto', () => {
    const { status, result } = call('VALIDATION', new Error('texto de erro simples'));
    expect(status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error).toContain('texto de erro simples');
  });

  it('VALIDATION com message vazia → 400 com fallback genérico', () => {
    const { status, result } = call('VALIDATION', new Error(''));
    expect(status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error).toContain('valor inválido');
  });

  it('erro de banco (connection timeout) → 503', () => {
    const { status, result } = call('UNKNOWN', new Error('connection timeout'));
    expect(status).toBe(503);
    expect(result.success).toBe(false);
    expect(result.error).toContain('temporariamente indisponível');
  });

  it('erro de banco (postgres) → 503', () => {
    const { status } = call('UNKNOWN', new Error('postgres: relation does not exist'));
    expect(status).toBe(503);
  });

  it('erro interno não relacionado → 500', () => {
    const { status, result } = call('UNKNOWN', new Error('boom qualquer'));
    expect(status).toBe(500);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Erro interno do servidor');
  });

  it('erro sem ser instância de Error (string) → 500', () => {
    const { status } = call('UNKNOWN', 'string de erro');
    expect(status).toBe(500);
  });
});
