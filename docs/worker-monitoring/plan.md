# Worker Monitoring — Plano de implementação

**Worktree:** `wt/worker-monitoring-9def26`
**Branch base:** `main` @ `1329732`
**Objetivo:** tela de monitoramento de saúde + performance dos workers (Ingestor + Dispatcher) e das filas que eles consomem.

---

## Escopo (decidido pelo usuário)

A tela deve responder, à primeira vista:

> Os 2 workers (Ingestor, Dispatcher) estão **saudáveis** e **performáticos**?

Métricas que precisam estar visíveis (lista fornecida pelo usuário):

| Métrica | Fonte backend | Hoje exposto? |
|---|---|---|
| Uptime | `status.uptime` / `uptimeSeconds` | ✅ |
| Health check atual | `status.status` (`healthy` / `degraded`) + `reachable` | ✅ |
| Quantidade de ofertas postadas | `sender_messages_sent_total{marketplace}` | ✅ |
| Posts bloqueados | `pipeline_messages_blocked_total{reason}` | ✅ |
| Posts inválidos | parte de `pipeline_messages_blocked_total{reason: conversion_failed}` | ✅ |
| Mensagens nas filas (Queue A / Queue B) | `XLEN` em `MIRROR_RAW_STREAM` / `MIRROR_SEND_STREAM` | ✅ |
| Mensagens na DLQ | `countDLQ()` | ✅ |

**Fora do escopo desta worktree (decisão explícita):**
- Ações remotas (start/stop/restart) — só diagnóstico.
- Séries temporais reais (sparklines) — snapshot apenas, suficiente para o objetivo.
- Alertas proativos (notificações) — só badges visuais.
- Sub-rotas separadas — uma única página com seções.

---

## Análise técnica

### Backend já expõe TUDO que precisamos

O `metrics-server.ts` retorna um payload com:
- `service`, `status`, `uptime`, `uptimeSeconds`, `startTime`, `mode` → saúde
- `queueSize` (via `setQueueSizeProvider` → `XLEN`) → fila
- `dlqCount` (via `countDLQ`) → DLQ
- `stepDurations` (avg/p50/p99/count por step) → performance
- `errors` (últimos 20, com count) → saúde
- `counters` (`Record<string, number | string>`) → throughput, bloqueios, posts

Os contadores com **labels Prometheus** (ex: `pipeline_messages_blocked_total{reason=conversion_failed}`) chegam na UI como chaves únicas no `counters` (formato `name{label1=v1,label2=v2}`). A UI atual **renderiza todos como uma grid genérica de "Métricas"**, sem agregar por label — perdendo a visibilidade por marketplace/reason.

### O que precisa mudar

1. **UI atual lê `counters` como chaves flat** (`pipeline_messages_received_total: 12`) e renderiza grid genérica. Precisa:
   - Parsear a chave com labels (`name{...}`) em nome base + labels
   - Agregar por label canônica (ex: somar `sender_messages_sent_total` por `marketplace`)
   - Renderizar seções agrupadas, não grid genérica
2. **Labels PT-BR incompletos em `lib/worker-status.ts`** — só alguns estão mapeados. Vamos completar para TODOS os counters expostos hoje (e adicionar os que existem no backend mas não tinham label).
3. **"Health check atual" não tem drilldown** — só `status: 'healthy'`. Vamos mostrar:
   - Uptime formatado (já tem)
   - Modo (já tem)
   - Quantos erros distintos nas últimas horas
   - Quando foi o último erro (`recentErrors[0].time`)
4. **DLQ section está como sub-card** — usuário quer ver "mensagens na DLQ" em destaque. Vamos subir para card dedicado no topo, com badge grande e link "ver detalhes" que abre expansão inline.
5. **Separação visual Ingestor vs Dispatcher** — cards hoje são visualmente similares, mas têm papéis muito diferentes. Vamos diferenciar com cores/bordas sutis e ícones.

### O que NÃO precisa mudar no backend

Tudo. O backend (`/api/worker/status` + `/api/worker/dlq*`) já retorna os dados necessários. Esta é uma reescrita **100% frontend**.

---

## Estrutura da nova página

```
┌─────────────────────────────────────────────────────────┐
│  Header: "Status do Worker" + Auto + Atualizar          │
├─────────────────────────────────────────────────────────┤
│  [Card 1] 🔗 Pipeline — Queue A → Ingestor → Queue B    │
│            → Dispatcher → Evolution (5 nós horizontais) │
├─────────────────────────────────────────────────────────┤
│  [Card 2] 📊 Resumo de Saúde (Ingestor + Dispatcher)    │
│            Grid 2 colunas:                              │
│            • Uptime / Modo / Iniciado / Último erro     │
│            • DLQ count / Queue size / Erros distintos   │
├─────────────────────────────────────────────────────────┤
│  [Card 3] 📥 Ingestor (separado)                        │
│            • Métricas por seção: Recebidas / Bloqueadas │
│              (com breakdown por reason) / Publicadas    │
│            • Latência por etapa (tabela)                │
│            • Últimos erros                              │
├─────────────────────────────────────────────────────────┤
│  [Card 4] 📤 Dispatcher (separado)                      │
│            • Enviadas (com breakdown por marketplace)   │
│            • Descartadas (com breakdown por reason)     │
│            • Falhas (com breakdown por type/marketplace)│
│            • Latência por etapa                          │
│            • Últimos erros                              │
├─────────────────────────────────────────────────────────┤
│  [Card 5] 🗑️ DLQ (destaque, com expansão)               │
└─────────────────────────────────────────────────────────┘
```

**Decisão de design:** master-detail 60/40 (lista + detalhe) só na DLQ expandida — o resto é dashboard linear, que é o padrão para "ver tudo de uma vez".

---

## Commits planejados (ordem por dependência)

### Commit 1: Tipagem e helpers (`lib/worker-status.ts` + `lib/worker-counters.ts`)

**Escopo:**
- Criar `lib/worker-counters.ts` com:
  - Tipo `CounterKey = { name: string; labels: Record<string, string> }` parseado da chave Prometheus
  - Função `parseCounterKey(raw: string): CounterKey`
  - Função `aggregateByLabel(counters, name, labelKey)` → agrupa por valor de uma label
  - Função `sumByLabel(counters, name)` → soma total independente de labels
- Completar o `COUNTER_LABELS` e `STEP_LABELS` em `lib/worker-status.ts` com TODOS os counters que o backend expõe hoje (incluindo os com labels)
- Adicionar `LABEL_LABELS` (label values → PT-BR) para `reason` (`conversion_failed`, `no_url`, `multiple_product_links`, `shopee_shortlink_only`, `coupon_only`, `global_blacklist`, `global_whitelist`, `affiliate_link_mismatch`, `deduplicated`, `mirror_inactive`, `no_target_group`) e `type` (`rate_limited`, `group_rate_limited`, `send_failed`)

**Critério de aceite:**
- `bunx tsc --noEmit` 0 erros
- `bun run build` OK
- Helpers testáveis via `console.log` simples em dev (sem testes E2E nesta fase)

### Commit 2: Reescrita da `WorkerStatusPage.tsx`

**Escopo:**
- Estrutura de 5 cards conforme diagrama acima
- Pipeline view (preserva o componente existente, mas com legenda "atualizado em")
- Cards Ingestor/Dispatcher separados com cores distintas (border-left-color)
- DLQ em card dedicado com expansão inline (já existe, mas promove para top-level)
- Polling 15s (já existe) + indicador "Atualizado há Xs" no header
- Empty/loading states explícitos (não só "Carregando..." no topo)

**Pitfalls a evitar:**
- Regressão de tema: CSS vars do design system, sem inline hardcoded (#fff, #000)
- Mobile: cards em coluna única, DLQ empilhada
- Overlap em filtros: usar flex-wrap (lição da memória: Radix Select + CSS Grid)

**Critério de aceite:**
- `bunx tsc --noEmit` 0 erros
- `bun run build` OK
- `docker compose -f docker-compose.dev.yml build api web && docker compose -f docker-compose.dev.yml up -d api web`
- `browser_navigate` em `http://localhost:5451/worker-status` + `browser_vision` para inspeção visual
- Screenshot mostra os 5 cards em desktop e mobile (375px width)

### Commit 3: Refinamentos e validação

**Escopo:**
- Tooltips em counters explicando o que é cada label (`title` attr ou componente)
- Empty state amigável: "Nenhuma mensagem bloqueada ainda" / "Nenhuma falha registrada"
- Loading state com skeleton (não só texto "Carregando...")
- Ajuste de espaçamentos e tipografia para consistência com resto do app
- Validação final: `bunx tsc --noEmit`, `bun run build`, screenshot final

**Critério de aceite:**
- typecheck 0 erros
- build OK
- Visual check no browser, ajuste fino se necessário
- Commit limpo, sem WIP

---

## Verificação end-to-end

Antes de cada commit, dentro da worktree:

```bash
cd .worktrees/worker-monitoring
bunx tsc --noEmit           # 0 erros
bun run build               # OK
```

Para os commits 2 e 3, depois do build:

```bash
docker compose -f docker-compose.dev.yml build api web
docker compose -f docker-compose.dev.yml up -d api web
# Browser: http://localhost:5451/worker-status
```

**Critério de aceite final (todos os 3 commits):**
- [ ] `bunx tsc --noEmit` 0 erros
- [ ] `bun run build` 0 erros
- [ ] Página renderiza 5 cards
- [ ] Ingestor mostra "Recebidas", "Bloqueadas" (com breakdown por reason), "Publicadas"
- [ ] Dispatcher mostra "Enviadas" (por marketplace), "Descartadas" (por reason), "Falhas" (por type)
- [ ] Pipeline mostra Queue A e Queue B com XLEN real
- [ ] DLQ aparece em destaque com expansão
- [ ] Mobile (375px) renderiza sem overflow horizontal
- [ ] Auto-refresh funciona a cada 15s
