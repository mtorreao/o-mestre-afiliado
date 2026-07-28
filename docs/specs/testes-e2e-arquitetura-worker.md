# Plano de Testes E2E — Nova Arquitetura do Worker (Ingestor + Dispatcher)

> Complementa [`docs/specs/arquitetura-worker.md`](../specs/arquitetura-worker.md). Cobre a suíte E2E
> (Playwright) para a arquitetura de 2 filas / 2 processadores que
> substituiu o `apps/worker` monolítico por `apps/ingestor`,
> `apps/dispatcher` e `packages/worker-common`.

---

## 1. Contexto: o que mudou na refatoração

| Antes (`apps/worker`)                       | Agora                                                         |
| ------------------------------------------- | ------------------------------------------------------------- |
| Worker monolítico (Redis Stream único)      | 2 filas: `omestre:mirror:raw` (A) → `omestre:mirror:send` (B) |
| Pipeline + envio no mesmo processo          | `apps/ingestor` (pipeline pesado) + `apps/dispatcher` (envio) |
| 1 sourceGroup → 1 afiliado                  | 1 sourceGroup → N afiliados (fan-out, cache Redis 1:N)        |
| Sem imagem                                  | Busca imagem de capa (opcional, com **fallback para texto**)  |
| `sendToGroup` (sendText)                    | `sendMediaOrText` — `sendMedia` com imagem, `sendText` sem    |
| Webhook publicava com affiliateId resolvido | Webhook publica `RawMessageEvent` CRU + dedup global 30s      |
| DLQ/metrics/notifier em `apps/worker`       | Extraídos para `packages/worker-common`                       |

### Contratos-chave (fonte da verdade para os testes)

- **Streams / consumer groups** (`packages/shared/src/index.ts`):
  `MIRROR_RAW_STREAM='omestre:mirror:raw'`, `MIRROR_SEND_STREAM='omestre:mirror:send'`,
  `mirror-raw`, `mirror-send`.
- **Chaves de dedup Redis**:
  - `mirror:webhook-dedup:{sourceJid}:{msgId}` — TTL 30s (API/webhook)
  - `mirror:send-dedup:{mirrorId}:{msgId}` — TTL 1h (Ingestor, crash-recovery)
  - `mirror:send-completed:{mirrorId}:{msgId}` — TTL 24h (Dispatcher, reentrega)
- **Tipos** (`packages/shared/src/mirror-message.ts`):
  `RawMessageEvent`, `SendEvent`, `SourceGroupConfig`, `MirrorSendConfig`, `MirrorDLQEntry`.
- **Imagem NÃO é mais bloqueante** (`apps/ingestor/src/ingestor.ts:1196-1245`):
  se `fetchProductImage` falha, envia como texto (`imageUrl=''`). Isto **muda**
  o motivo do skip histórico (ver §5).

---

## 2. Estado atual da suíte E2E

### Infra (`e2e/docker-compose.e2e.yml`)

Já migrada para a nova arquitetura. Dois "planos":

1. **Plano padrão** (porta API 15442): `postgres-e2e`, `redis-e2e`,
   `evolution-api-e2e` (real), `api-e2e`, `web-e2e`, `ingestor-e2e`, `dispatcher-e2e`.
2. **Plano mirror** (porta API 15447): `whatsapp-simulator-e2e` (15446),
   `api-e2e-mirror`, `ingestor-e2e-mirror`, `dispatcher-e2e-mirror` —
   API/ingestor/dispatcher apontam para o **simulador** em vez da Evolution real.

Projects Playwright (`e2e/playwright.config.ts`): `api` (15442), `ui` (web 15441),
`mirror-api` (15447).

### Specs existentes

| Arquivo                          | Project         | Foco                                        | Estado |
| -------------------------------- | --------------- | ------------------------------------------- | ------ |
| `auth.api.spec.ts`               | api             | Registro/login/JWT                          | OK     |
| `auth.ui.spec.ts`                | ui              | Login UI + Settings                         | 2 skip |
| `mirrors.api.spec.ts`            | api             | CRUD `/api/mirrors`                         | OK     |
| `mirrors.ui.spec.ts`             | ui              | MirrorsPage (lista/toggle/delete/busca)     | OK     |
| `webhook-and-groups.api.spec.ts` | api             | `/webhook/message` + `/api/whatsapp/groups` | OK     |
| `whatsapp.api.spec.ts`           | api             | connect/status/disconnect                   | OK     |
| `whatsapp.ui.spec.ts`            | ui              | UI de conexão WhatsApp                      | OK     |
| `amazon.api.spec.ts`             | api             | CRUD afiliado Amazon + conversão            | OK     |
| `mirror-flow.api.spec.ts`        | api, mirror-api | Pipeline webhook→ingestor→dispatcher→sim    | 1 skip |

### Lacunas identificadas (o que NÃO tem cobertura hoje)

1. **Pipeline end-to-end real** — o único teste que exercitava
   webhook→ingestor→dispatcher→simulador está **skipped** (Shopee sem
   credenciais). Nenhum teste verde prova que uma oferta chega ao destino.
2. **`/message/sendMedia`** — o dispatcher usa `sendMedia` quando há imagem,
   mas o **simulador só implementa `sendText`** (`apps/whatsapp-simulator/src/index.ts:264`).
   Uma oferta com imagem cairia em 404 no simulador → nunca registrada.
3. **`GET /api/worker/status`** — agregador Ingestor+Dispatcher + XLEN das
   filas. Sem cobertura.
4. **`GET/POST /api/worker/dlq*`** — listar/requeue/remove/purge DLQ. Sem cobertura.
5. **Dedup de webhook (30s)** — duas instâncias no mesmo grupo devem gerar
   **1** RawMessageEvent. Sem cobertura.
6. **Fan-out 1:N** — 1 sourceGroup com N mirrors deve gerar N envios. Sem cobertura.
7. **Fallback imagem→texto** — oferta sem imagem deve ser enviada como texto,
   não bloqueada (regressão do v1). Sem cobertura.
8. **Mirror inativo** — SendEvent para mirror `inactive` deve ser descartado
   pelo dispatcher. Sem cobertura.

---

## 3. Estratégia

- **Marketplace de referência para o pipeline: Amazon.** O conversor Amazon é
  puro parâmetro de URL (`?tag=`), sem API externa, sem cookies de sessão nem
  GraphQL. Uma URL `amazon.com.br/dp/{ASIN}` não precisa de resolução de
  redirect. Basta semear um afiliado Amazon + tracking ID via API pública
  (`PUT /api/amazon/affiliate` + `POST .../tracking-ids`) e uma linha em
  `omestre.affiliates` ligada à instância (`user-{id}`). Isso desbloqueia o
  fluxo completo **sem credenciais secretas** — resolvendo a raiz do skip.
- **Camada de verificação: simulador WhatsApp.** `GET /__admin/messages`
  expõe o que foi "enviado". Precisamos que o simulador registre **tanto**
  `sendText` **quanto** `sendMedia` (fix na infra — §4).
- **Isolamento:** cada teste cria usuário único (`uniqueEmail`), reseta o
  simulador (`POST /__admin/reset`) no `beforeEach`, e usa `messageId` únicos
  para evitar colisão de dedup entre execuções.
- **Assíncrono:** o pipeline atravessa 2 filas Redis. Usar polling
  (`waitForMessageInSimulator`, timeout 20s) em vez de sleep fixo.
- **Sem segredos:** nenhum teste depende de `SHOPEE_APP_ID`/`ML_*` reais.
  Shopee/ML permanecem cobertos apenas no nível de conversão isolada
  (unit) e de "descarta silenciosamente sem credenciais" (negativo).

---

## 4. Correção de infra necessária (pré-requisito)

`apps/whatsapp-simulator/src/index.ts` deve implementar
`POST /message/sendMedia/:instanceName`, registrando em `sentMessages` no
mesmo formato de `sendText` (com `number`, `caption`→`text`, e um marcador
`hasMedia:true` / `mediaUrl`). Sem isso, qualquer teste de pipeline com
imagem falha silenciosamente com 404.

---

## 5. Casos de teste — plano

### 5.1 Pipeline end-to-end (novo: `mirror-pipeline.api.spec.ts`, project `mirror-api`)

Seed comum (helper): usuário → connect WhatsApp (simulador) → afiliado Amazon
com tracking ID ativo → linha `omestre.affiliates(evolution_instance_id='user-{id}')`
→ mirror ativo (source=grupo1, target=grupo3).

| #   | Caso                                                                | Espera                                                                   |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| P1  | Oferta Amazon `/dp/ASIN` em grupo fonte → destino                   | Mensagem no simulador, `number=grupo3`, texto contém `?tag=` do afiliado |
| P2  | Fallback imagem→texto: Amazon sem imagem disponível                 | Mensagem enviada (sendText), **não** bloqueada                           |
| P3  | Fan-out 1:N: 2 mirrors (2 users) no mesmo sourceGroup               | 2 mensagens, uma por targetGroup/instância                               |
| P4  | Dedup webhook: 2 webhooks (instâncias diferentes) mesmo `messageId` | Apenas 1 envio ao destino                                                |
| P5  | Dedup send-completed: reenvio do mesmo `messageId` após 1º envio    | Continua 1 envio (não duplica no destino)                                |
| P6  | Mirror inativo: webhook chega com mirror `status=inactive`          | Nenhum envio (descartado no dispatcher)                                  |
| P7  | Sem link de marketplace                                             | Nenhum envio (já existe — manter)                                        |
| P8  | Grupo não configurado como source                                   | Nenhum envio (já existe — manter)                                        |
| P9  | `fromMe=true`                                                       | Nenhum envio (já existe — manter)                                        |

> Reativa o teste hoje skipado, trocando Shopee→Amazon (P1). Remover a
> entrada `e2e-mirror-flow-shopee-end-to-end` de `docs/known-issues.md`.

### 5.2 Worker status + DLQ (novo: `worker-status.api.spec.ts`, project `api`)

| #   | Caso                                            | Espera                                                                                            |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| W1  | `GET /api/worker/status`                        | `success:true`, `services` com `ingestor`+`dispatcher`, `pipeline.queueA/queueB` (número ou null) |
| W2  | `GET /api/worker/dlq` vazia                     | `success:true`, `total:0`, `items:[]`                                                             |
| W3  | `GET /api/worker/dlq` filtros (`queue`,`since`) | Aceita params sem erro, retorna `totalFiltered`                                                   |
| W4  | `POST /api/worker/dlq/requeue` sem `id`         | 400, `success:false`                                                                              |
| W5  | `POST /api/worker/dlq/requeue` id inexistente   | 404, `success:false`                                                                              |
| W6  | `POST /api/worker/dlq/remove` id inexistente    | 404                                                                                               |
| W7  | `POST /api/worker/dlq/purge`                    | `success:true`, `removed:number`                                                                  |

> W1 roda no plano padrão (ingestor-e2e/dispatcher-e2e expõem `/status` em
> 9092/9093 na rede interna; a API faz proxy). Se os serviços de métrica não
> forem alcançáveis a partir da API no ambiente E2E, o teste ainda deve passar
> com `reachable:false` — asserção tolerante (valida shape, não conectividade).

### 5.3 Webhook → Queue A (ampliar `webhook-and-groups.api.spec.ts`)

| #   | Caso                                               | Espera                                             |
| --- | -------------------------------------------------- | -------------------------------------------------- |
| H1  | `messages.upsert` de grupo não-source              | 200, nada publicado (não observável, mas sem erro) |
| H2  | `messages.upsert` com `remoteJid` não-`@g.us` (DM) | 200, ignorado                                      |
| H3  | Texto > 5000 chars                                 | 200, ignorado                                      |
| H4  | Formato objeto único (`{key,message}`) vs array    | 200 em ambos                                       |

> Manter os testes de aceitação de eventos já existentes.

### 5.4 CRUD mirrors + cache (manter/ampliar `mirrors.api.spec.ts`)

Já cobre CRUD. Adicionar (opcional):

- M+1: criar mirror com `subRateLimitMaxMsgs`/`subRateLimitWindowSec` persiste.

### 5.5 UI (manter)

`mirrors.ui.spec.ts`, `whatsapp.ui.spec.ts` já cobrem os fluxos de UI atuais.
`auth.ui.spec.ts` mantém 2 skips (Radix Tabs — problema de seletor, não da
arquitetura worker; fora de escopo deste plano).

---

## 6. Ordem de execução

1. **Infra:** implementar `sendMedia` no simulador (§4).
2. **Pipeline:** criar `mirror-pipeline.api.spec.ts` com helper de seed Amazon
   (P1–P9). Reativar/migrar o teste skipado.
3. **Worker/DLQ:** criar `worker-status.api.spec.ts` (W1–W7).
4. **Webhook:** ampliar `webhook-and-groups.api.spec.ts` (H1–H4).
5. Rodar `bun run test:e2e`, iterar até verde.
6. Atualizar `docs/known-issues.md` (remover entrada Shopee reativada).

---

## 7. Riscos e mitigações

| Risco                                                   | Mitigação                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ingestor não acha affiliate → `sendEventsCount:0`       | Seed via SQL `omestre.affiliates(evolution_instance_id='user-{id}')` + cache warm no create do mirror |
| `fetchProductImage` chama rede externa (lento/flaky)    | Fallback para texto já existe; asserção não exige imagem                                              |
| Colisão de dedup entre execuções                        | `messageId` com `Date.now()` + reset simulador por teste                                              |
| Latência das 2 filas Redis                              | Polling com timeout 20s, não sleep fixo                                                               |
| `/status` do worker inacessível a partir da API em E2E  | W1 valida shape tolerante (`reachable` pode ser false)                                                |
| Amazon converter exige `tag` do afiliado, não do `.env` | Seed tracking ID via `POST /api/amazon/affiliate/tracking-ids`                                        |

---

## 8. Infra E2E — correções aplicadas (não óbvias)

Durante a implementação deste plano, duas armadilhas de infra impediam a
execução limpa dos testes de pipeline. Registradas aqui para não serem
redescobertas:

### 8.1 Simulador precisa de `/message/sendMedia`

O Dispatcher envia com imagem via `POST /message/sendMedia/{instance}` quando
`imageUrl` está presente (caso normal do pipeline). O simulador E2E só tinha
`/message/sendText`. **Correção:** adicionado `sendMedia` em
`apps/whatsapp-simulator/src/index.ts` (registra `mediaUrl` + `hasMedia`). Sem
isso, o Dispatcher recebe 404 e o envio falha silenciosamente.

### 8.2 Isolamento Redis entre os planos "padrão" e "mirror"

O `docker-compose.e2e.yml` sobe **dois** pares ingestor/dispatcher que
compartilham o **mesmo Redis (DB 0)** e os mesmos consumer groups
(`mirror-raw` / `mirror-send`): o plano padrão (→ Evolution real) e o plano
"mirror" (→ simulador). Os dois Dispatchers **competem** pelos SendEvents da
Queue B — o plano padrão (sem credenciais) roubava eventos destinados ao
simulador, fazendo os testes de pipeline falharem de forma intermitente.

**Correção:** o plano "mirror" (`api-e2e-mirror`, `ingestor-e2e-mirror`,
`dispatcher-e2e-mirror`) aponta para `redis://redis-e2e:6379/3` (DB 3). O
`ioredis` honra o sufixo `/3` na URL. O plano padrão continua no DB 0.

Efeito colateral: qualquer operação Redis via `docker exec` no teste (ex:
`redisDel` no P3 para forçar rebuild 1:N do cache) deve usar `redis-cli -n 3`.

### 8.3 Isolamento de JID por teste

O cache 1:N de sourceGroup é populado no `CREATE` do mirror e **sobrescrito**
com UMA config por vez (`replaceSourceGroups`). Se dois testes compartilham o
mesmo `sourceGroup` JID, o fallback de DB da API retorna a _união_ de todos os
mirrors daquele JID — tornando o fan-out (P3) não-determinístico.

**Correção:** cada teste em `mirror-pipeline.api.spec.ts` gera seu próprio
`sourceGroup` JID único (`genSourceJid`). O JID é arbitrário: o webhook só casa
com cache/DB, e o dispatcher→simulador não valida se o grupo existe.

---

## 9. Status de execução

- `e2e/mirror-pipeline.api.spec.ts` — 9 testes (P1–P9), **verde**.
- `e2e/worker-status.api.spec.ts` — 8 testes (W1–W7 + requeue/remove/purge), **verde**.
- `bun run test:e2e` completo: 131 passou; as falhas restantes (12) são 11 testes
  de UI **pré-existentes e fora do escopo** da refatoração do worker (auth.ui,
  mirrors.ui busca, whatsapp.ui card) + o P3 antes do isolamento de JID.
