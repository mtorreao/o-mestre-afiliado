# Worker Monitoring — Log de implementação

**Branch:** `wt/worker-monitoring-9def26` (mergeado em `main`)
**Branch base:** `main` @ `1329732`
**Status:** ✅ Concluído e mergeado

> Este documento começou como plano de implementação e foi atualizado para refletir
> o que foi efetivamente entregue. Os commits finais divergiram do plano original
> (3 commits → 9 commits reais) porque o usuário pediu para evoluir além do escopo
> inicial (filtros server-side, auto-refresh, copiar JSON, badge pulsante).

---

## Objetivo

Tela web de **monitoramento de saúde + performance** dos workers de espelhamento
(Ingestor + Dispatcher) e da Dead Letter Queue (DLQ). Foco em **diagnóstico**:
responder à primeira vista se os 2 workers estão saudáveis e performáticos, e
permitir inspeção e gestão da DLQ.

**Fora de escopo:** ações remotas de start/stop/restart, séries temporais
(sparklines), alertas proativos (notificações), sub-rotas separadas.

---

## Decisões de arquitetura

- **Reescrita 100% frontend** (commits 1-6), tocando backend apenas no commit 7.
- Filtros da DLQ são **server-side** (commit 7 + 8): a DLQ pode ter centenas/milhares
  de itens, então filtrar no backend evita trazer tudo pro cliente.
- `GET /api/worker/dlq` distingue `total` (zcard global, badge do header) de
  `totalFiltered` (após filtros) para a UI não mentir sobre a contagem.
- Auto-refresh de 30s **independente** do auto-refresh global do header (a DLQ é a
  parte mais dinâmica da tela).
- Sem stubs: cada feature foi validada no browser headless + curl antes do commit.

---

## Commits entregues

| # | Hash | Título | O que entregou |
|---|------|--------|----------------|
| 1 | `22c0cb5` | feat(web): add worker counter helpers and complete PT-BR labels | `lib/worker-counters.ts` (parseCounterKey, sumByName, aggregateByLabel, rankedByLabel) + dicionários PT-BR completos em `lib/worker-status.ts` |
| 2 | `7fb2b6a` | feat(web): rewrite WorkerStatusPage as operational dashboard | 5 seções (Pipeline, Resumo Saúde, Ingestor, Dispatcher, DLQ) com cores distintas e indicador de frescor |
| 3 | `0148eb2` | feat(web): add freshness indicator and skeleton loading | dot verde/amarelo/vermelho por idade + skeletons |
| 4 | `396e35c` | feat(web): enrich DLQ item with queue/stage/body details | inferência de fila (A/B), etapa de falha, body original expansível, tooltip de dados |
| 5 | `3c7c100` | feat(web): add Queue and failureReason filters to DLQ | filtros client-side iniciais (depois substituídos por server-side) |
| 6 | `e3643fc` | feat(web): add 'Ver espelhamento' shortcut chip to DLQ items | atalho que abre `/mirror-form/:id` |
| 7 | `0ee6958` | feat(api): add queue/reason/since filters to GET /api/worker/dlq | **backend**: `listDLQ` aceita filtros; `listDlqItems` + rota parseiam query string; resposta com `total` + `totalFiltered` |
| 8 | `e4315c1` | feat(web): server-side DLQ filters, period filter, and 30s auto-refresh | migra filtros p/ server-side, dropdown "Período" (1h/24h/7d/30d/ISO), auto-refresh 30s com switch próprio |
| 9 | `b206df9` | feat(web): DLQ polish — copy JSON button + badge bump on new item | botão "Copiar JSON" (Clipboard API + fallback) e badge pulsante no crescimento do total |

---

## Especificação técnica

### Frontend

- `apps/web/src/pages/WorkerStatusPage.tsx` (~1474 linhas) — página completa.
- `apps/web/src/lib/worker-status.ts` — tipos `WorkerStatus`, `DLQEntry`, `DLQListResponse`,
  dicionários `COUNTER_LABELS` / `STEP_LABELS` / `LABEL_LABELS`, `getFailureMeta(reason)`.
- `apps/web/src/lib/worker-counters.ts` — agregação de counters Prometheus por label.
- `apps/web/src/styles/globals.css` — keyframe `.dlq-badge-bump` (pulse 3× 0.6s).

### Backend

- `apps/api/src/index.ts` — rotas `/api/worker/status` e `/api/worker/dlq*` (get/list/requeue/remove/purge).
- `apps/api/src/services/worker-metrics.ts` — `listDlqItems({ offset, limit, queue, failureReason, since })`.
- `packages/worker-common/src/dead-letter-queue.ts` — `listDLQ` com filtros in-memory
  (queue/reason) e corte no Redis via `ZREVRANGEBYSCORE` (since). Lê de
  `MIRROR_DLQ_INDEX` (ZSET, score=timestamp ms) + `MIRROR_DLQ_LIST` (LIST de payloads).

### Filtros da DLQ (`GET /api/worker/dlq`)

| Param | Tipo | Descrição |
|-------|------|-----------|
| `offset` | number | paginação (default 0) |
| `limit` | number | itens/página (default 20; → 100 quando há filtro ativo) |
| `queue` | `A`\|`B` | fila de origem (A=Ingestor/RawMessageEvent, B=Dispatcher/SendEvent) |
| `reason` | string | failureReason exato |
| `since` | ISO \| `Nh`\|`Nd` | data de falha (ISO ou relativo, ex: `24h`, `7d`) |

Resposta: `{ success, items[], total, totalFiltered, offset, limit }`.

---

## Validação

- `bunx tsc --noEmit` → 0 erros em todos os commits.
- `bun run build` → OK.
- Pre-commit hook (tsc) → passou no commit 9.
- Browser headless: 5 cards renderizam, filtros server-side funcionam (`queue=A`→800,
  `queue=B`→0, `reason=conversion_failed`→782, `since=24h`→0), auto-refresh 30s,
  "Copiar JSON" copia 820 chars, badge pulsa 800→801.
- curl: todas as combinações de filtro retornam `total`/`totalFiltered` corretos.

---

## Notas para manutenção futura

- Para adicionar um novo `failureReason`, mapear em `LABEL_LABELS.reason` (PT-BR) e
  em `getFailureMeta` (fila/etapa).
- Para novos counters Prometheus, adicionar label em `COUNTER_LABELS` / `STEP_LABELS`.
- O limite de 100 itens carregados por página quando há filtro é intencional
  (evita trafegar a DLQ inteira). Paginação real além de 100 não foi implementada.
