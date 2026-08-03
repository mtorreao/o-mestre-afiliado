# Spec: Desacoplar resolução de grupo do caminho quente do webhook

## Contexto e objetivo

Teste de carga (ramp-up) contra o stack Docker completo mostrou que o endpoint
`POST /webhook/message` satura em ~800-1000 rps com p95 crescendo para >500ms
acima de conc 400, enquanto Redis isolado aguenta ~59k rps e Postgres ~64k rps.

Causa raiz (investigada): `handleMessagesUpsert` em
`apps/api/src/modules/webhook/webhook.routes.ts` executa, POR MENSAGEM, em
sequência (await após await):

1. `getSourceGroupInfo(remoteJid)` → Redis GET; em CACHE MISS faz
   `MirrorRepository.list()` (PostgreSQL, paginado 1000) — atinge o banco a
   cada mensagem de grupo NÃO-source.
2. `fetchGroupInfo(instanceName, remoteJid)` → HTTP à Evolution API (caminho
   quente acoplado a serviço externo).
3. `cacheGet(dedupKey)` → Redis.
4. `cacheSet(dedupKey)` → Redis.
5. `streamAdd(MIRROR_RAW_STREAM)` → Redis XADD.

Ou seja, até 5 I/Os seriais por mensagem (Redis + PostgreSQL + Evolution + Redis

- Redis), limitando o throughput a ~1000 rps apesar da capacidade isolada de
  cada subsistema ser >50k rps.

Objetivo: remover PostgreSQL e Evolution do caminho quente do webhook (Opções B
e C do plano de remediação), reduzindo para ~2-3 Redises seriais por mensagem,
sem mudar o contrato externo (webhook continua retornando 200).

## Decisões de arquitetura

- **B (Evolution fora do caminho quente):** o webhook NÃO chama `fetchGroupInfo`.
  Publica `RawMessageEvent` com `sourceGroupName` = nome do cache (ou vazio se
  não resolvido). O INGESTOR resolve o nome do grupo (quando vazio) de forma
  assíncrona em seu próprio loop, via Evolution + cache. Isso elimina o acoplamento
  síncrono com a Evolution no caminho quente e o torna resiliente a oscilações da
  Evolution.
- **C (cache negativo de sourceGroup):** quando `getSourceGroupConfigs` retorna
  vazio (grupo NÃO é source), grava `mirror:source-group:neg:{jid}` no Redis com
  TTL curto (300s). Próximas mensagens do mesmo grupo não-source caem no cache
  negativo (Redis hit) e NÃO batem PostgreSQL. A vasta maioria do tráfego em grupos
  não monitorados deixa de tocar o banco.

## Modelo de dados

Sem mudança de schema Drizzle. Apenas nova chave Redis:

- `mirror:source-group:neg:{jid}` → `"1"` (TTL 300s). Helper em `group-cache-pure.ts`.

## Contratos (sem quebra externa)

- `POST /webhook/message` continua retornando `{ success: true }` (200) para
  mensagens de grupo processadas. Comportamento de `published`/`ignored` inalterado.
- `RawMessageEvent.sourceGroupName` pode vir vazio (antes vinha do cache ou do
  fetchGroupInfo). O ingestor tolera vazio (já faz `sourceGroupName || '(desconhecido)'`).

## Pontos de integração

| Arquivo                                          | Mudança                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/services/group-cache-pure.ts`      | + `negativeCacheKey(jid)`, helper de TTL negativo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/api/src/services/group-cache.ts`           | `getSourceGroupConfigs`: consulta cache positivo → cache negativo (mesma chave Redis) → fallback PG; em retorno vazio, grava cache negativo (após PG bem-sucedido). Limpa cache negativo em `cacheSourceGroupConfigs`/`cacheSourceGroup`/`removeSourceGroup`/`removeSourceGroups`/`replaceSourceGroups`/`clearSourceGroupCache`/`warmSourceGroupCache` (substituído por buildSourceGroupConfig per-jid). `buildSourceGroupConfig` agora aceita `sourceGroupJid` opcional para preencher `groupName` específico (antes usava o primeiro grupo). Adiciona `getCachedSourceGroupName(jid)` (cache-only, sem fallback PG) para callers que precisam só do nome. |
| `apps/api/src/modules/webhook/webhook.routes.ts` | Remove import/`fetchGroupInfo`. Usa `info.groupName` (já no `SourceGroupConfig` retornado pelo cache) para `sourceGroupName`. Publica evento sem bloquear em Evolution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/worker-common/src/group-resolution.ts` | NOVO: `resolveGroupName(instanceName, jid, cachedName?)` — se `cachedName` vazio, `fetchGroupInfo` (Evolution via `buildEvolutionApiUrl`/`buildEvolutionHeaders` já existentes) + `cacheSourceGroup`.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/ingestor/src/ingestor.ts`                  | Em `processRawMessage`, se `sourceGroupName` vazio, chama `resolveGroupName` (import de `@omestre/worker-common`) e repassa o nome resolvido adiante.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Lógica pura isolada

- `negativeCacheKey(jid: string): string` em `group-cache-pure.ts` (testável).
- A decisão "precisa resolver?" (`!cachedName`) é trivial; o `resolveGroupName`
  tem I/O (Evolution + Redis) e é testado com fetch/redis mockados.

## Testes

- `group-cache-pure.test.ts`: `negativeCacheKey` formata chave correta.
- `group-cache.test.ts`: `getSourceGroupConfigs` grava negativo em miss e o
  respeita (mock de Redis + MirrorRepository via `mock.module`).
- `group-resolution.test.ts` (worker-common): `resolveGroupName` chama Evolution
  quando nome vazio e popula cache; não chama Evolution quando nome presente
  (mock de fetch + redis).
- `webhook.routes.test.ts` (existente): garantir que webhook não chama mais
  `fetchGroupInfo` (spy) e ainda publica com nome do cache.
- `ingestor.test.ts` (existente): `processRawMessage` resolve nome vazio via
  `resolveGroupName` (mock).

## Critérios de aceite

- [x] `bun run typecheck` 0 erros nos 11 subprojetos.
- [x] `bun run build` ok.
- [x] `bun run test:unit` verde para os módulos tocados (worker-common,
      apps/api/services, apps/api/modules/webhook, apps/ingestor/pure,
      apps/loadtest). Falhas remanescentes (`feature-flags.routes` e
      `link-converters-magalu`) são pré-existentes na main e não
      relacionadas a esta mudança.
- [ ] Ramp-up (`--ramp`) do webhook sobe o throughput de ~1000 para >3000 rps
      com p95<500ms em conc ≤ 400 (validado contra stack Docker).
- [ ] `POST /webhook/message` continua 200; 0% 5xx.

## Commits sugeridos

1. `refactor(webhook): remover fetchGroupInfo do caminho quente (opção B)`
2. `perf(group-cache): cache negativo de sourceGroup elimina PostgreSQL no hot path (opção C)`
3. `feat(worker-common): resolver nome de grupo no ingestor (desacoplamento)`

## Riscos e mitigações

- **Risco:** grupos source com nome não em cache ficam com `sourceGroupName` vazio
  até o ingestor resolver. Mitigação: o ingestor resolve em seu loop assíncrono;
  o nome é usado só para log/legibilidade (não para roteamento).
- **Risco:** cache negativo muito longo esconde um grupo recém-tornado source.
  Mitigação: TTL 300s; warm-up no startup da API já popula o cache positivo.
