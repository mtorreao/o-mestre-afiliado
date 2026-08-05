/**
 * Postgres dump via Docker — wrapper testável.
 *
 * O admin-api roda como container separado do Postgres. Sem TCP
 * direto (segurança), usa `docker exec` no `omestre_postgres` para
 * rodar `pg_dump` e capturar stdout (o dump é um stream).
 *
 * Esta lib é testável: separamos a parte que constrói o comando
 * (buildPgDumpCommand) da parte que executa (runPgDump wrapper).
 *
 * Dependency: Bun.spawn (nativo, zero deps nativas).
 */

export interface PgDumpCommandParts {
  container: string;
  dbUser: string;
  dbName: string;
  schemas: string[];
  /** '-Fc' = pg_dump custom format (comprimido, restaura com pg_restore). */
  format: 'c' | 'p' | 't';
}

/**
 * Constrói o array de args para `docker exec ... pg_dump`. Puro/sync —
 * testável sem Docker.
 */
export function buildPgDumpCommand(parts: PgDumpCommandParts): string[] {
  const schemaArgs = parts.schemas.flatMap((s) => ['-n', s]);
  return [
    'docker',
    'exec',
    '-i',
    parts.container,
    'pg_dump',
    '-U',
    parts.dbUser,
    '-d',
    parts.dbName,
    '-F',
    parts.format,
    ...schemaArgs,
  ];
}

/** Resultado de um dump bem-sucedido. */
export interface PgDumpResult {
  /** Stream do dump (formato custom, comprimido — pg_restore). */
  data: Uint8Array;
  /** Tamanho em bytes. */
  size: number;
  /** Tempo gasto (ms). */
  durationMs: number;
}

/**
 * Roda pg_dump via docker exec. Retorna o dump como Uint8Array.
 *
 * Throws em caso de erro (stderr capturado).
 *
 * Cross-platform: passa `env` separado (Windows não tem PGPASSWORD env
 * setado por default, aí pg_dump falha com "password authentication failed").
 */
export async function runPgDump(
  parts: PgDumpCommandParts,
  env: Record<string, string> = {},
  timeoutMs: number = 5 * 60 * 1000,
): Promise<PgDumpResult> {
  const args = buildPgDumpCommand(parts);
  const start = Date.now();

  const proc = Bun.spawn(args, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...env,
    },
  });

  // Concurrently: collect stdout + stderr
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`pg_dump failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
  }

  const data = new Uint8Array(stdout);
  if (data.byteLength === 0) {
    throw new Error(`pg_dump returned 0 bytes (stderr: ${stderr.slice(0, 200)})`);
  }

  return {
    data,
    size: data.byteLength,
    durationMs: Date.now() - start,
  };
}
