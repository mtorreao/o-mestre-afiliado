# Plano: Suíte de Testes de Carga para Go-Live

## 1. Contexto e objetivo

O Mestre Afiliado vai a produção. Precisamos de uma suíte de carga para validar
os caminhos críticos de go-live **antes** e **no dia** do lançamento, medindo
throughput, latência (p95/p99) e taxa de erros/5xx sob concorrência.

Objetivo mensurável: conseguir disparar N requisições com concorrência ajustável
contra a API real (ou alvo mock), agregar latência/status e avaliar SLOs
pré-definidos, com relatório legível e sem dependências externas de instalação.

## 2. Estado atual observado

- Monorepo Bun Workspaces; apps: `api`, `web`, `ingestor`, `dispatcher`,
  `catalog-worker`. Infra via `docker-compose.yml` (PG + Redis + Evolution).
- Caminho crítico de go-live: `POST /webhook/message` (Evolution → ingestor →
  Redis Stream) é o gargalo de ingestão. Auth (`/api/auth/login`, `/api/auth/me`)
  e leituras de painel (`/api/worker/status`, `/api/mirrors`) completam o fluxo.
- `webhook.routes.ts` consome payload `messages.upsert` (formato paginado
  `{messages:{records}}`, array `{messages:[...]}` ou objeto único `{key,message}`).
- Não havia nenhuma ferramenta de carga instalada (k6/artillery ausentes).
- Convenção do repo: lógica pura isolada em `*-pure.ts` + testes unitários
  (meta ≥ 80% em código passível de teste; hoje ~98% ajustada).

## 3. Modelo de dados

Não há mudança de schema. A suíte é ferramenta de engenharia, não feature de
produto.

## 4. Contratos / CLI

```
bun run apps/loadtest/src/index.ts [--mock] [--target URL] [--key APIKEY]
       [--token JWT] [--scenario NOME] [--all] [--port N]
```

Saída: relatório textual por cenário com total, erros, throughput, breakdown de
status e latência (min/p50/p95/p99/max), seguido de ✅/❌ de SLO.

## 5. Fluxo de dados

1. CLI resolve contexto (target, chaves).
2. Para cada cenário selecionado, `scenarios/index.ts` monta a lista de
   `ScenarioRequest` (webhook via `webhook-payload-pure`, auth via POST login,
   dashboard via GET).
3. `scenario.ts` executa um pool de `concurrency` workers que disparam fetch nativo
   (`AbortController` + timeout), registrando `startedAt`/`durationMs`/`status`.
4. `metrics-pure.aggregateMetrics` consolida em `RunSummary`.
5. `metrics-pure.evaluateSlo` avalia contra SLO do cenário.
6. `report-pure.renderReport` imprime.

## 6. Lógica pura isolada

- `metrics-pure.ts`: `percentile`, `statusClass`, `observationWindow`,
  `aggregateMetrics`, `evaluateSlo`.
- `webhook-payload-pure.ts`: `mulberry32`, `buildWebhookEvent`, `buildWebhookBatch`.
- `report-pure.ts`: `renderReport`.

## 7. Pontos de integração

- Novo app: `apps/loadtest/` (package `@omestre/loadtest`).
- `package.json` raiz: scripts `loadtest` e `loadtest:mock`.
- Reutiliza formato de `apps/api/src/modules/webhook/webhook.routes.ts` (sem
  import circular — apenas replica a forma do payload).

## 8. Testes

- Unit (`apps/loadtest/src/*.test.ts`): percentis (interpolação, vazio, imutabilidade),
  classificação de status, janela de observação, agregação (breakdown, rps),
  avaliação de SLO (passa/falha por critério, n=0), gerador determinístico de
  payload, formatos de envelope, render de relatório. **30 testes, 0 falhas.**
- Smoke E2E da suíte: `bun run loadtest:mock` sobe alvo mock e roda os 3
  cenários, validando envio HTTP real, agregação e SLO. **Verificado manualmente.**

## 9. Critérios de aceite

- [x] `bun run typecheck` do app loadtest: 0 erros.
- [x] `bun test apps/loadtest`: 30 pass.
- [x] `bun run loadtest:mock` executa os 3 cenários contra alvo real (mock) e
      imprime relatório + SLO.
- [x] Cenários cobrem webhook (ingestão), auth e leituras de painel.
- [ ] `bun run loadtest --target <PROD> --key $EVOLUTION_API_KEY --all` roda no
      dia do go-live contra a API real (depende do ambiente de produção).

## 10. Commits sugeridos

- `feat(loadtest): adicionar harness de carga nativo em Bun (engine + CLI)`
- `test(loadtest): cobrir métricas, payload e relatório com testes unitários`
- `docs(loadtest): documentar cenários, SLOs e uso no README/spec`

## 11. Riscos e mitigações

- **Risco:** webhook em produção exige `EVOLUTION_API_KEY`; sem ela retorna 503
  "Webhook desabilitado". **Mitigação:** passar `--key` com o segredo real no
  go-live; nunca commitar o segredo (usar env var).
- **Risco:** contra alvo local instantâneo a janela colapsa (rps artificial).
  **Mitigação:** o alvo mock aplica latência; para produção a latência real
  domina e a janela é fiel.
- **Risco:** flood de webhook pode poluir grupos reais. **Mitigação:** o
  cenário `webhook-ingest-burst` usa `instance=user-{N}`; em produção apontar
  para instâncias de teste ou usar o mock até o cutover.
