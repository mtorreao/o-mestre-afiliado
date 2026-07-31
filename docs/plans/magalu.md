# Magalu — Integração de Afiliados para Tenants

> **Status:** camada de banco de dados **entregue** em 2026-07-31 via commit `c4883a2` (migration `0020`, schema Drizzle e repository). Conversor, API e pipeline permanecem **pendentes** na Fase 2 do [`docs/roadmap.md`](../roadmap.md).
>
> **Entregue:** DB multi-tenant para afiliados Magalu. **Pendente:** conversão de links, endpoints/perfil e integração no pipeline/painel.
>
> **Objetivo:** tornar o **Magalu** (Magazine Luiza) o **quarto marketplace real** do `O Mestre Afiliado`, multi-tenant e operável pelo painel, espelhando o que já existe para Shopee / Mercado Livre / Amazon.
>
> **Origem:** consolidação da **subfase 2B (Magalu real)** do `docs/roadmap.md` (Fase 2 — Hardening Amazon + Magalu real).
>
> **Pesquisa:** os detalhes técnicos abaixo foram confirmados via:
>
> - Página oficial do **Influenciador Magalu** (`https://www.magazinevoce.com.br/` e Termo de Uso do programa).
> - Repositórios públicos brasileiros que implementam o mesmo padrão (ex: `thiagoplb/affiliate_links`, `magalu_affiliate.py`).
> - Análise de respostas HTTP reais de `magazineluiza.com.br` (cookie `mlparceiro` — interno da Magalu, **não** usado para afiliação).
> - Pesquisa profunda no NotebookLM (notebook `Pesquisa Afiliados Magalu`, 14 fontes).

---

## TL;DR executivo

1. **Não existe API oficial** da Magalu para gerar links de afiliado. O método padrão é construir a URL do tipo:

   ```
   https://www.magazinevoce.com.br/{storeSlug}/{slugProduto}/p/{productId}/{cat}/{subCat}/
   ```

   O `storeSlug` é o **nome da loja** que o afiliado escolheu no cadastro do programa Influenciador Magalu. Exemplo real:
   `https://www.magazinevoce.com.br/magazinemoniquespg/eliptico-.../p/eadk91754h/es/elet/`.

2. O **cookie `mlparceiro`** que aparece nas respostas HTTP de `magazineluiza.com.br` é um cookie interno da Magalu (não afeta comissionamento de terceiros).

3. O programa é **pessoa física via CPF** (Influenciador Magalu), comissionamento % sobre a venda, pago 2x/mês. Cada afiliado tem **uma loja** por CPF e troca de slug só no dia do cadastro.

4. **Não há API programática** para validar se um slug existe ou se um ID de produto é válido — então nosso sistema precisa operar com **fallback tolerante**: o que não puder ser validado será tratado como "afiliado configurou, geramos o link, validação em runtime via redirect 200/404".

5. **Implicação para o tenant:** cada usuário do `O Mestre Afiliado` pode ser afiliado do Magalu com seu próprio `storeSlug`. Não confundir com o `partner_id=3440&promoter_id=...` que aparece em URLs antigas (`magazineluiza.com.br/.../oferta/...?promoter_id=...&partner_id=...`) — esses são **parâmetros legados** do programa antigo de "divulgadores" e **não estão mais ativos** no Influenciador Magalu atual. Vamos ignorá-los (documentação em §4).

---

## 1. Contexto

### 1.1 Estado atual do projeto

| Componente                                           | Hoje (sem Magalu)                                                                                                                            | O que precisa                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `packages/shared/src/detect-marketplace.ts`          | `MARKETPLACE_DOMAINS.magalu` já mapeia `magalu.com.br`, `maga.lu`, `magazineluiza.com.br`, `magazinevoce.com.br`, `go.promozone.ai/magalu`   | nada (já detecta)                               |
| `packages/shared/src/index.ts`                       | `Marketplace = 'shopee' \| 'mercadolivre' \| 'amazon' \| 'magalu' \| 'unknown'` e `MARKETPLACE_NAMES.magalu = 'Magalu'`                      | nada                                            |
| `packages/db/src/schema/index.ts`                    | `pgEnum('marketplace', ['shopee', 'mercadolivre', 'amazon', 'magalu', 'unknown'])`                                                           | nada                                            |
| `packages/converters/src/`                           | **não existe `magalu.ts`** — `selectConverter('magalu')` retorna `null`                                                                      | criar conversor real                            |
| `packages/converters/src/index.ts`                   | `convertMagaluUrl()` inexistente; `convertUrl()` retorna erro para magalu                                                                    | integrar                                        |
| `apps/ingestor/src/ingestor-pure.ts`                 | `classifyResolvedProductUrl('magalu')` retorna `true` (vai à conversão)                                                                      | manter                                          |
| `apps/ingestor/src/link-converters-pure.ts`          | `classifyUnsupportedMarketplace('magalu')` retorna `'Magalu (Magazine Luiza)'` — **BLOQUEADO** com mensagem "Marketplace ainda não liberado" | remover `magalu` daqui                          |
| `apps/ingestor/src/link-converters.ts`               | sem `convertMagaluForAffiliate()`; cai no fallback `unsupported`                                                                             | implementar                                     |
| `apps/ingestor/src/link-verifier-pure.ts`            | sem `verifyMagaluStoreSlug()`                                                                                                                | implementar validação do slug na URL convertida |
| `apps/ingestor/src/link-verifier.ts`                 | sem `verifyMagaluLink()`                                                                                                                     | implementar                                     |
| `apps/api/src/modules/affiliate/affiliate.routes.ts` | `/profile` retorna `shopee`, `mercadoLivre`, `amazon` — **sem `magalu`**                                                                     | adicionar bloco                                 |
| `apps/api/src/modules/amazon/amazon.routes.ts`       | existe CRUD + tracking-ids                                                                                                                   | espelhar em `magalu.routes.ts`                  |
| `apps/api/src/modules/`                              | sem pasta `magalu/`                                                                                                                          | criar                                           |
| `packages/db/src/schema/`                            | sem `magaluAffiliates.ts`                                                                                                                    | criar                                           |
| `packages/db/src/repository/`                        | sem `magaluAffiliates.repository.ts`                                                                                                         | criar                                           |
| `packages/db/src/migrations/`                        | sem migration de `magalu_affiliates`                                                                                                         | criar                                           |
| `apps/web/src/pages/SettingsPage.tsx`                | abas: whatsapp, shopee, mercadolivre, amazon — **sem magalu**                                                                                | adicionar aba                                   |
| `apps/web/src/pages/sections/`                       | sem `MagaluConfigSection.tsx`                                                                                                                | criar                                           |
| `apps/web/src/pages/MirrorLogsPage.tsx`              | `magalu` já aparece nos filtros e labels                                                                                                     | manter                                          |
| `apps/web/src/pages/DashboardPage.tsx`               | já trata `'magalu'` no breakdown                                                                                                             | manter                                          |
| `docs/marketplaces/`                                 | tem pastas `amazon/`, `mercadolivre/`, `shopee/` — **sem `magalu/`**                                                                         | criar com `api-reference.md`                    |

### 1.2 Por que agora

- O roadmap (`docs/roadmap.md`) já tem a Magalu como **subfase 2B** da Fase 2. Mas a Fase 2 também inclui hardening Amazon (subfase 2A) e observabilidade (2C). Separar **Magalu** em plano próprio desacopla o trabalho e permite paralelizar com Amazon.
- O usuário pediu priorização explícita: **Magalu primeiro**, Amazon depois.
- A feature entrega valor direto: hoje, qualquer link `magalu.com.br/p/...` ou `maga.lu/...` é **bloqueado** com mensagem "Marketplace ainda não liberado". O espelho fica inutilizável para esse mercado, que é o **3º maior e-commerce do Brasil**.

### 1.3 Princípios

1. **Espelhar Amazon** — o template de CRUD multi-tracking-ID já existe (mesmo que aqui o "tracking" seja um slug de loja, não um tag). Manter consistência visual e de API.
2. **Tenant-first** — o slug é por usuário da plataforma (não global), desde o dia 1. Não usar `.env` para slug em produção (assim como Amazon).
3. **Conversor puro** — toda a lógica de extração/construção fica em `packages/converters/src/magalu.ts` + `magalu-pure.ts`, com cobertura ≥ 80%.
4. **Resolver shortlinks** — `maga.lu/{id}` resolve para `magazinevoce.com.br/{slugOriginal}/{...}/p/{id}/...`. Não dar fallback cego — se o shortlink falhar, bloquear a oferta com mensagem clara.
5. **Falha tolerante, mas rastreável** — sem API oficial, não conseguimos validar slug/ID sem fazer um GET. Validação **opcional** via HEAD; se der 200 OK, ok; se der 404 ou timeout, **não bloqueia** (assume que vai funcionar).
6. **Compat** — o link final é construído determinístico a partir da URL original. Se o afiliado não tiver slug configurado, **bloqueia** com mensagem clara (`"Afiliado Magalu sem slug configurado. Configure em Configurações → Magalu."`). Não usar fallback global por `.env` (decisão consciente: o `MAGALU_STORE_NAME` do `.env.example` é mantido apenas para o CLI `bun run magalu <url>` e o `POST /api/convert` legado).

---

## 2. Modelo de dados

### 2.1 Migration `0020_add_magalu_affiliates.sql`

```sql
-- packages/db/src/migrations/0020_add_magalu_affiliates.sql
-- Migration: adiciona tabela magalu_affiliates (Influenciador Magalu)
-- Estrutura paralela a amazon_affiliates, mas usando storeSlug em vez de trackingIds[]
-- (Magalu usa slug único da loja, não tags múltiplas)

CREATE TABLE IF NOT EXISTS omestre.magalu_affiliates (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES omestre.users(id),
  nickname      TEXT,                              -- ex: "Matheus - Magalu"
  store_slug    TEXT NOT NULL,                     -- ex: "magazinetorre"
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  connected_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magalu_affiliates_user_id
  ON omestre.magalu_affiliates(user_id);

CREATE INDEX IF NOT EXISTS idx_magalu_affiliates_active
  ON omestre.magalu_affiliates(active) WHERE active = TRUE;

COMMENT ON TABLE  omestre.magalu_affiliates              IS 'Afiliados Magalu (Influenciador Magalu / Magazine Você). 1 linha por usuário.';
COMMENT ON COLUMN omestre.magalu_affiliates.store_slug   IS 'Slug da loja no Magazine Você (escolhido no cadastro, imutável após 24h). Aparece na URL magazinevoce.com.br/{slug}/...';
```

### 2.2 Drizzle schema

Arquivo `packages/db/src/schema/magaluAffiliates.ts` (espelha `amazonAffiliates.ts`):

```ts
import { boolean, integer, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

export const magaluAffiliates = omestre.table('magalu_affiliates', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  nickname: text('nickname'),
  storeSlug: text('store_slug').notNull(),
  active: boolean('active').notNull().default(true),
  connectedAt: timestamp('connected_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

Re-export em `packages/db/src/schema/index.ts`.

### 2.3 Repositório

`packages/db/src/repository/magaluAffiliates.repository.ts`:

```ts
class MagaluAffiliateRepository {
  findById(id): Promise<MagaluAffiliate | null>;
  findByUserId(userId): Promise<MagaluAffiliate | null>;
  findAll(): Promise<MagaluAffiliateSummary[]>;
  upsert(userId, { nickname, storeSlug, active }): Promise<MagaluAffiliate>;
  touch(userId): Promise<void>;
  delete(userId): Promise<boolean>;
}
```

Repositório enxuto — sem necessidade de "adicionar storeSlug" (slug é único por afiliado, igual a Amazon que tem 1 afiliado por usuário). Para multi-loja no futuro, criar migration dedicada (igual Amazon fez com `trackingIds` jsonb).

**Testes:** `magaluAffiliates.repository.test.ts` segue o padrão de `amazonAffiliates.repository.test.ts` (mock do Drizzle via `mock.module('../db.ts')`).

---

## 3. Conversor

### 3.1 `packages/converters/src/magalu.ts`

API pública:

```ts
// Detecção
isMagaluShortlink(url: string): boolean;             // maga.lu/ID
isMagaluStoreUrl(url: string): boolean;              // magazinevoce.com.br/{slug}/...
isMagazineluizaProductUrl(url: string): boolean;     // magazineluiza.com.br/p/{ID}/...
isMagazinevoceProductUrl(url: string): boolean;      // magazinevoce.com.br/{slug}/{...}/p/{ID}/...
isMagaluProductUrl(url: string): boolean;            // qualquer URL de produto Magalu conhecida

// Extração
extractMagaluProductId(url: string): string | null;          // extrai ID único do produto
extractMagazinevoceStoreSlug(url: string): string | null;   // extrai slug da URL magazinevoce.com.br/{slug}/...

// Resolução (rede)
resolveMagaluShortlink(shortUrl: string): Promise<string | null>;  // maga.lu/abc → URL real (HEAD/GET)

// Construção
buildMagaluAffiliateLink(input: {
  productUrl: string;       // qualquer URL de produto Magalu
  storeSlug: string;        // slug do afiliado
}): string | null;

// Conversão principal
convertMagaluUrlWithStoreSlug(url: string, storeSlug: string): Promise<ConversionResult>;
convertMagaluUrl(url: string): Promise<ConversionResult>;   // fallback .env MAGALU_STORE_NAME
```

### 3.2 Formato da URL construída

```ts
// Entradas possíveis (todas cobertas):
'https://www.magazineluiza.com.br/celular-x/p/12345/';
'https://www.magazineluiza.com.br/p/12345/';
'https://www.magazinevoce.com.br/outraloja/celular-x/p/12345/in/te/';
'https://maga.lu/abc123';
'https://magazinevoce.com.br/outraloja/p/12345/'; // formato curto

// Saída construída:
// https://www.magazinevoce.com.br/{storeSlug}/{slugProduto}/p/{productId}/{catSlug}/{subCatSlug}/
//
// Quando faltam slugProduto/catSlug/subCatSlug (formato magazineluiza.com.br/p/123):
// usa placeholder determinístico derivado do ID para manter URL única:
// https://www.magazinevoce.com.br/{storeSlug}/produto-{productId}/p/{productId}/
// (não garante comissão, mas evita colisão e mantém URL estável)
//
// Para shortlinks maga.lu resolvidos, preservar o path completo resolvido
// (substituindo apenas o primeiro segmento = slug da loja).
```

> **Decisão consciente:** a reconstrução completa da URL (com slug/categoria do produto) **não é possível sem fazer fetch** do produto (Magalu não tem API). Aceitamos reconstrução parcial quando a URL original não tem os segmentos opcionais.

### 3.3 Helper puro isolado

`packages/converters/src/magalu-pure.ts` (extraído p/ cobertura 100%):

```ts
// Regex e funções puras
MAGALU_SHORTLINK_REGEX
MAGALU_PRODUCT_ID_REGEX
MAGAZINELUIZA_PRODUCT_PATH_REGEX
MAGAZINEVOCE_PATH_REGEX

isMagaluShortlinkPure(url: string): boolean
isMagazineluizaProductUrlPure(url: string): boolean
isMagazinevoceProductUrlPure(url: string): boolean
isMagaluProductUrlPure(url: string): boolean
extractMagaluProductIdPure(url: string): string | null
extractMagazinevoceStoreSlugPure(url: string): string | null
buildMagaluAffiliateLinkPure(input: { productUrl: string; storeSlug: string }): string | null
validateMagaluStoreSlug(slug: string): { valid: boolean; reason?: string }   // ^[a-z0-9-]{3,40}$
```

> **Validação de slug:** `^[a-z0-9-]{3,40}$` (slug da Influenciador Magalu só aceita letras minúsculas, números e hífen, 3-40 chars). Bloqueia slug inválido na hora do cadastro.

### 3.4 Integração no conversor global

Atualizar `packages/converters/src/index.ts`:

```ts
// Implementado (commit de integração wt/t_b1d054a8). Os helpers de detecção/
// extração/build vivem em magalu-pure.ts e seguem a convenção de sufixo
// `Pure` do repo (ex: extractMagaluProductIdPure, isMagaluShortlinkPure,
// buildMagaluAffiliateLinkPure) — não existe versão sem sufixo.
export {
  resolveMagaluShortlink,
  resolvePromozoneMagaluUrl,
  generateMagaluOneLink,
  convertMagaluUrlWithStoreSlug,
  convertMagaluUrl,
} from './magalu.ts';

export {
  isMagaluShortlinkPure,
  isMagazineluizaProductUrlPure,
  isMagazinevoceProductUrlPure,
  isPromozoneMagaluUrlPure,
  isMagaluOnelinkUrlPure,
  isMagaluProductUrlPure,
  extractPromozoneMagaluIdPure,
  extractMagaluProductIdPure,
  extractMagazinevoceStoreSlugPure,
  extractMagaluShortlinkIdPure,
  validateMagaluStoreSlugPure,
  buildMagaluAffiliateLinkPure,
  buildMagaluAffiliateLinkPureSafe,
} from './magalu-pure.ts';
export type { BuildMagaluLinkInput, SlugValidation } from './magalu-pure.ts';

export function selectConverter(marketplace): (...) | null {
  switch (marketplace) {
    case 'shopee':       return convertShopeeUrl;
    case 'mercadolivre': return convertMercadoLivreUrl;
    case 'amazon':       return convertAmazonUrl;
    case 'magalu':       return convertMagaluUrl;   // NOVO
    default:             return null;
  }
}
```

### 3.5 CLI `bun run magalu`

Criar `packages/converters/src/cli-magalu.ts` (espelha `cli-shopee.ts`/`cli-mercadolivre.ts`):

```bash
bun run magalu https://www.magazineluiza.com.br/celular-x/p/12345/
# → https://www.magazinevoce.com.br/$MAGALU_STORE_NAME/celular-x/p/12345/in/te/
```

Lê `MAGALU_STORE_NAME` do `.env`.

### 3.6 Testes do conversor

- `packages/converters/src/magalu.test.ts` (testes de integração com `fetch` mockado)
- `packages/converters/src/magalu-pure.test.ts` (puro, 100% cobertura)

Casos obrigatórios:

- [ ] magazineluiza.com.br/p/123 → extrai ID
- [ ] magazineluiza.com.br/slug-produto/p/123 → extrai ID + preserva slug no output
- [ ] magazinevoce.com.br/{slugOrigem}/.../p/123 → troca slugOrigem por storeSlug do afiliado
- [ ] maga.lu/abc → HEAD → GET → extrai ID + slug
- [ ] URL fora do padrão → null com erro claro
- [ ] storeSlug inválido (`""`, `"a"`, `"x".repeat(50)`) → erro descritivo
- [ ] Conversão sem storeSlug → erro "Afiliado Magalu sem slug configurado"
- [ ] Fallback `.env` via `convertMagaluUrl()` quando afiliado não tem config

---

## 4. Decisão técnica: o que fazer com `partner_id` e `promoter_id`

### 4.1 Contexto

URLs antigas do Magalu ainda em circulação:

```
https://www.magazineluiza.com.br/samsung-.../divulgador/oferta/241149600/te/gs26/?promoter_id=2737518&partner_id=3440
```

Esses parâmetros vêm do **programa antigo "divulgadores"** (pré-Influenciador Magalu). Não estão mais ativos para novas comissões — o Influenciador Magalu usa o slug da loja no path.

### 4.2 Decisão

- **Strip** `promoter_id` e `partner_id` da URL construída (são ruído legado).
- **Não mapear** esses parâmetros para nenhuma config de afiliado. Manter registro no `docs/marketplaces/magalu/api-reference.md` apenas para debug.
- **Teste:** converter uma URL com `?promoter_id=X&partner_id=Y` e validar que o output NÃO contém esses parâmetros.

---

## 5. Pipeline (ingestor)

### 5.1 Mudanças no `apps/ingestor/src/link-converters.ts`

```ts
import { convertMagaluUrlWithStoreSlug } from '@omestre/converters';
import { MagaluAffiliateRepository } from '@omestre/db';

// ...

if (effectiveMarketplace === 'magalu') {
  return await convertMagaluForAffiliate(resolvedUrl, userId);
}

// ...

async function convertMagaluForAffiliate(url, userId): Promise<ConversionResult> {
  const magaluRepo = new MagaluAffiliateRepository();
  const affiliate = await magaluRepo.findByUserId(userId);

  if (!affiliate || !affiliate.active || !affiliate.storeSlug) {
    log('info', 'Afiliado Magalu sem slug configurado — bloqueando oferta', { userId });
    processFailure(buildInstanceName(userId), 'magalu_account_not_linked', {
      marketplace: 'magalu',
    }).catch(() => {});
    return buildBlockedResult(
      'magalu',
      'Afiliado Magalu sem slug configurado. Configure em Configurações → Magalu.',
    );
  }

  const result = await convertMagaluUrlWithStoreSlug(url, affiliate.storeSlug);
  if (result.success) {
    await magaluRepo.touch(userId);
  }
  return toConversionResult('magalu', result);
}
```

### 5.2 Mudanças em `apps/ingestor/src/link-converters-pure.ts`

```diff
 export function classifyUnsupportedMarketplace(marketplace: string): string | null {
   const unsupportedMarketplaces: Record<string, string> = {
-    magalu: 'Magalu (Magazine Luiza)',
   };
   return unsupportedMarketplaces[marketplace] ?? null;
 }
```

Atualizar `link-converters-pure.test.ts` — remover o teste que esperava `"Magalu (Magazine Luiza)"` como bloqueado.

### 5.3 Mudanças em `apps/ingestor/src/ingestor.ts`

No caminho de fan-out (`processRawMessage`):

```ts
// Em apps/ingestor/src/ingestor-pure.ts (já está correto, manter)
// if (marketplace === 'magalu') return true;

classifyResolvedProductUrl('magalu') === true; // já está — manter
```

A classificação de "outros" (`classifyLinkKind === 'other'`) já trata magalu como produto no passo 1 — verificar com teste novo.

### 5.4 link-verifier (safety check)

Adicionar em `apps/ingestor/src/link-verifier-pure.ts`:

```ts
export interface MagaluAffiliateParams {
  storeSlug: string;
}

/**
 * Verifica se o slug do Magazine Você na URL convertida corresponde ao
 * afiliado. Sem slug na URL → válido (assume que conversão preservou o slug).
 */
export function verifyMagaluStoreSlug(
  extractedSlug: string | null,
  affiliate: MagaluAffiliateParams,
): ParamVerification {
  if (!extractedSlug) return { valid: true };
  if (extractedSlug !== affiliate.storeSlug) {
    return {
      valid: false,
      reason: `Magalu store_slug não corresponde ao afiliado: esperado ${affiliate.storeSlug}, recebido ${extractedSlug}`,
    };
  }
  return { valid: true };
}

export function extractMagaluStoreSlug(convertedUrl: string): string | null {
  try {
    const url = new URL(convertedUrl);
    // pathname começa com /{slug}/... ou /{slug}
    const match = url.pathname.match(/^\/([a-z0-9-]+)(\/|$)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
```

Adicionar em `apps/ingestor/src/link-verifier.ts`:

```ts
import { extractMagaluStoreSlug, verifyMagaluStoreSlug } from './link-verifier-pure.ts';

// Em verifyAffiliateLink:
if (marketplace === 'magalu') {
  return await verifyMagaluLink(convertedUrl, affiliateId);
}

// ...

async function verifyMagaluLink(convertedUrl, affiliateId): Promise<{ valid; reason? }> {
  const extracted = extractMagaluStoreSlug(convertedUrl);
  const userId = await resolveUserId(affiliateId);
  if (userId === null) {
    return { valid: false, reason: 'Afiliado sem evolutionInstanceId' };
  }
  const repo = new MagaluAffiliateRepository();
  const affiliate = await repo.findByUserId(userId);
  if (!affiliate) {
    return { valid: false, reason: 'URL Magazine Você mas afiliado não vinculado' };
  }
  return verifyMagaluStoreSlug(extracted, { storeSlug: affiliate.storeSlug });
}
```

---

## 6. API

### 6.1 Service

`apps/api/src/modules/magalu/magalu.service.ts` (espelha `amazon.service.ts`):

```ts
import { MagaluAffiliateRepository } from '@omestre/db';
export const magaluRepo = new MagaluAffiliateRepository();
```

### 6.2 Routes

`apps/api/src/modules/magalu/magalu.routes.ts` (espelha `amazon.routes.ts`):

| Método   | Rota                                         | Descrição                                                                                                                              |
| -------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/magalu/affiliate`                      | Dados do afiliado do usuário logado                                                                                                    |
| `PUT`    | `/api/magalu/affiliate`                      | Atualiza nickname / storeSlug / active                                                                                                 |
| `DELETE` | `/api/magalu/affiliate`                      | Remove afiliado                                                                                                                        |
| `POST`   | `/api/magalu/convert`                        | Converte URL usando o storeSlug do afiliado                                                                                            |
| `GET`    | `/api/magalu/affiliate/validate-slug?slug=X` | **Opcional**: HEAD em `magazinevoce.com.br/{X}/` → retorna `{exists: boolean}`. Em dev, sempre retorna `exists: null` (sem validação). |

Exemplo de request/response:

```bash
# PUT /api/magalu/affiliate
curl -X PUT /api/magalu/affiliate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "nickname": "Matheus - Magalu", "storeSlug": "magazinetorre" }'

# Response
{ "success": true, "affiliate": { "id": 1, "nickname": "...", "storeSlug": "magazinetorre", "active": true } }

# POST /api/magalu/convert
curl -X POST /api/magalu/convert \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.magazineluiza.com.br/celular-x/p/12345/" }'

# Response
{ "success": true, "originalUrl": "...", "affiliateUrl": "https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/in/te/", "marketplace": "magalu", "method": "fallback" }
```

### 6.3 Registro na API

Em `apps/api/src/index.ts`:

```diff
 import { amazonRoutes } from './modules/amazon/amazon.routes.ts';
+import { magaluRoutes } from './modules/magalu/magalu.routes.ts';
 ...
 .use(amazonRoutes)
+.use(magaluRoutes)
```

Atualizar `description` do Swagger para incluir Magalu.

### 6.4 `/api/affiliate/profile`

Em `apps/api/src/modules/affiliate/affiliate.routes.ts`:

```diff
 const magaluRepo = new MagaluAffiliateRepository();
+// ... instanciar
+
+const magaluAffiliate = await magaluRepo.findByUserId(auth.userId);
+const magaluInfo = magaluAffiliate
+  ? {
+      connected: true,
+      nickname: magaluAffiliate.nickname,
+      storeSlug: magaluAffiliate.storeSlug,
+      active: magaluAffiliate.active,
+    }
+  : { connected: false };

 return {
   success: true,
   profile: {
     ...
     mercadolivre: mlInfo,
     amazon: amazonInfo,
+    magalu: magaluInfo,
   },
 };
```

### 6.5 `/api/affiliate/test-conversion`

Adicionar ramo `'magalu'` (espelha Amazon):

```ts
if (marketplace === 'magalu') {
  return handleMagaluConversion(auth.userId, url);
}
```

---

## 7. Frontend

### 7.1 `apps/web/src/pages/sections/MagaluConfigSection.tsx`

Espelha `AmazonConfigSection.tsx`, mas com campo `storeSlug` em vez de lista de tracking IDs:

- Input único "Slug da loja (Magazine Você)" com placeholder `magazineseunome`.
- Validação inline: regex `^[a-z0-9-]{3,40}$`.
- Botão "Salvar slug" (PUT).
- Botão "Testar slug" (GET `/api/magalu/affiliate/validate-slug?slug=X`) — opcional, mostra ✓ se HEAD retornou 200.
- Botão "Remover afiliado" (DELETE).
- Status indicator: `✅ Conectado` / `⚪ Não configurado`.

### 7.2 Aba em `apps/web/src/pages/SettingsPage.tsx`

```diff
 const tabs = [
   { value: 'whatsapp',     label: 'WhatsApp',     icon: <Smartphone size={16} /> },
   { value: 'shopee',       label: 'Shopee',       icon: <Store size={16} /> },
   { value: 'mercadolivre', label: 'Mercado Livre', icon: <Package size={16} /> },
   { value: 'amazon',       label: 'Amazon',       icon: <ShoppingBag size={16} /> },
+  { value: 'magalu',       label: 'Magalu',       icon: <ShoppingCart size={16} /> },
 ];

+ {/* Aba 5: Magalu */}
+ {loading ? <Loading ... /> : (
+   <div style={{...}}>
+     <MagaluConfigSection
+       token={token}
+       initialAffiliate={magalu}
+       onUpdate={loadProfile}
+     />
+     <TestConversionSection token={token} />
+   </div>
+ )}
```

`magaluConnected = profile?.magalu?.connected === true` análogo a `amazonConnected`.

### 7.3 Sidebar / Dashboard

`apps/web/src/pages/DashboardPage.tsx` já trata `'magalu'` no breakdown — verificar com teste visual.

`apps/web/src/pages/MirrorLogsPage.tsx` já trata `'magalu'` em filtros e labels — manter.

**Adicionar card de marketplace Magalu** na DashboardPage (`case 'magalu'` no breakdown) — verificar com teste E2E.

### 7.4 Documentação visual

Após aplicar mudanças, **verificar visualmente** no browser (conforme preferência do owner):

1. Settings → aba Magalu
2. Sidebar com ícone
3. Dashboard com card

---

## 8. `.env.example`

```diff
 # AMAZON_TRACKING_ID abaixo é FALLBACK GLOBAL: usado quando o conversor
 # é chamado sem credenciais explícitas do afiliado (ex: CLI `bun run
 # amazon <url>` ou ingestor sem afiliado vinculado). Deixe comentado
 # em produção — use o painel por afiliado.
 #
 # AMAZON_TRACKING_ID=meusite-20
+
+# ═══════════════════════════════════════════════════════════════
+# MAGAZINE LUIZA — Influenciador Magalu (Magazine Você)
+# ═══════════════════════════════════════════════════════════════
+#
+# Estratégia principal: cada afiliado cadastra seu próprio slug da loja
+# via painel (/settings → aba Magalu) — armazenado na tabela
+# omestre.magalu_affiliates (1 slug por afiliado).
+#
+# Slug = nome da loja no Magazine Você, definido no cadastro do
+# programa Influenciador Magalu (ex: "magazinetorre"). Aparece na URL
+# https://www.magazinevoce.com.br/{slug}/...
+#
+# MAGALU_STORE_NAME abaixo é FALLBACK GLOBAL: usado quando o conversor
+# é chamado sem credenciais explícitas do afiliado (ex: CLI `bun run
+# magalu <url>` ou POST /api/convert legado). Deixe comentado em
+# produção — use o painel por afiliado.
+#
+# MAGALU_STORE_NAME=magazineseunome
```

---

## 9. Testes E2E

### 9.1 `e2e/magalu.api.spec.ts` (espelha `e2e/amazon.api.spec.ts`)

Cenários obrigatórios:

- [ ] `GET /api/magalu/affiliate` sem config → `{ configured: false }`
- [ ] `PUT /api/magalu/affiliate` com slug válido → 200
- [ ] `PUT /api/magalu/affiliate` com slug inválido (`"A"` muito curto) → 400 com erro claro
- [ ] `GET /api/magalu/affiliate` com config → retorna slug
- [ ] `DELETE /api/magalu/affiliate` → 200 + affiliation removida
- [ ] `POST /api/magalu/convert` com URL `magazineluiza.com.br/p/123` + slug configurado → 200, affiliateUrl começa com `magazinevoce.com.br/{slug}/`
- [ ] `POST /api/magalu/convert` sem slug configurado → 404 com erro descritivo
- [ ] `POST /api/magalu/convert` com URL fora do padrão → 400

### 9.2 `e2e/mirror-pipeline.api.spec.ts` (estende o existente)

Cenário novo:

- [ ] P11: oferta Magalu `/p/123` em grupo fonte → grupo destino, com `affiliateUrl` apontando para `magazinevoce.com.br/{slugAfiliadoTeste}/.../p/123/`

### 9.3 Testes unitários (resumo)

| Arquivo                                                          | Cobertura alvo                   |
| ---------------------------------------------------------------- | -------------------------------- |
| `packages/converters/src/magalu-pure.test.ts`                    | 100% (puro)                      |
| `packages/converters/src/magalu.test.ts`                         | ≥ 80% (com fetch mockado)        |
| `packages/db/src/repository/magaluAffiliates.repository.test.ts` | ≥ 80% (mock Drizzle)             |
| `apps/ingestor/src/link-verifier-pure.test.ts`                   | estender com casos Magalu        |
| `apps/ingestor/src/link-converters-pure.test.ts`                 | remover teste "magalu bloqueado" |
| `apps/api/src/modules/magalu/`                                   | testes E2E                       |

---

## 10. Critérios de aceite globais

### 10.1 Funcionais

- [ ] Usuário logado pode cadastrar slug do Magazine Você em `/settings → Magalu`.
- [ ] Slug é validado por regex (`^[a-z0-9-]{3,40}$`); inválido retorna 400 com mensagem clara.
- [ ] `POST /api/magalu/convert` com URL `magazineluiza.com.br/p/123` + slug configurado retorna link afiliado correto.
- [ ] Shortlinks `maga.lu/abc` são resolvidos via HEAD/GET antes da conversão.
- [ ] Espelhamento de link Magalu no WhatsApp chega ao grupo destino com link afiliado (`magazinevoce.com.br/{slugAfiliado}/...`).
- [ ] `classifyUnsupportedMarketplace('magalu') === null` (não bloqueia mais).
- [ ] Link-verifier confere `store_slug` da URL convertida com o do afiliado; bloqueia se divergir.

### 10.2 Não-funcionais

- [ ] `bun run typecheck` 0 erros.
- [ ] `bun run test:unit` verde (todos os testes novos + ajustados).
- [ ] `bun run test:coverage` mantém cobertura ≥ 80% ajustada.
- [ ] `bun run test:e2e` verde (cenários novos + existentes).
- [ ] `bun run build` 0 erros.
- [ ] Conversor isolado em `*-pure.ts` com cobertura 100% das funções puras.

### 10.3 Visuais

- [ ] Settings → aba Magalu renderiza corretamente (visual check).
- [ ] Sidebar mostra ícone/link para `Settings → Magalu`.
- [ ] DashboardPage mostra contagem por marketplace incluindo Magalu.
- [ ] MirrorLogsPage mostra filtro "Magalu" e label 🛍️ Magalu.

### 10.4 Documentação

- [ ] `docs/marketplaces/magalu/api-reference.md` criado (template Amazon).
- [ ] `AGENTS.md` atualizado com bloco "Magalu" em "Conversores" + "Env vars" + link para `docs/plans/magalu.md`.
- [ ] `docs/roadmap.md` atualizado: Magalu real sai de "subfase 2B" e vira plano próprio (prioridade alta).

---

## 11. Riscos e mitigações

| Risco                                                                                                                           | Mitigação                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Magalu muda o formato de URL do Magazine Você sem aviso (já aconteceu em 2024 com a migração de "divulgador" → "influenciador") | `extractMagazinevoceStoreSlugPure` + regex ficam isolados em `magalu-pure.ts`; testes de regressão ficam centralizados. Ajustar regex é 1 commit.                                                                              |
| Slug de afiliado configurado está errado/trocado/foi deletado                                                                   | Conversor não falha (Magalu aceita qualquer string no path, retorna 404). Adicionar telemetria: `log('warn', 'Magalu affiliate URL retornou 404', { userId, storeSlug })` se conseguirmos detectar (opcional, fora do escopo). |
| Usuário não consegue achar o slug dele                                                                                          | Frontend mostra tooltip com link para `https://www.magazinevoce.com.br/` (login → "Minha Loja" → URL).                                                                                                                         |
| Bot do Magalu bloqueia fetch de validação de slug                                                                               | `validate-slug` é opcional; se HEAD falhar, retorna `exists: null` (não bloqueia o cadastro).                                                                                                                                  |
| Race condition: 2 users configuram slug simultaneamente                                                                         | UNIQUE em `user_id` + UNIQUE em `store_slug` opcional (futuro). Por ora, confiar no upsert transacional.                                                                                                                       |
| Conversão com URL que não tem slug/categoria                                                                                    | Reconstrução parcial com placeholder determinístico (`/produto-{id}/p/{id}/`) — documentado no §3.2.                                                                                                                           |
| Extração de ID ambígua (ex: `/oferta/241149600` vs `/p/123`)                                                                    | Regex cobre ambos os formatos (`/p/{ID}/`, `/oferta/{ID}/`) — testado.                                                                                                                                                         |

---

## 12. Commits sugeridos (10)

1. `feat(db): add magalu_affiliates table` — migration + schema Drizzle + re-export.
2. `feat(db): add MagaluAffiliateRepository with tests` — repositório + mock Drizzle test.
3. `feat(converters): add Magalu pure helpers and slug validation` — `magalu-pure.ts` + testes 100%.
4. `feat(converters): add Magalu converter with shortlink resolution` — `magalu.ts` + testes de integração.
5. `feat(converters): integrate Magalu into selectConverter and CLI` — index.ts + cli-magalu.ts.
6. `feat(ingestor): unblock Magalu in link-converters and add convertMagaluForAffiliate` — pure + io + testes.
7. `feat(ingestor): add Magalu store_slug verification in link-verifier` — pure + io + testes.
8. `feat(api): add Magalu affiliate routes and /profile integration` — service + routes + swagger + teste E2E.
9. `feat(web): add Magalu configuration section and dashboard counts` — MagaluConfigSection + aba Settings + verificação visual.
10. `docs(magalu): add Magalu API reference and update architecture` — `docs/marketplaces/magalu/api-reference.md` + AGENTS.md + roadmap.

Cada commit: typecheck + test:unit + lint verde. PR com os 10 commits encadeados.

---

## 13. Próximo passo concreto

1. **Branch:** criar worktree dedicado `wt/magalu-v1-<id>` a partir da `main`.
2. **Sequência:** commit 1 (DB) → commit 2 (repo) → commits 3-5 (conversor) → commit 6 (ingestor) → commit 7 (verifier) → commit 8 (API) → commit 9 (web) → commit 10 (docs).
3. **Validação final:** `bun run typecheck && bun run test:unit && bun run test:coverage && bun run build && bun run test:e2e` tudo verde.
4. **PR para main** com 10 commits e descrição detalhada.
5. **Atualizar roadmap** (§14 abaixo).

---

## 14. Mudança no roadmap

`docs/roadmap.md` precisa de 2 mudanças:

### 14.1 Renomear Fase 2

```diff
-## Fase 2 — Hardening Amazon + Magalu real
-**Objetivo:** garantir Amazon ponta a ponta (afiliado/conversor/E2E) e implementar Magalu como marketplace de fato
+## Fase 2 — Hardening Amazon
+**Objetivo:** garantir Amazon ponta a ponta (afiliado/conversor/E2E/observabilidade).
+**Por que primeiro:** marketplace validado, base sólida para os novos marketplaces que virão depois.
+**Plano detalhado:** `docs/plans/amazon-hardening.md` (a criar a partir desta fase — espelho da Magalu).
```

### 14.2 Promover Magalu para Fase 2.5 (alta prioridade)

```diff
+## Fase 2.5 — Magalu real (Marketplace 4) ⭐ PRIORIDADE ALTA
+**Objetivo:** implementar Magalu como marketplace de fato: afiliado configurável por tenant, conversor real, validação de link, cobertura de testes e visibilidade no frontend.
+**Por que em primeiro lugar (antes de Amazon hardening):** demanda direta do owner, mercado relevante (3º maior e-commerce BR), trabalho bem isolado e paralelo a Amazon.
+**Plano detalhado:** [`docs/plans/magalu.md`](./magalu.md) (pronto).
+**Entregas:** ver `docs/plans/magalu.md` §1–§11. Resumo:
+  - DB: `magalu_affiliates` (slug único por usuário).
+  - Conversor: `packages/converters/src/magalu.ts` + `magalu-pure.ts` (slug validation, shortlink resolution).
+  - Ingestor: `convertMagaluForAffiliate` + `verifyMagaluStoreSlug` + remover `magalu` da lista de bloqueados.
+  - API: rotas `/api/magalu/*` + integração em `/api/affiliate/profile`.
+  - Web: `MagaluConfigSection` + aba em Settings.
+  - E2E: `e2e/magalu.api.spec.ts` + caso P11 no `mirror-pipeline.api.spec.ts`.
+  - Docs: `docs/marketplaces/magalu/api-reference.md`.
+**Critérios de aceite:** ver `docs/plans/magalu.md` §10.
+**Commits sugeridos:** 10 (ver `docs/plans/magalu.md` §12).
```

### 14.3 Reordenar fases

```
Fase 0 (Fundação admin)
  → Fase 1 (Feature flags)
    → Fase 2.5 (Magalu real) ⭐ NOVA, PRIORIDADE ALTA
      → Fase 2 (Hardening Amazon)
        → Fase 3 (Tenant + convites)
          → ...
```

### 14.4 Atualizar tabela de resumo

```diff
 | # | Fase | Entrega de valor | Planos que ela mescla |
 |---|---|---|---|
 | 0 | Fundação admin | ... | ... |
 | 1 | Feature flags e kill switch | ... | ... |
-| 2 | Hardening Amazon + Magalu real | ... | novo `magalu.md` |
+| 2 | Hardening Amazon | ... | novo `amazon-hardening.md` |
+| 2.5 | Magalu real ⭐ | Marketplace 4 funcional | novo `magalu.md` |
 | 3 | Convite de funcionário + tenant | ... | ... |
```

---

## 15. Referências

- **Programa oficial:** https://www.magazinevoce.com.br/ (Influenciador Magalu)
- **Termo de uso:** "Influenciador Magalu - Termo de Uso" (citado nas fontes importadas para o NotebookLM)
- **API?** — **Não existe API oficial pública**. Construção de URL é o método padrão.
- **Repositórios públicos de referência (BRL affiliate tools):**
  - `https://github.com/thiagoplb/affiliate_links` — Python toolkit com `MagaluAffiliateClient` (mesmo padrão).
- **Cookie `mlparceiro`** — cookie interno do Magalu (não usado para afiliação).
- **Rede parceira:** Sovrn Commerce (Magazine Luiza BR Affiliate Program) — referência externa.

## Revision history

| Date       | Version | Change                                                                              | Reason                           |
| ---------- | ------- | ----------------------------------------------------------------------------------- | -------------------------------- |
| 2026-07-31 | 0.1.1   | DB layer delivered via commit `c4883a2`; converter, API and pipeline remain pending | Roadmap Phase 2                  |
| 2026-07-28 | 0.1.0   | Adopted spec-driven template                                                        | Bootstrap of `spec-driven` skill |
| Date       | Version | Change                       | Reason                           |
| ---------- | ------- | ---------------------------- | -------------------------------- |
| 2026-07-28 | 0.1.0   | Adopted spec-driven template | Bootstrap of `spec-driven` skill |
