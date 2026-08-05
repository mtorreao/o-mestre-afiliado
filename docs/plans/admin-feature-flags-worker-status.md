# Plan: Feature Flags + Worker Status no admin-center

> **Status:** 📋 Proposto. Aguardando aprovação do owner.
> **Branch:** `wt/admin-center` (já existe um branch com a Fase 0 — admin-api/admin-web base).
> **Owner:** Matheus Torreão.
> **Última atualização:** 2026-08-04.

## Contexto

O `apps/admin-api` (Hono + Bun, :9090) + `apps/admin-web` (React, :9091) hoje servem só
fluxo de deploy (webhook Ed25519 + UI de histórico). O owner usa o `apps/web`+`apps/api`
para operar **feature flags** (kill switch de envio, modo manutenção) e o **status do
worker** (saúde de Ingestor/Dispatcher, DLQ). Esses fluxos exigem login admin via JWT
do `@omestre/ui` `useAuth` + claim `isAdmin` — operação dolorosa em contexto de
emergência (deploy quebrado, dispatcher travado, fila lotada).

**Decisão do owner (2026-08-04):** mover ambos para `admin-api`/`admin-web` —
single-user já tem sessão (Basic → Bearer, 12h), e o painel admin fica
auto-contido. Sem proxy entre `apps/api` e `apps/admin-api` — compartilham
o mesmo PostgreSQL e Redis.

**Estratégia de entrega (decisão 2026-08-04):** **1 PR único e testado**, delegando
ao coder (subagente). Após merge, validar com a spec. O PR é grande mas evita
divisão artificial entre "infra Redis compartilhada" e "uso da infra" — toda a
cadeia fica verde de uma vez.

## Estado atual observado

### Feature flags (apps/api + apps/web)

**Backend — `apps/api/src/modules/admin/feature-flags.routes.ts` (175 LOC)**

- Factory `createFeatureFlagsRoutes(deps?)` injeta `flagRepo`, `getAdmin`, `flags`, `allFlagKeys`, `countFlagChecks`, `invalidateFlagCache`, `publishFlagInvalidation`.
- Endpoints: `GET /api/admin/feature-flags`, `PATCH /api/admin/feature-flags/:key`.
- Auth: `requireAdmin` — JWT + `user.isAdmin === true` (401 vs 403 distintos).
- Testes: `apps/api/src/modules/admin/__tests__/feature-flags.routes.handlers.test.ts`.

**Frontend — `apps/web/src/pages/FeatureFlagsPage.tsx` (165 LOC)**

- Consome `useAuth().token` (JWT) + `useAuth().isAdmin` (guard de render).
- Lista flags em `Card` (uma por linha), `Switch` para toggle, `Badge` para status.
- Confirmação extra via `window.confirm()` quando `flag.danger === true`.
- Token: `Authorization: Bearer ${token}`.

**Estado no admin-web: ❌ não existe.** `lib/api.ts` não tem `listFlags`/`toggleFlag`.

### Worker status (apps/api + apps/web)

**Backend — `apps/api/src/modules/admin/worker-admin.routes.ts` (84 LOC)**

- Factory `createWorkerAdminRoutes(deps?)` injeta `getSuperAdmin`, `getAggregatedWorkerStatus`, `listDlqItems`, `requeueDlqItem`, `removeDlqItem`, `purgeDlq`.
- Endpoints: `GET /api/worker/status`, `GET /api/worker/dlq`, `POST /api/worker/dlq/requeue`, `POST /api/worker/dlq/remove`, `POST /api/worker/dlq/purge`.
- Auth: `getSuperAdmin` (gate duplo `users.is_admin` **E** `ADMIN_EMAILS`).
- **Decisão: ignorar `getSuperAdmin` — admin-api já é single-user com sessionAuth.**

**Backend — `apps/api/src/services/worker-metrics.ts` (155 LOC) + `worker-metrics-pure.ts` (62 LOC)**

- `getAggregatedWorkerStatus()` faz fetch do `/status` HTTP dos workers (Ingestor :9092, Dispatcher :9093) + `XLEN` de `omestre:mirror:raw` e `omestre:mirror:send`.
- `listDlqItems(filters)` / `requeueDlqItem` / `removeDlqItem` / `purgeDlq` operam direto no Redis via `packages/worker-common`.
- Funções puras isoladas em `worker-metrics-pure.ts` (testáveis 100%).

**Frontend — `apps/web/src/pages/WorkerStatusPage.tsx` (1.791 LOC) + `lib/worker-status.ts` (298 LOC) + `lib/worker-counters.ts` (110 LOC)**

- 5 seções: Pipeline, Saúde, Ingestor, Dispatcher, DLQ.
- Auto-refresh + indicador de frescor, badge pulsante da DLQ, expansão inline, copiar JSON.
- Dicionários PT-BR (`COUNTER_LABELS`, `STEP_LABELS`, `LABEL_LABELS`, `getFailureMeta`).
- Helpers: `parseCounterKey`, `sumByName`, `aggregateByLabel`, `rankedByLabel`.

**Estado no admin-web: ❌ não existe.**

### Estado atual do admin-api

| Aspecto      | Hoje                                                                           | Gap                                                                          |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Pacotes      | `hono`, `@omestre/worker-common`                                               | Falta: `@omestre/db`, `@omestre/feature-flags-sdk`, `ioredis`, `drizzle-orm` |
| Auth         | `sessionAuth()` (Basic → Bearer 12h)                                           | OK — single-user, sem `isAdmin`                                              |
| Redis        | **não tem** `getRedis()` singleton                                             | Reusar `@omestre/feature-flags-sdk`                                          |
| PG           | **não tem** `getDb()`                                                          | Reusar `@omestre/db`                                                         |
| Compose prod | `admin-api` **NÃO está no `docker-compose.yml`** (só `docker-compose.dev.yml`) | Compose prod ganha ambos                                                     |
| Compose dev  | `admin-api` em `docker-compose.dev.yml` (linha 352) já com `env_file: .env`    | OK — Redis/PG vão via `.env` do monorepo                                     |

**Env vars que precisam estar no `.env` do monorepo:**

- `POSTGRES_URL` (ou `POSTGRES_HOST`/`PORT`/`DATABASE`/`USERNAME`/`PASSWORD` — Drizzle aceita ambos)
- `REDIS_URL` (ex.: `redis://redis:6379` — formato igual em prod/compose-dev)
- `METRICS_API_KEY` (header `x-api-key` dos workers — deve ser **igual** ao `apps/api`)
- `WORKER_METRICS_URL` + `DISPATCHER_METRICS_URL` (URLs HTTP dos `/status` dos workers)

**Não precisam:**

- `JWT_SECRET` (não usamos JWT, só session em memória)
- `OMESTRE_DB_*` (mesmo `omestre` schema)

## Decisões de arquitetura

1. **Auth = `sessionAuth()` apenas.** Remover `getSuperAdmin` de `worker-admin.routes.ts` no port — admin-api é single-user, gate adicional seria teatro. (Confirmado pelo owner.)
2. **Sem proxy entre `apps/api` e `apps/admin-api`.** Cada um bate no mesmo PG/Redis. As rotas do admin-api **não fazem fetch** no `apps/api` — operam diretamente no banco e Redis. Isso simplifica o código e evita o fan-out `admin-api → api :5442 → workers :9092/:9093` virar `admin-api → workers :9092/:9093` direto.
3. **Portar (quase) 1:1 o `WorkerStatusPage.tsx` (1.791 LOC).** Decisão do owner. Vai ser o maior arquivo do `admin-web`. Sem cortes — a UI rica (polling, expansão, copiar JSON) é exatamente o que o owner usa em emergências.
4. **Factory `createWorkerAdminRoutes` / `createFeatureFlagsRoutes` mantém dep injection.** Permite testar Hono com `app.request()` (Bun test) sem subir servidor.
5. **Reusar lógica pura onde der.** `worker-metrics-pure.ts` é **agnóstico de framework** (Elysia/Hono). Copio o arquivo para `apps/admin-api/src/services/worker-metrics-pure.ts` (assim evita import cross-app, que é OK no monorepo mas traz ruído). Quem mover lógica de I/O (worker-metrics.ts) cria o orquestrador Hono em `apps/admin-api/src/services/worker-metrics.ts`.
6. **TypeScript: `verbatimModuleSyntax: true`** — `import type` para tipos. Verificar.
7. **Composição de rotas em `apps/admin-api/src/index.ts`**: criar `featureFlagsRoutes(log)` e `workerRoutes(log)` factories no estilo `adminRoutes()`. Montar:
   ```ts
   app.route('/api/admin', featureFlagsRoutes({ ... }));
   app.route('/api/admin', workerRoutes({ ... }));
   ```
8. **Sem `docs/specs/` move imediato.** A spec fica em `docs/plans/` até code + test verde em prod. Promoção a spec só depois do PR mergeado.

### Decisão central: `@omestre/feature-flags-sdk` (infra Redis compartilhada)

**Problema:** `apps/api` já tem helpers Redis (`getRedis`, `publishFlagInvalidation`, `invalidateFlagCache`, `countFlagChecks`) inline em `apps/api/src/modules/admin/feature-flags.routes.ts` e `packages/feature-flags/src/redis.ts`. Quando `apps/admin-api` ganhar feature-flags, vai precisar dos mesmos helpers. Copiar = duplicação. Criar HTTP entre os 2 apps = novo acoplamento.

**Solução:** extrair a **infra Redis compartilhada** para `packages/feature-flags-sdk/`. O SDK é **infra puro** (sem HTTP, sem resolver, sem rotas) — só wrappers `ioredis` + constantes de chave + PubSub. Os 2 apps continuam com seus próprios resolvers e regras de negócio, mas compartilham o canal PubSub e formato de chave.

**Conteúdo do pacote:**

```
packages/feature-flags-sdk/
├── src/
│   ├── keys.ts          const FLAG_STATS_KEY_PREFIX, FLAG_INVALIDATE_CHANNEL
│   ├── redis.ts         getFlagRedis(): Redis lazy singleton (1 conexão por processo)
│   ├── pubsub.ts        publishFlagInvalidation(key), subscribeFlagInvalidation(cb)
│   ├── metrics.ts       countFlagChecks(key), buildFlagStatsKey(YYYYMMDDHHMM)
│   └── index.ts         re-export
├── package.json         deps: ioredis (catalog)
├── tsconfig.json
└── tests/               testes com ioredis-mock
```

**Quem consome o quê:**

| Componente                                           | Helper local                                                | Usa SDK?                                          |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `apps/api/src/modules/admin/feature-flags.routes.ts` | `getRedis()` standalone, `publishFlagInvalidation()` inline | **Não** (migração = PR 2 opcional, fora deste PR) |
| `packages/feature-flags/src/redis.ts`                | `getFlagRedis()` próprio                                    | **Não** (resolução local permanece)               |
| `apps/admin-api/src/routes/feature-flags.ts` (novo)  | chama `getFlagRedis` do SDK                                 | **Sim**                                           |
| `apps/admin-api/src/routes/worker.ts` (novo)         | chama `getFlagRedis` do SDK para PubSub DLQ                 | **Sim**                                           |

**Justificativa de YAGNI:** isola o SDK com testes. O `apps/api` **continua funcionando** sem migração porque o PubSub Redis usa as mesmas chaves (`omestre:flag:invalidate`) independente de quem publica. Migração do `apps/api` para SDK fica para um PR 2 opcional.

## Modelo de dados

**Sem mudança.** As rotas consomem tabelas já existentes:

- `omestre.feature_flags` (migration `0016_add_feature_flags.sql`) — GET/PATCH.
- `omestre.mirrors` — não tocado.
- Redis: `omestre:mirror:dlq` (LIST + ZSET), `omestre:mirror:raw` (STREAM), `omestre:mirror:send` (STREAM), `omestre:flag:stats:{key}:{YYYYMMDDHHMM}` (counter).

## Contratos de API

### `apps/admin-api` — Feature Flags

```
GET  /api/admin/feature-flags         → { success: true, flags: FlagListItem[] }
PATCH /api/admin/feature-flags/:key   body: { enabled: boolean } → { success, flag }
```

Headers: `Authorization: Bearer <session-token>` (exceto `/health`).

`FlagListItem` (igual ao `apps/api`):

```ts
{
  key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  danger: boolean;
  checksLastHour: number;
  updatedBy: string | null;
  updatedAt: string | null;
}
```

Mesma forma de erro: HTTP 401 (sem session), HTTP 200 com `success: false` (erros de negócio).

### `apps/admin-api` — Worker Status

```
GET  /api/admin/worker/status                                  → { success, services, pipeline: { queueA, queueB } }
GET  /api/admin/worker/dlq?offset&limit&queue&reason&since     → { success, total, totalFiltered, items }
POST /api/admin/worker/dlq/requeue?id=                          → { success, targetStream }
POST /api/admin/worker/dlq/remove?id=                           → { success }
POST /api/admin/worker/dlq/purge                                → { success, removed }
```

**Diferença para o `apps/api`:** rota `/api/worker/*` → `/api/admin/worker/*` (não colide com o `apps/web` proxy). Mantém o prefixo `/api/admin` para casar com o guard de sessão já aplicado em `app.use('*', sessionAuth())` no `routes/admin.ts`.

## Fluxo de dados

```
Operador (admin-web)
  │
  │ GET /api/admin/feature-flags
  ▼
admin-api (Hono)
  │
  ├── sessionAuth()  → 401 se sem Bearer
  ├── FeatureFlagRepository.findAll()  → PG omestre.feature_flags
  ├── Promise.all(FLAGS.map(countFlagChecks))  → Redis INCR omestre:flag:stats:{key}:{YYYYMMDDHHMM}
  └── { success: true, flags: [...] }

Operador (admin-web)
  │
  │ PATCH /api/admin/feature-flags/maintenance_mode  { enabled: true }
  ▼
admin-api
  ├── sessionAuth()
  ├── FeatureFlagRepository.upsert(key, enabled, 'admin')
  ├── invalidateFlagCache(key)         → TTL 10s limpo
  └── publishFlagInvalidation(key)     → PubSub Redis omestre:flag:invalidate
                                                  (Dispatcher e outros workers re-leem)

Operador → GET /api/admin/worker/status
admin-api
  ├── sessionAuth()
  ├── Promise.all([
  │   fetch(WORKER_METRICS_URL + '/status', headers: { x-api-key: METRICS_API_KEY }),
  │   fetch(DISPATCHER_METRICS_URL + '/status', headers: { x-api-key: METRICS_API_KEY }),
  │   redis.xlen(MIRROR_RAW_STREAM),
  │   redis.xlen(MIRROR_SEND_STREAM),
  │ ])
  └── { success, services: [ingestor, dispatcher], pipeline: { queueA, queueB } }

Operador → POST /api/admin/worker/dlq/requeue?id=X
admin-api
  ├── sessionAuth()
  ├── getDLQItem(id) → Redis
  ├── inferRequeueTargetStream(event) → 'omestre:mirror:raw' | 'omestre:mirror:send'
  ├── requeueFromDLQ(id, targetStream) → XADD + ZREM
  └── { success: true, targetStream }
```

## Lógica pura isolada

| Função                     | Local atual                                       | Próximo local                                                        |
| -------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| `buildMetricsAuthHeaders`  | `apps/api/src/services/worker-metrics-pure.ts:17` | `apps/admin-api/src/services/worker-metrics-pure.ts` (cópia literal) |
| `normalizeDlqFilters`      | `worker-metrics-pure.ts:23`                       | idem                                                                 |
| `hasServerSideFilter`      | `worker-metrics-pure.ts:34`                       | idem                                                                 |
| `computeEffectiveDlqLimit` | `worker-metrics-pure.ts:41`                       | idem                                                                 |
| `inferRequeueTargetStream` | `worker-metrics-pure.ts:51`                       | idem                                                                 |

**Decisão:** copiar (não re-exportar) os arquivos `*.pure.ts` para `apps/admin-api/src/`. Justificativa: o admin-api já roda isolado no VPS, e cross-app import (`@omestre/api-worker-metrics-pure`) ainda não é workspace. Cópia é válida — `apps/api` mantém o mesmo arquivo (não removo nada do `apps/api`; mantenho as rotas `/api/admin/feature-flags` e `/api/worker/*` ativas para o `apps/web` continuar funcionando).

**Cuidado:** ao copiar, manter assinatura **idêntica** — qualquer divergência quebra a UI do `apps/web` se eu não tomar cuidado. Solução: rodar `bun run test:unit` em **ambos** apps após o port.

## Pontos de integração

### `packages/feature-flags-sdk` (NOVO)

**Novos arquivos:**

- `packages/feature-flags-sdk/package.json` — name `@omestre/feature-flags-sdk`, deps `ioredis` (catalog), `drizzle-orm` (peer opcional, não usado).
- `packages/feature-flags-sdk/tsconfig.json` — estende `../../tsconfig.json`.
- `packages/feature-flags-sdk/src/keys.ts` — constantes `FLAG_STATS_KEY_PREFIX = 'omestre:flag:stats:'`, `FLAG_INVALIDATE_CHANNEL = 'omestre:flag:invalidate'`, helper `buildFlagStatsKey(key, bucket)`.
- `packages/feature-flags-sdk/src/redis.ts` — `getFlagRedis(redisUrl?): Redis | null` (lazy singleton, fallback silencioso).
- `packages/feature-flags-sdk/src/pubsub.ts` — `publishFlagInvalidation(key)`, `subscribeFlagInvalidation(cb)`.
- `packages/feature-flags-sdk/src/metrics.ts` — `countFlagChecks(key)`, `buildFlagStatsKey`.
- `packages/feature-flags-sdk/src/index.ts` — re-export.
- `packages/feature-flags-sdk/src/keys.test.ts` + `redis.test.ts` + `pubsub.test.ts` + `metrics.test.ts` — testes com `ioredis-mock`.

**Arquivos editados:**

- `package.json` (raiz) — adicionar `"packages/feature-flags-sdk"` aos `workspaces`.

**Não fazer:** NÃO mover `packages/feature-flags/src/redis.ts` para o SDK. O resolver local permanece intocado. A migração é PR 2 (opcional, fora deste PR).

### `apps/admin-api`

**Novos arquivos:**

- `src/services/redis.ts` — wrapper local fino sobre `getFlagRedis` do SDK (re-export com fallback).
- `src/services/worker-metrics.ts` — orquestrador Hono (substituir Elysia por Hono).
- `src/services/worker-metrics-pure.ts` — cópia de `apps/api/src/services/worker-metrics-pure.ts`.
- `src/services/worker-metrics.test.ts` — testes da lógica pura + I/O com mock.
- `src/routes/feature-flags.ts` — Hono routes (substituir `featureFlagsRoutes` factory).
- `src/routes/worker.ts` — Hono routes (substituir `workerAdminRoutes` factory).
- `src/routes/feature-flags.test.ts` — testes com `app.request()`.
- `src/routes/worker.test.ts` — idem.

**Arquivos editados:**

- `src/index.ts` — montar `app.route('/api/admin', featureFlagsRoutes(log))` + `app.route('/api/admin', workerRoutes(log))`.
- `src/config.ts` — adicionar `redisUrl`, `postgresUrl`, `metricsApiKey`, `workerMetricsUrl`, `dispatcherMetricsUrl` ao `loadConfig()` (com defaults seguros).
- `package.json` — adicionar deps `@omestre/db`, `@omestre/feature-flags-sdk`, `ioredis`, `drizzle-orm`.

### `apps/admin-web`

**Novos arquivos:**

- `src/pages/FeatureFlagsPage.tsx` — quase cópia de `apps/web/src/pages/FeatureFlagsPage.tsx`; troca `useAuth` (do `apps/web`) por `getToken()` (do `lib/api.ts`); mantém `Card`/`Switch`/`Badge` do `@omestre/ui`.
- `src/pages/WorkerStatusPage.tsx` — cópia de `apps/web/src/pages/WorkerStatusPage.tsx`; ajusta imports.
- `src/lib/worker-status.ts` — cópia literal.
- `src/lib/worker-counters.ts` — cópia literal.

**Arquivos editados:**

- `src/App.tsx` — adicionar `<Route path="/feature-flags" element={<FeatureFlagsPage />} />` + `<Route path="/worker-status" element={<WorkerStatusPage />} />`.
- `src/pages/DashboardPage.tsx` — 2 cards de atalho para as duas páginas novas.
- `src/lib/api.ts` — adicionar `listFlags`, `toggleFlag`, `getWorkerStatus`, `listDlq`, `requeueDlq`, `removeDlq`, `purgeDlq`.

### `docker-compose.yml` (produção)

**Edição crítica:** adicionar serviço `admin-api` (idiêntico ao do `docker-compose.dev.yml` linhas 352-381) e `admin-web` (já existe no compose dev linhas 381-397). Sem isso, o feature flag operacional não fica disponível no VPS.

**Env vars para prod (no `docker-compose.yml`):**

- `REDIS_URL=redis://redis:6379`
- `POSTGRES_URL=postgresql://...` (igual aos outros apps)
- `METRICS_API_KEY` (mesmo valor do `apps/api`)
- `WORKER_METRICS_URL=http://ingestor:9092`
- `DISPATCHER_METRICS_URL=http://dispatcher:9093`

**Dependência:** `admin-api` precisa ser capaz de resolver `redis` e `ingestor`/`dispatcher` por hostname dentro da rede `omestre-prod-net`. Validar antes de subir.

### `docs/roadmap.md`

Adicionar entrada em **Phase 8 (admin-center no VPS)**:

- 🚧 Admin-center feature flags + worker status (em andamento) — `docs/plans/admin-feature-flags-worker-status.md`

Não renumerar phases existentes.

### `AGENTS.md`

Adicionar entrada na seção "Admin API" / "Admin Web" referenciando as duas páginas.

## Testes

### Unit (obrigatórios)

**`packages/feature-flags-sdk`:**

- `keys.test.ts` — `buildFlagStatsKey` (formato `omestre:flag:stats:{key}:{YYYYMMDDHHMM}`)
- `redis.test.ts` — `getFlagRedis` lazy + fallback silencioso
- `pubsub.test.ts` — `publishFlagInvalidation` publica no canal certo
- `metrics.test.ts` — `countFlagChecks` soma INCR nos buckets da última hora

**`apps/admin-api`:**

| Arquivo                                | Caso de teste                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `routes/feature-flags.test.ts`         | GET sem Bearer → 401                                                                                    |
|                                        | GET com Bearer + flagRepo.list vazia → retorna 2 flags com defaults                                     |
|                                        | GET com Bearer + flags existentes → retorna enabled correto                                             |
|                                        | GET com Bearer + erro de DB → 200 `{ success: false, error: 'Erro interno' }`                           |
|                                        | PATCH com Bearer + key inválida → 200 `{ success: false, error }`                                       |
|                                        | PATCH com Bearer + key válida → upsert + invalidateCache + publishInvalidation chamados                 |
| `routes/worker.test.ts`                | GET /status sem Bearer → 401                                                                            |
|                                        | GET /status com Bearer + Redis/Alvos offline → 200 services reachable=false                             |
|                                        | GET /status com Bearer + Redis offline → queueA/queueB = null                                           |
|                                        | GET /dlq?offset=0 → lista itens                                                                         |
|                                        | POST /dlq/requeue?id=X sem token → 401                                                                  |
|                                        | POST /dlq/requeue?id=X → 200 success                                                                    |
|                                        | POST /dlq/remove?id=X → 200 success                                                                     |
|                                        | POST /dlq/purge → 200 removed                                                                           |
| `services/worker-metrics-pure.test.ts` | Mirror exato dos testes em `apps/api/src/services/worker-metrics-pure.test.ts` (pode usar `cp` + patch) |

Meta: ≥ 80% cobertura linhas no `apps/admin-api/src/routes/feature-flags.ts` + `worker.ts` + `worker-metrics.ts` (será puxado pelo `bun run test:coverage`).

**Web (admin-web):** testes unitários não obrigatórios (UI portada). Validação visual via DevServer ou browser + Playwright (ver E2E manual).

### E2E (manual)

A stack E2E (`bun run test:e2e`) monta **só** `apps/api` + `apps/web`, não o `admin-web`. E2E do fluxo admin seria viável mas exige estender o `playwright.config.ts` (projeto `admin-ui`) — fora do escopo desta entrega. Owner valida manualmente no VPS após deploy.

**Checklist de validação manual em prod:**

- [ ] `admin.omestreafiliado.com.br` carrega login.
- [ ] Após login, `/feature-flags` lista 2 flags.
- [ ] Toggle de `evolution_send_enabled` muda o badge para "Desativado" em < 5s.
- [ ] Toggle de `maintenance_mode` bloqueia novos logins comuns (verificar com uma conta `não-admin`).
- [ ] `/worker-status` mostra `Queue A` (XLEN) e `Queue B` (XLEN).
- [ ] Em dev local com ingestor/dispatcher rodando, `/status` de cada um retorna 200.
- [ ] DLQ mostra items; requeue move para o stream correto.

## Critérios de aceite (1 PR único)

- [ ] `docs/plans/admin-feature-flags-worker-status.md` aprovada (status 📋 → 🚧).
- [ ] `packages/feature-flags-sdk` criado com `keys.ts`, `redis.ts`, `pubsub.ts`, `metrics.ts`, `index.ts` + testes.
- [ ] `package.json` raiz tem `packages/feature-flags-sdk` em `workspaces`.
- [ ] `apps/admin-api` ganha deps `@omestre/db`, `@omestre/feature-flags-sdk`, `ioredis`, `drizzle-orm`.
- [ ] `apps/admin-api/src/services/redis.ts` adaptado (re-export do SDK).
- [ ] `apps/admin-api/src/services/worker-metrics-pure.ts` copiado + `worker-metrics.test.ts` mirror.
- [ ] `apps/admin-api/src/services/worker-metrics.ts` (orquestrador Hono) implementado.
- [ ] `apps/admin-api/src/routes/feature-flags.ts` (Hono) com sessionAuth + GET/PATCH implementado.
- [ ] `apps/admin-api/src/routes/worker.ts` (Hono) com 5 endpoints implementados.
- [ ] `apps/admin-api/src/config.ts` lê `REDIS_URL`, `POSTGRES_URL`, `METRICS_API_KEY`, `WORKER_METRICS_URL`, `DISPATCHER_METRICS_URL`.
- [ ] `apps/admin-api/src/index.ts` monta `/api/admin/feature-flags*` + `/api/admin/worker/*`.
- [ ] `apps/admin-api/src/routes/feature-flags.test.ts` cobre os 6 casos.
- [ ] `apps/admin-api/src/routes/worker.test.ts` cobre os 7 casos.
- [ ] `bun run typecheck` verde (todos os workspaces).
- [ ] `bun run test:unit` verde.
- [ ] `bun run test:coverage` mantém ≥ 80% ajustado.
- [ ] `apps/admin-web/src/pages/FeatureFlagsPage.tsx` portada.
- [ ] `apps/admin-web/src/pages/WorkerStatusPage.tsx` portada (1.791 LOC).
- [ ] `apps/admin-web/src/lib/worker-status.ts` + `worker-counters.ts` copiados.
- [ ] `apps/admin-web/src/lib/api.ts` com `listFlags`/`toggleFlag`/`getWorkerStatus`/`listDlq`/`requeueDlq`/`removeDlq`/`purgeDlq`.
- [ ] `apps/admin-web/src/App.tsx` rotas `/feature-flags` + `/worker-status` + `DashboardPage` com atalhos.
- [ ] `docker-compose.yml` (prod) ganha `admin-api` + `admin-web` com vars certas.
- [ ] `docker-compose.dev.yml` (dev) já tem ambos — só verificar vars.
- [ ] `.env.example` (raiz) documenta `REDIS_URL`, `METRICS_API_KEY`, `WORKER_METRICS_URL`, `DISPATCHER_METRICS_URL` para o admin-api.
- [ ] Commit + push + PR description linkando este plano.

### Após merge (limpeza)

- [ ] `docs/roadmap.md` atualizado com item entregue.
- [ ] `docs/plans/admin-feature-flags-worker-status.md` atualizado com revision history + Estado real.
- [ ] `AGENTS.md` com referência às 2 capacidades (entrada `Admin-center feature flags + worker status`).

## Commits sugeridos (1 PR com 4 commits)

```
feat(feat-flags-sdk): novo pacote @omestre/feature-flags-sdk
  - keys.ts + redis.ts + pubsub.ts + metrics.ts com testes
  - usado por apps/admin-api (futuro)
feat(admin-api): feature-flags + worker-status + DLQ
  - routes/feature-flags.ts + routes/worker.ts com sessionAuth
  - services/worker-metrics.ts (orquestrador Hono)
  - services/worker-metrics-pure.ts (espelho de apps/api)
  - config.ts: new env vars
  - routes/feature-flags.test.ts + routes/worker.test.ts
feat(admin-web): portar FeatureFlagsPage + WorkerStatusPage
  - pages/FeatureFlagsPage.tsx + WorkerStatusPage.tsx
  - lib/worker-status.ts + lib/worker-counters.ts
  - lib/api.ts: listFlags + toggleFlag + getWorkerStatus + listDlq + requeueDlq + removeDlq + purgeDlq
  - App.tsx: rotas /feature-flags + /worker-status
  - DashboardPage: cards de atalho
chore(compose): adicionar admin-api/admin-web ao prod compose
  - docker-compose.yml com servicos admin-api/admin-web
  - .env.example documentando admin-api vars
```

## Riscos e mitigações

1. **`METRICS_API_KEY` ausente no `.env` (admin-api) ou divergente.** Sem key, `WORKER_METRICS_URL + '/status'` retorna 401 → `services[].reachable = false`. **Mitigação:** documentar em `.env.example` que deve ser **igual** ao `apps/api`. Adicionar warning no startup (não quebra) se vazio.

2. **`POSTGRES_URL` e `REDIS_URL` no admin-api soma ~2 conexões a mais no pool.** `apps/api` + `apps/ingestor` + `apps/dispatcher` + `apps/catalog-worker` + `apps/admin-api` = 5 conexões PG. Drizzle pool default `max=10` cobre. **Mitigação:** validar `docker stats` na fase de prod.

3. **`worker-metrics-pure.ts` duplicado pode divergir.** Se `apps/api` evoluir a função pura, o admin-api fica atrasado. **Mitigação:** comentários no topo de cada arquivo indicando "espelho de `apps/api/src/services/worker-metrics-pure.ts` — manter em sincronia". Idealmente, futuro: mover `*.pure.ts` para um workspace package (`@omestre/worker-metrics-pure`) — fora do escopo agora.

4. **WorkerStatusPage.tsx tem 1.791 LOC.** Adaptar sem cortar é um pacote grande. **Mitigação:** commits pequenos por capacidade (ícones PT-BR em um commit, polling em outro, expansão em outro) se necessário. Manter pré-renderização dos helpers em `lib/worker-status.ts` para não quebrar o `Map`/switch de dicionários.

5. **Compose prod sem `admin-api`/`admin-web` causa 502 em `admin.omestreafiliado.com.br` mesmo após deploy.** **Mitigação:** PR inclui o compose prod completo com healthcheck igual ao dev (`bun -e 'const r=await fetch(...)'`).

6. **`@omestre/feature-flags-sdk` exige `ioredis` em `apps/admin-api`.** Hoje o admin-api não tem `ioredis`. **Mitigação:** adicionar `ioredis` como dep do `apps/admin-api`. O SDK expõe `getFlagRedis(null)` que retorna `null` se Redis offline — fallback silencioso.

7. **DLQ no admin-api com `ioredis` exige `getFlagRedis()` que é lazy.** Se Redis offline, `listDLQ` retorna erro. **Mitigação:** mesma estratégia do `apps/api`: nunca lançar em `getAggregatedWorkerStatus()`; `listDlqItems` chama DLQ direto (deixa o erro propagar para 500 — é uma UI operacional, 500 é honesto).

## Critérios de promoção (plan → spec)

Quando PR mergeado + admin-web em prod + validação manual do owner:

1. `git mv docs/plans/admin-feature-flags-worker-status.md docs/specs/admin-feature-flags-worker-status.md`.
2. Atualizar o conteúdo: trocar "Estado atual observado" pelo estado real pós-deploy + revision history.
3. Atualizar `docs/roadmap.md`: mover de 📋 → ✅.
4. Adicionar entrada na `docs/README.md` (índice).

## Workflow de delegação

Owner vai delegar para subagente **coder**:

1. Subagente recebe este arquivo + contexto mínimo.
2. Subagente implementa e commita na branch `wt/admin-center` (já existe).
3. Subagente roda `bun run typecheck && bun run test:unit && bun run test:coverage` antes do push.
4. Subagente abre PR com esta spec linkada na descrição.
5. Owner valida com a spec (checklist de critérios de aceite) + E2E manual em prod.

---

## Revision history

| Date       | Version | Change                                                                        | Reason                                           |
| ---------- | ------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| 2026-08-04 | 0.1.0   | Initial draft                                                                 | First write                                      |
| 2026-08-04 | 0.2.0   | Reorganizado: 1 PR único + SDK `@omestre/feature-flags-sdk` (decisão central) | Owner pediu PR único funcional; decisão de YAGNI |
| 2026-08-04 | 0.2.1   | Owner pediu delegação para subagente coder                                    | Workflow aditivo (seção Workflow de delegação)   |
