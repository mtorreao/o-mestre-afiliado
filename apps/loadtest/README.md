# @omestre/loadtest — Suíte de Testes de Carga (Go-Live)

Harness de carga nativo em Bun/TypeScript, sem dependências externas (além de
`elysia` para o alvo mock e `@omestre/shared`). Reutiliza o formato real do
webhook da Evolution API v2 e isola toda a matemática de métricas em módulos
`*-pure.ts` com cobertura unitária.

## Cenários

| Cenário                | Descrição                                                       | Concorrência |
| ---------------------- | --------------------------------------------------------------- | ------------ |
| `webhook-ingest-burst` | Sustentado de `POST /webhook/message` (Evolution → ingestor)    | 25           |
| `webhook-login-mixed`  | 70% webhook + 30% `POST /api/auth/login`                        | 20           |
| `dashboard-reads`      | Leituras de painel: `/api/worker/status`, `/api/mirrors`, `/me` | 15           |

## Uso

```bash
# Smoke test contra alvo mock interno (valida a suíte sem subir o stack)
bun run loadtest:mock
# ou:
bun run apps/loadtest/src/index.ts --mock --all

# Dia do go-live — apontar para a API real de produção
bun run apps/loadtest/src/index.ts \
  --target https://api.omestre.com \
  --key "$EVOLUTION_API_KEY" \
  --token "$JWT" \
  --all

# Cenário específico
bun run apps/loadtest/src/index.ts --target http://localhost:5442 --key SUA_KEY --scenario webhook-ingest-burst
```

### Flags

- `--mock` — sobe alvo simulado interno (porta 5599) e roda contra ele.
- `--target <url>` — URL base da API real (default `http://localhost:5442`).
- `--key <apikey>` — `EVOLUTION_API_KEY` do webhook.
- `--token <jwt>` — Bearer token para rotas autenticadas.
- `--scenario <nome>` — roda um cenário.
- `--all` — roda todos.

## SLOs (go-live)

Os SLOs estão definidos em `src/scenarios/index.ts` por cenário. Resumo:

- `webhook-ingest-burst`: p95 < 500ms, p99 < 1000ms, erros < 2%, 5xx < 1%, rps ≥ 50.
- `webhook-login-mixed`: p95 < 600ms, erros < 2%.
- `dashboard-reads`: p95 < 300ms, 5xx < 1%.

Ajuste os valores conforme a capacidade medida do seu ambiente de produção.

## Arquitetura

```
src/
  metrics-pure.ts          # agregação + percentis + avaliação de SLO (puro)
  metrics-pure.test.ts     # testes unitários (100% cobertura da lógica)
  webhook-payload-pure.ts  # gerador determinístico de payloads do webhook
  webhook-payload-pure.test.ts
  report-pure.ts           # renderização de relatório (puro)
  report-pure.test.ts
  scenario.ts              # engine de execução (pool de requisições)
  mock-target.ts           # alvo simulado p/ smoke test
  scenarios/index.ts       # definição dos cenários + SLOs
  index.ts                 # CLI
```

Toda a lógica de decisão/matemática está em `*-pure.ts` (testável sem I/O).
O I/O (fetch, servidor mock, CLI) fica nos módulos de execução.

## Modo Ramp-up (cargas graduais)

Encontra o ponto de saturação subindo a concorrência por estágios e analisando
o ganho de throughput vs. o aumento de latência p95 a cada estágio.

```bash
# Plano padrão (5→10→25→50→100, durações em segundos)
bun run apps/loadtest/src/index.ts --mock --ramp --scenario webhook-ingest-burst

# Plano customizado: "conc:seg,conc:seg" (segundos)
bun run apps/loadtest/src/index.ts --ramp --target https://api.omestre.com \
  --key "$EVOLUTION_API_KEY" --scenario webhook-ingest-burst \
  --stages "5:10,25:15,50:15,100:20,200:20"
```

O relatório mostra por estágio: concorrência, rps, p50/p95/p99, %5xx, %erros e
status de SLO. A análise detecta:

- **Saturação**: quando subir a concorrência deixou de gerar ganho de throughput
  (≤ 5%) enquanto o p95 subiu → capacidade estimada = rps do último estágio ok.
- **Rompimento de SLO**: 1º estágio onde o SLO do cenário falhou.

### Flags

- `--ramp` — ativa o modo ramp-up (ignora `--all`/modo fixo).
- `--stages "conc:seg,..."` — plano customizado (segundos). Sem ele, usa o
  plano padrão 5→100.

## Arquitetura (ramp)

```
src/
  ramp-pure.ts             # plano de estagios + analyzeRamp (puro)
  ramp-pure.test.ts
  ramp-report-pure.ts      # render do relatorio de ramp (puro)
  ramp-report-pure.test.ts
  ramp.ts                  # engine de execucao (pool por estagio, I/O)
```
