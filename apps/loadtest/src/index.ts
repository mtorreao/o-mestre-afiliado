#!/usr/bin/env bun
/**
 * index.ts — CLI da suíte de testes de carga (@omestre/loadtest).
 *
 * Uso:
 *   bun run apps/loadtest/src/index.ts --mock
 *       sobe um alvo mock interno e roda os cenários contra ele (smoke test)
 *   bun run apps/loadtest/src/index.ts --target http://localhost:5442 --key SUA_APIKEY --scenario webhook-ingest-burst
 *   bun run apps/loadtest/src/index.ts --all
 *
 * Flags:
 *   --mock            usa alvo simulado interno (validação da suíte)
 *   --target <url>    URL base da API real
 *   --key <apikey>    EVOLUTION_API_KEY do webhook
 *   --token <jwt>     token Bearer para rotas autenticadas
 *   --scenario <nome> roda um cenário específico
 *   --all             roda todos os cenários
 *   --port <n>        porta do alvo mock (default 5599)
 */

import { createMockTarget } from './mock-target.ts';
import { SCENARIOS, getScenario, type ScenarioContext } from './scenarios/index.ts';
import { runScenario } from './scenario.ts';
import { renderReport } from './report-pure.ts';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const useMock = Boolean(args.mock);
  const target = (args.target as string) ?? 'http://localhost:5442';
  const key = (args.key as string) ?? 'test-key';
  const token = (args.token as string) ?? undefined;
  const scenarioName = args.scenario as string | undefined;
  const runAll = Boolean(args.all) || (!scenarioName && !useMock);

  let baseUrl = target;
  let mockStats: ReturnType<typeof createMockTarget>['stats'] | null = null;
  let mockServer: { stop: () => Promise<unknown> } | null = null;

  if (useMock) {
    const port = Number(args.port ?? 5599);
    const { app, stats } = createMockTarget({ apiKey: key });
    mockServer = app.listen(port);
    baseUrl = `http://localhost:${port}`;
    mockStats = stats;
    console.log(`🧪 Alvo mock escutando em ${baseUrl} (apikey="${key}")`);
  }

  const ctx: ScenarioContext = { baseUrl, webhookKey: key, authToken: token, userCount: 5 };

  const selected = scenarioName
    ? (() => {
        const s = getScenario(scenarioName);
        if (!s) {
          console.error(
            `❌ Cenário "${scenarioName}" não encontrado. Disponíveis: ${SCENARIOS.map((x) => x.name).join(', ')}`,
          );
          process.exit(1);
        }
        return [s];
      })()
    : SCENARIOS;

  let anyFailed = false;
  for (const def of selected) {
    const cfg = def.build(ctx);
    console.log(
      `\n▶ Rodando cenário "${cfg.name}" (${cfg.requests.length} reqs, concorrência ${cfg.concurrency})...`,
    );
    const out = await runScenario(cfg);
    console.log(renderReport(cfg.name, out.summary, out.slo));
    if (out.slo && !out.slo.passed) anyFailed = true;
  }

  if (useMock && mockStats) {
    console.log('\n──────── Mock target stats ────────');
    console.log(JSON.stringify(mockStats, null, 2));
  }

  if (mockServer) await mockServer.stop();
  if (anyFailed) {
    console.log('\n❌ Um ou mais SLOs reprovaram.');
    process.exit(2);
  }
  console.log('\n✅ Suíte de carga concluída.');
}

main().catch((err) => {
  console.error('Erro fatal na suíte de carga:', err);
  process.exit(1);
});
