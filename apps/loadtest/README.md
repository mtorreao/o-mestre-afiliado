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
