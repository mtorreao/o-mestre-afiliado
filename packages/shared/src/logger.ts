/**
 * Logger estruturado (JSON) compartilhado entre todos os apps/packages.
 *
 * Substitui as ~16 cópias de `function log()` que existiam espalhadas
 * em módulos de apps/ingestor, apps/dispatcher, packages/worker-common
 * e apps/api. Cada módulo cria um logger com `service` próprio.
 *
 * Uso:
 *   const log = makeLogger('ingestor');
 *   log('info', 'Processando mensagem', { messageId });
 *
 * O formato é JSON com timestamp ISO, level, service, message e data
 * (spread na raiz quando é objeto — facilita agregadores que parseiam
 * `service` e `level` como campos top-level).
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFn {
  (level: LogLevel, message: string, data?: unknown): void;
}

/**
 * Cria um logger que prefixa cada entrada com `service` fixo.
 *
 * O `data` é spread na raiz quando é um objeto (não array) — isso
 * casa com o formato que o `ingestor`, `dispatcher` e `worker-common`
 * já usavam e mantém retrocompatibilidade com agregadores externos.
 */
export function makeLogger(service: string): LogFn {
  return function log(level: LogLevel, message: string, data?: unknown): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}),
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  };
}
