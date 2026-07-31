# Plano: Persistência de Ofertas + Histórico de Preços (background)

> **Objetivo:** capturar cada oferta encontrada (produto + variação) uma única vez, sem duplicação, e acumular um histórico de preços por variação ao longo do tempo — para, no futuro, expor um comparativo de preço como diferencial nas ofertas espelhadas.
>
> **Escopo desta fase:** a fundação (captura + deduplicação + histórico) rodando "de fundo" no pipeline + **UI somente para o admin do sistema** (oculta para o usuário comum). A UI é de **visualização/consulta** do catálogo e do histórico — não expõe nenhum comparativo nas mensagens de espelhamento ainda.

---

> **Decisão de arquitetura:** catálogo roda em **worker isolado** (`apps/catalog-worker`) consumindo **Queue C `omestre:mirror:catalog`**. O Ingestor **só publica a identidade** do produto (`XADD` O(1), fire-and-forget, fora do hot path). O CatalogWorker é **dono de buscar o dado fresco** (preço/variação/imagem) na fonte e gravar. Isso garante zero impacto no fluxo de espelhamento (Ingestor→Queue B→Dispatcher).
>
> **Decisões do backfill (rev 0.3.0):** `publishCatalogJob`/`resolveCatalogTarget` vivem em `@omestre/worker-common`/`@omestre/shared` (compartilhados entre Ingestor e backfill — sem duplicação); `parseAffiliateUserId` centralizado em `@omestre/shared`; backfill usa `messageId = backfill:<rowId>` (rastreabilidade de volta ao `reflected_offers`) e `capturedAt = reflected_at` (bucket histórico real); userId vem de `affiliates.evolution_instance_id` (`user-<id>`); comando **explícito** (`bun run backfill`), nunca automático.

---

## 1. Estado atual (o que já temos e o que falta)

| O que existe                 | Onde                                       | Observação                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reflected_offers`           | `packages/db/src/schema/index.ts:85`       | Log de **envio** (link, grupos, status). Sem noção de produto/variação/preço. Não serve como histórico.                                                                                                                                                                                                                                |
| `getProductOffer()` (Shopee) | `packages/converters/src/shopee.ts:204`    | Retorna `itemId, shopId, productName, imageUrl, price, priceMin, priceMax, commissionRate`. **Já é chamado em `product-image.ts:325` mas só a `imageUrl` é aproveitada — `productName` e `price` são descartados.** (No modelo atual, esse offer _não_ é reaproveitado pelo catálogo — o CatalogWorker busca o dado de novo, isolado.) |
| `product-image.ts`           | `apps/ingestor/src/product-image.ts`       | Busca imagem OBRIGATÓRIA; continua sendo o único responsável por isso no Ingestor. Catálogo de preço é 100% responsabilidade do worker.                                                                                                                                                                                                |
| `SendEvent` (Queue B)        | `packages/shared/src/mirror-message.ts:31` | Não carrega `title`/`price`/`variationId` (e não precisa — o worker resolve). Carrega só `productKey`/`variationKey` de correlação.                                                                                                                                                                                                    |
| `logReflectedOffer()`        | `apps/ingestor/src/ingestor.ts:785`        | Insere em `reflected_offers` e **publica o `CatalogJob`** na Queue C (não grava catálogo).                                                                                                                                                                                                                                             |
| `isDuplicate()`              | `apps/ingestor/src/ingestor.ts:216`        | Dedup por `(affiliateId, originalLink, 24h)` — faz o papel de **anti-spam de envio**, não de histórico.                                                                                                                                                                                                                                |

**Conclusão:** o dado de produto (nome, preço) já atravessa o pipeline e é descartado. O ganho é enorme: reaproveitar `getProductOffer()` para normalizar o produto e, com a API pública do ML, cobrir variações.

---

## 2. Modelo de dados (Drizzle, schema `omestre`)

Duas tabelas novas. Separação Product (1) × Variation (N) × PricePoint (N) evita duplicar o produto a cada mensagem e dá o histórico real por variação.

### 2.1 `products` — chave de normalização (sem duplicação)

```sql
CREATE TABLE omestre.products (
  id               serial PRIMARY KEY,
  marketplace       marketplaceEnum NOT NULL,
  marketplace_item_id text NOT NULL,          -- Shopee itemId | ML itemId | Amazon ASIN | slug normalizado p/ "other"
  product_key       text NOT NULL UNIQUE,       -- `${marketplace}:${marketplace_item_id}` (dedup real)
  title            text,
  image_url        text,
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now(),
  last_seen_at    timestamp NOT NULL DEFAULT now()
);
-- índice parcial p/ upsert rápido
CREATE UNIQUE INDEX IF NOT EXISTS products_key_idx ON omestre.products (product_key);
```

### 2.2 `product_variations` — variação (1:N com product)

```sql
CREATE TABLE omestre.product_variations (
  id               serial PRIMARY KEY,
  product_id       integer NOT NULL REFERENCES omestre.products(id) ON DELETE CASCADE,
  variation_key    text NOT NULL,             -- `${product_key}:${vId}` (vId do MP ou hash do nome)
  variation_id     text,                      -- id da variação no MP (ML: variation_id; Shopee: -; Amazon: -)
  variation_name   text,                     -- "Azul / M" ou "Conjunto 3un" (label legível)
  attributes_json  jsonb DEFAULT '{}',       -- atributos crus (cor, tamanho, voltagem...)
  created_at       timestamp NOT NULL DEFAULT now(),
  last_seen_at    timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_variations_key_idx
  ON omestre.product_variations (variation_key);
```

### 2.3 `price_history` — o histórico (append-only, N por variação)

> **Melhoria 1 (estoque + preço de lista):** além do `price` de venda, grava `list_price` (preço de tachado/original — ML `original_price`), `available` (bool) e `stock` (int, onde a API der). O `list_price` habilita % de desconto no gráfico e o futuro comparativo ("menor preço **disponível**"). `stock`/`available` marcam "esgotado" no histórico.
>
> **Melhoria 2 (dedup à prova de corrida):** o gate "leu último preço → decide → insere" tem TOCTOU no fan-out 1:N (N afiliados gravam o MESMO produto quase juntos). Substituímos por `UNIQUE (variation_id, price_bucket, price, list_price, available)` + `ON CONFLICT DO NOTHING` — concorrência e janela de gap resolvidas de graça, sem transação, sem race. `price_bucket` = truncagem de `captured_at` em **1 hora** (Melhoria 4: heartbeat diário opcional via bucket maior se quiser).

```sql
CREATE TABLE omestre.price_history (
  id               serial PRIMARY KEY,
  variation_id     integer NOT NULL REFERENCES omestre.product_variations(id) ON DELETE CASCADE,
  price            numeric(12,2) NOT NULL,
  list_price       numeric(12,2),             -- preço de tachado/original (ML: original_price); null se indisponível
  currency         text NOT NULL DEFAULT 'BRL',
  available        boolean NOT NULL DEFAULT true, -- false = esgotado
  stock            integer,                     -- qtd disponível (ML sim; Shopee/others null)
  price_bucket     timestamp NOT NULL,           -- date_trunc('hour', captured_at) — deduplicação
  captured_at      timestamp NOT NULL DEFAULT now(),
  source           text NOT NULL DEFAULT 'background',   -- 'background' | 'manual' | 'api' | 'backfill'
  source_group_jid text,                                -- grupo de onde veio (contexto)
  message_id       text                                 -- msgId original (rastreabilidade)
);
-- Dedup de corrida + janela de 1h (Melhoria 2): conflitos não inserem
-- NULLS NOT DISTINCT (PG15+): sem ele, list_price NULL (Shopee/Amazon) nunca
-- conflita num índice UNIQUE — o dedup de 1h não funcionaria para esses casos.
CREATE UNIQUE INDEX IF NOT EXISTS price_history_dedup_idx
  ON omestre.price_history (variation_id, price_bucket, price, list_price, available)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS price_history_variation_idx
  ON omestre.price_history (variation_id, captured_at);
```

**Por que separado de `reflected_offers`:** `reflected_offers` é log de _ação de envio_ (pode falhar, ser bloqueado, rate-limited). O histórico de preço deve refletir _toda oferta vista_, independente de ter sido espelhada. São conceitos diferentes; juntar os dois poluiria o histórico com falhas de envio.

---

## 3. Lógica de captura — Ingestor SÓ PUBLICA, CatalogWorker GRAVA

> **Decisão (Matheus):** catálogo roda em **worker isolado** (`apps/catalog-worker`), consumindo uma **Queue C** dedicada. O ingestor **não grava nada** no banco de catálogo e **não faz I/O de preço** no hot path — ele apenas resolve o `product_key` + `marketplace` (e reaproveita o `ShopeeProductOffer` já buscado em `product-image.ts`) e faz **`XADD` O(1) na Queue C**. Zero latência/risco de rate-limit no espelhamento.

### 3.1 No Ingestor — publica o job (só identidade, não grava)

Novo módulo `apps/ingestor/src/catalog-publisher.ts` com `publishCatalogJob(params)`:

- **Resolver `marketplace_item_id`** (apenas parse, sem rede) por marketplace:
  - Shopee: `extractShopeeItemIdFromUrl()` (já existe em `shopee.ts`).
  - ML: regex `(MLB|MLM|MLA|MCO|MLC)\d{8,}` na URL resolvida.
  - Amazon: ASIN de `/dp/ASIN`.
  - outro: `null` → **não publica** (não dá pra normalizar; fica só no `reflected_offers`).
- **`product_key`** = `${marketplace}:${itemId}`.
- **Montar `CatalogJob`** (tipo em `packages/shared/src/mirror-message.ts`) — **só identidade + contexto**, sem nenhum dado de preço/variação:
  ```ts
  export interface CatalogJob {
    id: string; // UUID
    productKey: string; // marketplace:itemId
    marketplace: string;
    itemId: string;
    resolvedUrl: string; // URL já resolvida (redirect tratado) — o worker usa pra buscar dado fresco
    sourceGroupJid: string;
    messageId: string;
    capturedAt: string; // ISO
  }
  ```
  > O job **não carrega** preço/variação/imagem de produto. O Ingestor só declara "este produto apareceu"; **buscar o dado atualizado é responsabilidade exclusiva do CatalogWorker** (seção 3.2). Isso mantém o contrato mínimo e desacopla o Ingestor de toda I/O de catálogo.
- **`XADD omestre:mirror:catalog`** (Queue C) com `maxlen` ~50k (cap de memória). Chamada **`void`/fire-and-forget** no fim do `processMessage()` do Ingestor — **após** o bloco que publica os `SendEvent` na Queue B (passo 10, ~`ingestor.ts:1198`) e **antes** do ACK na Queue A (passo 11) —, em `try/catch` próprio que apenas `log('warn')`. Se a publicação falhar, o espelhamento **nunca** para. (O Ingestor já tem em escopo neste ponto: `resolvedUrl`, `marketplace`, `sourceGroupJid`, `messageId` e `sourceConfigs[0].instanceName` → `userId`.)
- **Sem acoplamento de fetch:** `fetchProductImage()` (`product-image.ts`) continua buscando só a **imagem** (obrigatória pro envio da oferta) e descartando o resto — **não** precisa retornar `offer` nem sofrer refactor. O catálogo de preço é 100% responsabilidade do worker.

### 3.2 No CatalogWorker — ele busca o dado FRESCO e grava

Novo `apps/catalog-worker/src/catalog-worker.ts` (mesmo padrão do v2: Redis Stream + consumer group + ACK + DLQ). **Para cada `CatalogJob` o worker é DONO da busca do dado atualizado** — recebe só a identidade, vai à fonte e grava:

1. **Buscar dado do produto** (isolado, com retry próprio):
   - **ML**: `GET https://api.mercadolibre.com/items/{id}` (público, sem auth) → `title`, `pictures[0].url`, `variations[]` (`id`, `price`, `original_price`, `available_quantity`, `attribute_combinations`).
   - **Shopee**: `getProductOffer(resolvedUrl, creds)` (GraphQL) → `productName`, `imageUrl`, `price`. _creds_: o worker precisa resolver o `userId` a partir do `sourceGroupJid` (cache de sourceGroup → `affiliateId` → `userId`) OU receber `userId` no job. **Decisão**: incluir `userId` no `CatalogJob` (preencido pelo ingestor a partir do `SourceGroupConfig` que ele já tem no fan-out) — assim o worker não refaz a resolução.
   - **Amazon/outros**: `title` do `TemplateContext`/`text` (se vier no job), `price = null` (deixa pra fase futura).
   - **Sem dado útil** (fetch falhou, sem creds Shopee, marketplace não suportado): descarta o job com ACK (`kind: 'none'` + reason) — a DLQ é para falhas REAIS (infra/DB), não para produto sem oferta ativa.
2. **Upsert `products`**: `INSERT ... ON CONFLICT (product_key) DO UPDATE SET last_seen_at=now(), title=EXCLUDED.title, image_url=EXCLUDED.image_url`. Retorna `productId`.
3. **Resolver variações** (do dado fresco buscado no passo 1):
   - ML: `variation_key = ${product_key}:${v.id}`, `variation_name` de `attribute_combinations[].value_name`, `list_price = v.original_price`, `stock = v.available_quantity`, `available = v.available_quantity > 0`.
   - Shopee/Amazon/outros: variação **única implícita** (`variation_key = ${product_key}:default`, `variation_name = title`, `price = shopeeOffer?.price`).
   - **Decisão**: variação do ML sem `price` é **pulada** (filtrada), não vira erro — uma variação ruim não pode mandar o job inteiro pra DLQ. Se sobrarem 0 variações úteis, o job é descartado com ACK.
4. **Upsert `product_variations`** (`ON CONFLICT (variation_key) DO UPDATE SET last_seen_at=now()`).
5. **Append de preço** (sempre INSERT, dedup via índice único):
   ```ts
   await db.insert(priceHistory).values({
     variationId,
     price,
     listPrice,
     currency: 'BRL',
     available,
     stock,
     priceBucket: dateTruncHour(capturedAt),
     source: 'background',
     sourceGroupJid,
     messageId,
   });
   // ON CONFLICT (variation_id, price_bucket, price, list_price, available) DO NOTHING
   ```
6. **ACK** na Queue C; falha → DLQ (`packages/worker-common`, padrão v2).

**Por que separado de `reflected_offers`:** `reflected_offers` é log de _ação de envio_ (pode falhar, ser bloqueado, rate-limited). O histórico de preço reflete _toda oferta vista_, independente de ter sido espelhada. Juntar os dois poluiria o histórico com falhas de envio.

## 4. Enriquecimento do `SendEvent` (opcional, barato)

Para o comparativo futuro chegar pronto ao dispatcher/UI sem recolher dado de novo, o `SendEvent` (`mirror-message.ts:31`) **não** precisa propagar preço (o catálogo saiu do hot path — ler o banco aqui seria retrocesso). Mantemos só a **chave de correlação**, barata e O(1):

```ts
productKey?: string;       // marketplace:itemId — p/ correlacionar oferta espelhada ↔ catálogo
variationKey?: string;    // p/ variação específica (futuro)
```

O ingestor preenche `productKey` (já resolvido em 3.1) no `SendEvent` do fan-out; `variationKey` fica `undefined` nesta fase (Shopee/ML resolvidos só no CatalogWorker). **Nesta fase esses campos são apenas propagados/ignorados** — nenhuma UI nem template os usa ainda. O comparativo real vai ler o `price_history` na hora de montar a oferta (fase futura), não no envio.

---

## 5. Plano de execução (commits ordenados)

1. **`db-schema`** — migration `0016_add_product_catalog.sql` (tabelas `products`, `product_variations`, `price_history` + índices, inclusive o `UNIQUE price_history_dedup_idx` da Melhoria 2); + coluna `is_admin` em `users` (`0017_add_users_is_admin.sql`). Exportar tabelas em `schema/index.ts`/`db.ts`. `bun run db:migrate` (ou psql no container dev).
2. **`catalog-publisher`** (no ingestor) — `apps/ingestor/src/catalog-publisher.ts` com `publishCatalogJob()` (resolve `product_key`/`marketplace` por parse, monta `CatalogJob` com `userId` do `SourceGroupConfig`); estender `SendEvent` com `productKey`/`variationKey` (seção 4); chamar `publishCatalogJob` em `logReflectedOffer` via `void`+try/catch. **NÃO** refatora `fetchProductImage` (worker busca o dado de preço sozinho).
3. **`catalog-worker`** (NOVO app, isolado) — `apps/catalog-worker/` consumindo **Queue C `omestre:mirror:catalog`** (Redis Stream + consumer group + ACK + DLQ, padrão v2 de `packages/worker-common`). Grava via `catalog.repository.ts` (upsert `products`/`product_variations` + append `price_history` com `ON CONFLICT DO NOTHING` no índice único). Busca ML `GET items/{id}` aqui (isolado).
4. **`catalog-api`** — `apps/api/src/modules/catalog/catalog.routes.ts` (rotas read-only, gate `isAdmin`) + `catalog.repository.ts`; `ADMIN_EMAILS` (env) + `isAdmin` no JWT/`/me`/`useAuth`.
5. **`catalog-ui`** — `AppShell` filtra nav por `isAdmin`; rota `historico-precos` → `ProductHistoryPage` (tabela + drawer com gráfico de linha).
6. **`backfill`** (Melhoria 5) — ✅ **entregue** (t_4b9d46cd): `apps/catalog-worker/src/backfill.ts` + `backfill-pure.ts` (CLI `bun run backfill`, flags `--limit N` / `--dry-run`; varre `reflected_offers` por keyset pagination e publica `CatalogJob` via `publishCatalogJob` do worker-common; `messageId = backfill:<rowId>`, `capturedAt = reflected_at` — preserva o bucket histórico; userId resolvido de `affiliates.evolution_instance_id`).
7. **`infra`** — ✅ **entregue** (t_4b9d46cd): `catalog-worker` registrado no `docker-compose.yml` e `docker-compose.dev.yml` (metrics `:9094`; host `5456` no dev, `base+8` via dev.ts), no `scripts/dev.ts` (services/ports/env/banner), no `deploy-local.sh` (gate de build) e no `bun run build` da raiz (`build:catalog-worker`). Reusa `worker-common` (metrics, DLQ, step-tracker, `catalog-publisher`).
8. **`verify`** — subir stack dev, enviar (ou simular) 2 msgs com o mesmo link Shopee+ML; checar: `products` tem 1 linha; `price_history` tem pontos distintos; re-envio na mesma hora **não** duplica (índice único); CatalogWorker isolado não afeta ingestor/dispatcher (latência/DLQ próprios).

### 5.5. Admin + UI de consulta (oculta para usuário comum)

Hoje **não há papel/role** — `users` (`packages/db/src/schema/users.ts`) só tem `email/name/passwordHash` e o `AuthUser` do JWT é `{userId, userEmail}` (`middleware/auth.ts:18`). Precisamos criar o conceito de **admin do sistema** antes de expor a UI.

#### 5.5.1. Campo `is_admin` (1 flag global, sem RBAC)

- Migration `0017_add_users_is_admin.sql`: `ALTER TABLE omestre.users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;`
- `packages/db/src/schema/users.ts`: adicionar `isAdmin: boolean('is_admin').notNull().default(false)`.
- **Seed/setup**: como não há tela de "promover a admin", o primeiro admin é definido por env no startup OU por UPDATE manual no banco. Decisão simples (escolha do Matheus): `ADMIN_EMAILS` (env, CSV) — na criação/login, `UserRepository` marca `is_admin=true` se o email estiver na lista. Sem UI de gestão de admins nesta fase.
- **JWT**: incluir `isAdmin` no payload do `jwt.sign` (`auth.routes.ts:39,78`) e no `AuthUser` (`middleware/auth.ts`). `/api/auth/me` (`auth.routes.ts:104`) já usa `findPublicById` — garantir que o `user` retornado inclua `isAdmin`.

#### 5.5.2. Rotas de leitura do catálogo (só admin)

Novo módulo `apps/api/src/modules/catalog/catalog.routes.ts` (montado em `index.ts` como `catalogRoutes`), **todas protegidas + gate `isAdmin`**:

- `GET /api/catalog/products?marketplace=&search=&page=&pageSize=` → lista `products` (join `product_variations` + último `price_history`) com paginação.
- `GET /api/catalog/products/:id` → detalhe do produto + todas as variações + **série temporal de `price_history`** (para o gráfico).
- `GET /api/catalog/variations/:id/history?from=&to=` → pontos de preço de uma variação (filtro de período).
- **Repositório** `packages/db/src/repository/catalog.repository.ts`: `listProducts()`, `getProductWithVariations()`, `getVariationHistory()`. Leitura-only, sem escrita (o histórico é populado só pelo CatalogWorker).

#### 5.5.3. Frontend — rota e página admin

- **`useAuth`** (`apps/web/src/hooks/useAuth.ts`): `User` ganha `isAdmin?`; propagar do `/api/auth/me` (já vem). Expor `isAdmin` no retorno do hook.
- **`AppShell.tsx`** (`apps/web/src/components/layout/AppShell.tsx`): `navItems` (linha ~56) recebe item **`historico-precos`** ("Histórico de Preços") **só se `isAdmin`** — i.e. filtrar `navItems` por `user.isAdmin`. Usuário comum **não vê** o item na sidebar.
- **`App.tsx`**: nova rota `historico-precos` (protegida) → `ProductHistoryPage`.
- **Nova página `apps/web/src/pages/ProductHistoryPage.tsx`** (admin-only):
  - Tabela de produtos (reaproveita o padrão `DataPage`/`DataPage.Table` do projeto — auto-responsivo, já usado em MirrorLogs). Colunas: imagem (thumb), título, marketplace, menor/maior preço, # variações, última vez vista.
  - Ao clicar num produto: **drawer/modal** com gráfico de linha do preço por variação ao longo do tempo (histórico de `price_history`). Sem lib de chart pesada — um SVG inline simples ou `<canvas>` mínimo (ou `recharts` se já estiver no bundle; verificar `apps/web/package.json` antes de adicionar dep).
  - Filtros: marketplace, busca por título.

#### 5.5.4. Gate de acesso (segurança)

- Backend: toda rota `/api/catalog/*` checa `auth.isAdmin` → senão `403 { success:false }`. Mesmo que alguém descubra a URL, não retorna dado.
- Frontend: item de menu **ausente** para não-admin (defense in depth — o backend é a fonte de verdade).

---

## 8. Catálogo em Worker Isolado (Queue C)

> O catálogo **não roda no ingestor nem no dispatcher**. É um **3º worker dedicado** (`apps/catalog-worker`), consumindo sua própria fila Redis — exatamente o padrão Worker v2 já dominado (Ingestor :9092 → Dispatcher :9093).

### 8.1. Fluxo

```
Webhook → Queue A (omestre:mirror:raw) → Ingestor (converte + envia) → Queue B (omestre:mirror:send) → Dispatcher
              │
              └─(XADD omestre:mirror:catalog)→ Queue C → CatalogWorker (:9094, isolado) → grava products/variations/price_history
```

- O **Ingestor só faz `XADD`** (O(1), não-bloqueante) — nunca aguarda I/O de preço. Se a API do ML estiver lenta/throttling, o espelhamento nem sente.
- O **CatalogWorker** faz o `GET api.mercadolibre.com/items/{id}` e a gravação — isolado, com retry/DLQ próprios. Falha de captura **não envenena** o ACK do pipeline de envio.

### 8.2. Contratos

- **Queue C**: `omestre:mirror:catalog` (Redis Stream). Consumer group `mirror-catalog` (constante `MIRROR_CATALOG_CONSUMER_GROUP` em `packages/shared/src/index.ts`, mesmo padrão `mirror-raw`/`mirror-send`; 1 consumer, escala com mais consumers se precisar).
- **`CatalogJob`** (tipo em `packages/shared/src/mirror-message.ts`, seção 3.1) — **só identidade + contexto**: `productKey`, `marketplace`, `itemId`, `resolvedUrl`, `sourceGroupJid`, `messageId`, `capturedAt`, e `userId` (preencido pelo ingestor a partir do `SourceGroupConfig` do fan-out, pra o worker Shopee resolver `creds` sem refazer a resolução). **Nenhum dado de preço/variação/imagem** — o worker busca tudo fresco na fonte.
- **DLQ** via `packages/worker-common` (mesmo `pushToDLQ` do v2). Job falho vai pra DLQ, não trava a fila.

### 8.3. Infra / Deploy

- `apps/catalog-worker/Dockerfile` (copiar do `apps/ingestor`/`dispatcher` — build Bun + entrypoint).
- `docker-compose.yml` e `docker-compose.dev.yml`: serviço `catalog-worker` (porta container `:9094`, host `5456` no dev pra não colidir com 545x). `REDIS_URL` + `POSTGRES_URL` herdados.
- `scripts/dev.ts`: start/stop/lock do novo processo (mesmo padrão do ingestor/dispatcher).
- `deploy-local.sh`: incluir no gate de build/test antes do up.
- `worker-common`: reusar `StepTracker`, `metrics-server` (porta `METRICS_PORT`+offset), `pushToDLQ`, `processFailure` — zero código novo de infra.

### 8.4. Recuperação de PEL órfão

- No startup do CatalogWorker: `XAUTOCLAIM omestre:mirror:catalog cg consumer 0-0` pra resgatar jobs não-ACKados (mesma técnica do Dispatcher v2).

---

## 6. Critérios de aceite

- [ ] `products.product_key` é UNIQUE e o mesmo link vista 5x no dia gera **1** linha em `products`.
- [ ] Cada variação do ML vira 1 linha em `product_variations` com `variation_name` legível.
- [ ] `price_history` acumula pontos ao longo do tempo; re-envio com preço igual dentro da janela de gap **não** cria ponto novo.
- [ ] Falha na catalogação **nunca** quebra o espelhamento (está em try/catch isolado).
- [ ] `bunx tsc --noEmit` silencioso em `packages/db`, `packages/shared`, `apps/ingestor`, `apps/catalog-worker`, `apps/api`, `apps/web`.
- [ ] **Ingestor não grava nem faz I/O de preço** — só `XADD omestre:mirror:catalog` (verificável: `logReflectedOffer` sem `await db` de catálogo).
- [ ] **CatalogWorker isolado**: sobe como processo próprio, consome Queue C, não compartilha consumer group com ingestor/dispatcher.
- [ ] `products.product_key` UNIQUE → mesma oferta 5x no dia gera **1** linha.
- [ ] `price_history_dedup_idx` (UNIQUE) → re-envio/fan-out na mesma hora **não** duplica preço idêntico (concorrência coberta).
- [ ] **Estoque/lista**: `price_history` grava `list_price`/`available`/`stock` quando a API der (ML).
- [ ] Falha na captura vai pra **DLQ do CatalogWorker**, nunca trava o espelhamento.
- [ ] **UI admin oculta**: item "Histórico de Preços" só p/ `isAdmin`; `GET /api/catalog/*` → `403` p/ não-admin.
- [ ] **Backfill**: script popula histórico de `reflected_offers` existente.
- [ ] `ProductHistoryPage` lista + drawer com gráfico de linha.
- [ ] Rotas/contrato de **espelhamento** (`mirrors`, `webhook`, `SendEvent` de envio) não mudam.

---

## 7. Fora de escopo desta fase (fases futuras, só registrado)

- **Comparativo na oferta**: template ganha `{menor_preco_30d}`, `{variacao_mais_barata}`, badge "preço em queda" — lendo `price_history` na montagem da oferta (não no envio). A UI admin consulta hoje, o espelhamento ainda não expõe.
- **Enriquecimento Shopee de variações** reais via `modelVariationSku` (GraphQL) — hoje só variação única implícita.
- **Coleta de preço periódica** (cron) para produtos já vistos, independente de aparecerem no WhatsApp.
- **Alerta de preço** ("produto X caiu pra Y") — usa o histórico.
- **Gestão de admins via UI** (promover/rebaixar) — hoje é só `ADMIN_EMAILS` (env).
- **Heartbeat diário** (Melhoria 4): subir `price_bucket` pra truncagem diária e inserir 1 snapshot/dia mesmo sem mudança de preço (mostrar "estável há N dias"). Opcional — o único índice de 1h já cobre dedup; se quiser heartbeat, trocar `date_trunc('hour')` por `date_trunc('day')` no `CatalogJob`.

## Revision history

| Date       | Version | Change                                                                                                                                                                                         | Reason                                                            |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 2026-07-28 | 0.1.0   | Adopted spec-driven template                                                                                                                                                                   | Bootstrap of `spec-driven` skill                                  |
| 2026-07-31 | 0.2.0   | Rev C3 (CatalogWorker): documentado skip de variação ML sem price, política de descarte sem dado útil e consumer group real `mirror-catalog`                                                   | Decisões tomadas na implementação do worker (apps/catalog-worker) |
| 2026-07-31 | 0.3.0   | Backfill + infra entregues (commits 6-7): `bun run backfill`, catalog-worker no compose/dev.ts/deploy, `publishCatalogJob`→worker-common, `resolveCatalogTarget`/`parseAffiliateUserId`→shared | Execução t_4b9d46cd                                               |
