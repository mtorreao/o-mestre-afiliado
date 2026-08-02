#!/usr/bin/env bun
/**
 * index.ts — CLI da suite de testes de carga (@omestre/loadtest).
 *
 * Uso:
 *   bun run apps/loadtest/src/index.ts --mock
 *       sobe um alvo mock interno e roda os cenarios contra ele (smoke test)
 *   bun run apps/loadtest/src/index.ts --ramp --target http://localhost:5442 --key SUA_APIKEY --scenario webhook-ingest-burst
 *   bun run apps/loadtest/src/index.ts --all
 *
 * Flags:
 *   --mock            usa alvo simulado interno (validacao da suite)
 *   --target <url>    URL base da API real
 *   --key <apikey>    EVOLUTION_API_KEY do webhook
 *   --token <jwt>     token Bearer para rotas autenticadas
 *   --scenario <nome> roda um cenario especifico (modo fixo ou ramp)
 *   --all             roda todos os cenarios (modo fixo)
 *   --ramp            modo ramp-up (cargas crescentes por estagio)
 *   --stages <spec>   plano de estagios p/ ramp, ex: "5:10,25:15,100:20" (segundos)
 *   --port <n>        porta do alvo mock (default 5599)
 */

import { createMockTarget } from './mock-target.ts';
import {
  SCENARIOS,
  getScenario,
  type ScenarioContext,
  type ScenarioDef,
} from './scenarios/index.ts';
import { runScenario } from './scenario.ts';
import { runRamp } from './ramp.ts';
import { renderReport } from './report-pure.ts';
import { renderRampReport } from './ramp-report-pure.ts';
import { defaultRampPlan, parseStagesSpec, type RampPlan } from './ramp-pure.ts';

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
  const runAll = Boolean(args.all) || (!scenarioName && !useMock && !args.ramp);
  const useRamp = Boolean(args.ramp);

  let baseUrl = target;
  let mockStats: ReturnType<typeof createMockTarget>['stats'] | null = null;
  let mockServer: { stop: () => Promise<unknown> } | null = null;

  if (useMock) {
    const port = Number(args.port ?? 5599);
    const { app, stats } = createMockTarget({ apiKey: key });
    mockServer = app.listen(port);
    baseUrl = `http://localhost:${port}`;
    mockStats = stats;
    console.log(`[MOCK] alvo simulado em ${baseUrl} (apikey="${key}")`);
  }

  const ctx: ScenarioContext = { baseUrl, webhookKey: key, authToken: token, userCount: 5 };

  const selected: ScenarioDef[] = scenarioName
    ? (() => {
        const s = getScenario(scenarioName);
        if (!s) {
          console.error(
            `Cenario "${scenarioName}" nao encontrado. Disponiveis: ${SCENARIOS.map((x) => x.name).join(', ')}`,
          );
          process.exit(1);
        }
        return [s];
      })()
    : SCENARIOS;

  let anyFailed = false;

  // ---- MODO RAMP-UP ----
  if (useRamp) {
    let rampPlan: RampPlan;
    if (args.stages) {
      const parsed = parseStagesSpec(args.stages as string);
      if (!parsed) {
        console.error(`--stages invalido: "${args.stages as string}" (use "conc:seg,conc:seg")`);
        process.exit(1);
      }
      rampPlan = { name: scenarioName ?? 'ramp', stages: parsed };
    } else {
      rampPlan = defaultRampPlan(scenarioName ?? 'ramp');
    }

    for (const def of selected) {
      const cfg = def.build(ctx);
      const totalDurationMin = rampPlan.stages.reduce((acc, s) => acc + s.durationMs, 0) / 60000;
      console.log(
        `\n[RAMP] "${cfg.name}" — ${rampPlan.stages.length} estagios (${totalDurationMin.toFixed(1)} min), conc: ${rampPlan.stages
          .map((s) => s.concurrency)
          .join(' → ')}`,
      );
      const out = await runRamp(rampPlan, {
        factory: (i) => {
          // round-robin sobre as requisicoes do cenario
          const req = cfg.requests[i % cfg.requests.length]!;
          // variar usuario para o webhook
          if (req.url.endsWith('/webhook/message')) {
            const body = JSON.parse(req.body ?? '{}');
            if (body.instance) {
              const u = (i % (ctx.userCount ?? 5)) + 1;
              body.instance = `user-${u}`;
            }
            return { ...req, body: JSON.stringify(body) };
          }
          return req;
        },
        timeoutMs: cfg.timeoutMs ?? 10_000,
        slo: cfg.slo,
      });
      console.log(renderRampReport(cfg.name, out.stages, out.analysis));
      if (out.analysis.breachedSloStage !== null) anyFailed = true;
    }
  } else {
    // ---- MODO FIXO ----
    for (const def of selected) {
      const cfg = def.build(ctx);
      console.log(
        `\n[RUN] "${cfg.name}" (${cfg.requests.length} reqs, concorrencia ${cfg.concurrency})...`,
      );
      const out = await runScenario(cfg);
      console.log(renderReport(cfg.name, out.summary, out.slo));
      if (out.slo && !out.slo.passed) anyFailed = true;
    }
  }

  if (useMock && mockStats) {
    console.log('\n---- Mock target stats ----');
    console.log(JSON.stringify(mockStats, null, 2));
  }

  if (mockServer) await mockServer.stop();
  if (anyFailed) {
    console.log('\nX Um ou mais SLOs reprovaram.');
    process.exit(2);
  }
  console.log('\nOK Suite de carga concluida.');
}

main().catch((err) => {
  console.error('Erro fatal na suite de carga:', err);
  process.exit(1);
});
