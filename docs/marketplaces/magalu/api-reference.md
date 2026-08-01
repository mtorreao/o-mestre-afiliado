# Magalu — Programa de Afiliados (Influenciador Magalu / Magazine Você)

> **Fonte:** Pesquisa própria + repositórios públicos BR (`thiagoplb/affiliate_links`) + Termo de Uso Influenciador Magalu.
> **Última atualização:** 2026-07-31
> **Link do programa:** https://www.magazinevoce.com.br/
> **Plano de implementação:** [`docs/plans/magalu.md`](../../plans/magalu.md)

---

## 🆕 Arquitetura multi-afiliado (2026-07-31)

O Magalu entrou no `O Mestre Afiliado` como o **quarto marketplace real** (depois de Shopee, Mercado Livre e Amazon), seguindo o template Amazon: cada afiliado da plataforma cadastra **1 slug de loja único** (definido no cadastro do Influenciador Magalu) e o conversor reconstrói a URL do Magazine Você com esse slug.

### Diferença crítica vs. Amazon/ML

- **Amazon** → adiciona `?tag=...` à URL do produto (parâmetro).
- **Mercado Livre** → adiciona `?matt_word=...&matt_tool=...` ou troca por link curto `meli.la/...`.
- **Magalu** → **troca o primeiro segmento do path** (slug da loja). URL do produto não tem parâmetros de afiliado — a afiliação está no path.

```
URL original:    https://www.magazineluiza.com.br/celular-x/p/12345/
URL de afiliado: https://www.magazinevoce.com.br/{storeSlug}/celular-x/p/12345/in/te/
                 └───────────────────────┘  └───────┘ └──────┘ └────┘ └─┘ └─┘
                     host (magazinevoce)   storeSlug   slug     /p/  id  cat subCat
                                                          produto
```

### ⚠️ Decisão consciente — sem API oficial

A Magalu **não possui API pública** para gerar links de afiliado. O método padrão é construir a URL `magazinevoce.com.br/{storeSlug}/{...}/p/{id}/{cat}/{subCat}/` manualmente. Não conseguimos validar se um slug ou ID existe sem fazer um GET — então:

- **Validação de slug**: `GET /api/magalu/affiliate/validate-slug?slug=X` faz HEAD opcional em `magazinevoce.com.br/{X}/`. **Em dev/E2E retorna `exists: null`** (sem rede). Em produção, se 200 → `exists: true`, se 404 → `exists: false`, timeout/erro → `exists: null` (fail-open).
- **Validação de ID**: não fazemos (custaria 1 GET por oferta). O link é construído determinístico a partir da URL original.

### Modelo de dados

```sql
CREATE TABLE omestre.magalu_affiliates (
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

CREATE INDEX idx_magalu_affiliates_user_id
  ON omestre.magalu_affiliates(user_id);
CREATE INDEX idx_magalu_affiliates_active
  ON omestre.magalu_affiliates(active) WHERE active = TRUE;
```

Slug do Magazine Você: `^[a-z0-9-]{3,40}$` (3-40 chars, letras minúsculas, números e hífen). Imutável após as primeiras 24h do cadastro do Influenciador Magalu.

### Endpoints REST

| Método   | Rota                                         | Descrição                                                                                                                 |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/magalu/affiliate`                      | Dados do afiliado do usuário logado                                                                                       |
| `PUT`    | `/api/magalu/affiliate`                      | Cria/atualiza nickname / storeSlug / active                                                                               |
| `DELETE` | `/api/magalu/affiliate`                      | Remove afiliado                                                                                                           |
| `POST`   | `/api/magalu/convert`                        | Converte URL usando o storeSlug do afiliado                                                                               |
| `GET`    | `/api/magalu/affiliate/validate-slug?slug=X` | Opcional: HEAD em `magazinevoce.com.br/{X}/` → `{ exists: boolean }`. Em dev/E2E, `exists: null` (sem validação de rede). |

### Exemplo: cadastrar slug

```bash
curl -X PUT https://api.seudominio.com/api/magalu/affiliate   -H "Authorization: Bearer ***"   -H "Content-Type: application/json"   -d '{
    "nickname": "Matheus - Magalu",
    "storeSlug": "magazinetorre"
  }'
```

Resposta:

```json
{
  "success": true,
  "message": "Integração Magalu atualizada",
  "affiliate": {
    "id": 1,
    "nickname": "Matheus - Magalu",
    "storeSlug": "magazinetorre",
    "active": true
  }
}
```

### Exemplo: converter URL de produto

```bash
curl -X POST https://api.seudominio.com/api/magalu/convert   -H "Authorization: Bearer ***"   -H "Content-Type: application/json"   -d '{ "url": "https://www.magazineluiza.com.br/celular-x/p/12345/" }'
```

Resposta (sucesso):

```json
{
  "success": true,
  "originalUrl": "https://www.magazineluiza.com.br/celular-x/p/12345/",
  "affiliateUrl": "https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/in/te/",
  "marketplace": "magalu",
  "method": "fallback"
}
```

Resposta (sem afiliado configurado):

```json
{
  "success": false,
  "error": "Afiliado Magalu não configurado. Cadastre seu slug da loja no painel (Configurações → Magalu).",
  "originalUrl": "..."
}
```

Resposta (slug inválido no PUT):

```json
{
  "success": false,
  "error": "Slug da loja inválido: ... . Use 3-40 caracteres (letras minúsculas, números e hífen)."
}
```

---

## Sumário

- [1. Visão Geral](#1-visão-geral)
- [2. Autenticação / Cadastro](#2-autenticação--cadastro)
- [3. Formato da URL Magazine Você](#3-formato-da-url-magazine-você)
- [4. Detecção de Links no WhatsApp](#4-detecção-de-links-no-whatsapp)
- [5. Conversão de URL](#5-conversão-de-url)
  - [5.1 magazineluiza.com.br/p/{id}](#51-magazineluizacombrpid)
  - [5.2 magazinevoce.com.br/{outraLoja}/.../p/{id}](#52-magazinevocecombrotralojap-id)
  - [5.3 maga.lu/{shortlink}](#53-magalu{shortlink})
  - [5.4 URL fora do padrão](#54-url-fora-do-padrão)
- [6. Pipeline de Espelhamento](#6-pipeline-de-espelhamento)
- [7. Link Verification (Safety Check)](#7-link-verification-safety-check)
- [8. CLI `bun run magalu`](#8-cli-bun-run-magalu)
- [9. Observações](#9-observações)
- [10. Referências](#10-referências)

---

## 1. Visão Geral

A Magalu (Magazine Luiza) opera o programa **Influenciador Magalu** (também conhecido como **Magazine Você**). Diferente de Amazon e Mercado Livre, **não há API oficial** para converter URLs — o método é construir a URL `magazinevoce.com.br/{storeSlug}/{...}/p/{id}/{cat}/{subCat}/` manualmente.

### Como funciona a afiliação

| Etapa           | Onde                        | O que acontece                                                                                  |
| --------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| Cadastro        | Portal Influenciador Magalu | Usuário cria a conta, define `storeSlug` (imutável após 24h), recebe comissão % sobre vendas    |
| Geração do link | Sistema do afiliado         | URL `magazinevoce.com.br/{storeSlug}/{produto}/p/{id}/{cat}/{subCat}/` é construída e divulgada |
| Redirect        | Magazine Você (front)       | Acessos pela URL são roteados para a página de produto com tag de afiliação                     |
| Comissão        | Portal Magalu               | Vendas atribuídas ao slug são comissionadas (pessoa física via CPF, 2x/mês)                     |

### Cookie `mlparceiro` — não confunda

Análise de respostas HTTP de `magazineluiza.com.br` mostra um cookie `mlparceiro` em algumas respostas. **Este cookie é interno da Magalu e NÃO afeta comissionamento de terceiros.** É ruído de headers — nosso sistema ignora.

### Parâmetros legados `partner_id` / `promoter_id`

URLs antigas do programa "divulgadores" (pré-Influenciador Magalu) ainda em circulação têm `?promoter_id=X&partner_id=Y`:

```
https://www.magazineluiza.com.br/samsung/divulgador/oferta/241149600/te/gs26/?promoter_id=2737518&partner_id=3440
```

**Esses parâmetros NÃO estão mais ativos** no Influenciador Magalu atual. Nosso conversor **ignora** esses parâmetros (não os mapeia para config de afiliado, não os propaga para a URL construída).

---

## 2. Autenticação / Cadastro

### Credenciais necessárias

Diferente de Amazon (AWS Signature V4) e Mercado Livre (OAuth + cookies de sessão), o Influenciador Magalu **não requer credenciais técnicas** para gerar links de afiliado. Apenas:

| Campo               | Onde obter                         | Formato             |
| ------------------- | ---------------------------------- | ------------------- |
| **CPF**             | Cadastro do Influenciador          | Pessoa física       |
| **Store Slug**      | Escolha no cadastro (imutável 24h) | `^[a-z0-9-]{3,40}$` |
| **Dados bancários** | Portal (para receber comissão)     | Conta PF            |

Não há OAuth, não há access token, não há refresh token. **A "credencial" do afiliado é apenas o slug da loja.**

### Onde achar o slug

1. Login em `https://www.magazinevoce.com.br/`
2. "Minha Loja" → URL da loja
3. Slug = primeiro segmento do path (`magazinevoce.com.br/{slug}/`)

Exemplo: URL `https://www.magazinevoce.com.br/magazinemoniquespg/...` → slug = `magazinemoniquespg`.

### Imutabilidade

> "O slug da loja é imutável após 24h do cadastro. Para trocar, é necessário abrir um ticket com o suporte do Magalu."

Por isso nosso `MagaluAffiliateRepository` é **1 slug por usuário** (sem `tracking_ids[]` como Amazon) e o PUT não permite alterar slug sem validação explícita.

---

## 3. Formato da URL Magazine Você

```
https://www.magazinevoce.com.br/{storeSlug}/{slugProduto}/p/{productId}/{catSlug}/{subCatSlug}/
            └───────────────┘ └─────────────┘ └─────┘ └─────────────┘ └─────────────┘ └─────────────┘
                host            slug da loja     /p/    ID do produto    categoria        subcategoria
```

| Segmento                 | Obrigatório? | Notas                                                                                                       |
| ------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `storeSlug`              | **Sim**      | Slug do afiliado. Determinístico por usuário.                                                               |
| `slugProduto`            | Não          | Slug legível do produto (ex: `celular-x`). Se ausente, reconstrução parcial com placeholder `produto-{id}`. |
| `/p/{productId}/`        | **Sim**      | ID único do produto na Magalu.                                                                              |
| `{catSlug}/{subCatSlug}` | Não          | Categoria e subcategoria. Default: `in/te` quando faltam.                                                   |

### Casos suportados

| URL original                                             | Conversão                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `magazineluiza.com.br/celular-x/p/12345/`                | `magazinevoce.com.br/{slug}/celular-x/p/12345/in/te/`              |
| `magazineluiza.com.br/p/12345/`                          | `magazinevoce.com.br/{slug}/produto-12345/p/12345/` (placeholder)  |
| `magazinevoce.com.br/outraloja/celular-x/p/12345/in/te/` | `magazinevoce.com.br/{slug}/celular-x/p/12345/in/te/` (troca slug) |
| `maga.lu/abc123`                                         | Resolve HEAD/GET → URL real → aplica conversão acima               |

---

## 4. Detecção de Links no WhatsApp

A função `detectMarketplace()` em `packages/shared/src/detect-marketplace.ts` identifica Magalu por:

| Domínio                  | Detectado como        |
| ------------------------ | --------------------- |
| `magalu.com.br`          | `magalu`              |
| `maga.lu`                | `magalu` (shortlink)  |
| `magazineluiza.com.br`   | `magalu`              |
| `magazinevoce.com.br`    | `magalu`              |
| `go.promozone.ai/magalu` | `magalu` (redirector) |

O validador de ofertas (`apps/api/src/services/offerValidator.ts`) reconhece `magazinevoce.com.br` e `magazineluiza.com.br` como links de marketplace (≥70% das últimas 30 mensagens precisam ser de marketplace para o grupo ser aceito como fonte).

---

## 5. Conversão de URL

Toda a lógica de conversão fica em `packages/converters/src/magalu.ts` (I/O + rede) e `packages/converters/src/magalu-pure.ts` (puro, cobertura 100%). Funções públicas:

```typescript
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

### 5.1 magazineluiza.com.br/p/{id}

```typescript
convertMagaluUrlWithStoreSlug(
  'https://www.magazineluiza.com.br/celular-x/p/12345/',
  'magazinetorre',
);
// → {
//     success: true,
//     originalUrl: 'https://www.magazineluiza.com.br/celular-x/p/12345/',
//     affiliateUrl: 'https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/in/te/',
//     marketplace: 'magalu',
//     method: 'fallback',
//   }
```

Quando o slug do produto está ausente (`/p/{id}/`), o conversor usa placeholder determinístico:

```typescript
convertMagaluUrlWithStoreSlug('https://www.magazineluiza.com.br/p/12345/', 'magazinetorre');
// → affiliateUrl: 'https://www.magazinevoce.com.br/magazinetorre/produto-12345/p/12345/'
```

> A reconstrução parcial **não garante comissão** se o placeholder for publicado sem verificação, mas é determinística e única. Para produção, recomendamos **bloquear** ofertas sem slug de produto (regra a definir no `apps/ingestor/src/link-converters-pure.ts`).

### 5.2 magazinevoce.com.br/{outraLoja}/.../p/{id}

```typescript
convertMagaluUrlWithStoreSlug(
  'https://www.magazinevoce.com.br/outraloja/celular-x/p/12345/in/te/',
  'magazinetorre',
);
// → affiliateUrl: 'https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/in/te/'
```

O slug de **outra loja** é substituído pelo slug do afiliado logado. Categorias (`in/te`) são preservadas.

### 5.3 maga.lu/{shortlink}

`maga.lu/{id}` é o shortlink oficial da Magalu. O conversor faz HEAD/GET para resolver para a URL real antes de aplicar a conversão:

```typescript
await resolveMagaluShortlink('https://maga.lu/abc123');
// → 'https://www.magazineluiza.com.br/celular-x/p/12345/'

await convertMagaluUrlWithStoreSlug('https://maga.lu/abc123', 'magazinetorre');
// → resolve para URL real → aplica §5.1
```

Se a resolução falhar (404, timeout, redirect loop), o conversor retorna `{ success: false, error: 'Não foi possível resolver o shortlink maga.lu/abc123' }` e a oferta é **bloqueada** (não convertida). Não damos fallback cego para evitar enviar links quebrados.

### 5.4 URL fora do padrão

URLs que não pertencem à Magalu (ex: `amazon.com.br/dp/B08N5WRWNW`) retornam:

```json
{
  "success": false,
  "error": "URL não é da Magalu",
  "originalUrl": "...",
  "marketplace": "amazon"
}
```

---

## 6. Pipeline de Espelhamento

O espelhamento de ofertas Magalu segue o mesmo padrão dos outros marketplaces (`apps/worker/src/mirror-pipeline.ts`):

```
Grupo WhatsApp (sourceGroup com affiliate configurado)
    ↓ mensagem recebida
Evolution API → POST /webhook/message
    ↓
apps/api (webhook.routes.ts)
    ├── Filtro: @g.us + fromMe=false + texto extraível
    ├── Cache O(1): getAffiliateIdBySourceGroup(jid)
    └── publish("omestre:mirror:raw", RawMessageEvent)
          ↓
apps/ingestor (raw → cook → dispatch)
    ├── resolveUrl() — se for maga.lu/{id}, resolve shortlink
    ├── extractMagaluProductId() — extrai ID
    ├── convertMagaluForAffiliate() — lê magaluAffiliate, chama convertMagaluUrlWithStoreSlug
    │     ├── sem afiliado/slug → bloqueia + processFailure('magalu_account_not_linked')
    │     └── sucesso → magaluRepo.touch(userId) + publica em Queue B
    └── fan-out para targetGroups → publish("omestre:mirror:send", SendEvent)
          ↓
apps/dispatcher (Queue B)
    ├── rate limit + dedup
    └── sendGroupMessage(instanceName, targetGroupJid, text)
```

### `convertMagaluForAffiliate` (apps/ingestor/src/link-converters.ts)

```typescript
async function convertMagaluForAffiliate(url, userId) {
  const magaluRepo = new MagaluAffiliateRepository();
  const affiliate = await magaluRepo.findByUserId(userId);

  if (!affiliate || !affiliate.active || !affiliate.storeSlug) {
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

> Quando o afiliado não tem slug configurado, **além de bloquear a oferta**, o pipeline chama `processFailure('magalu_account_not_linked')` que dispara uma **notificação WhatsApp via Evolution API** (cooldown 1h/Redis) pedindo para o usuário cadastrar o slug. Detalhes em `packages/worker-common/src/notifier.ts` → `processFailure()`.

### `classifyUnsupportedMarketplace` (apps/ingestor/src/link-converters-pure.ts)

```typescript
export function classifyUnsupportedMarketplace(marketplace: string): string | null {
  const unsupportedMarketplaces: Record<string, string> = {
    // magalu REMOVIDO daqui — agora é marketplace suportado
  };
  return unsupportedMarketplaces[marketplace] ?? null;
}
```

Antes da Fase 2.5, `magalu` retornava `'Magalu (Magazine Luiza)'` e a oferta era bloqueada. **A partir de 2026-07-31, retorna `null`** (não bloqueia mais).

---

## 7. Link Verification (Safety Check)

O link-verifier (`apps/ingestor/src/link-verifier.ts`) confere se a URL convertida realmente pertence ao afiliado logado:

```typescript
async function verifyMagaluLink(convertedUrl, affiliateId) {
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

Função pura `verifyMagaluStoreSlugPure()` em `apps/ingestor/src/link-verifier-pure.ts`:

```typescript
export function verifyMagaluStoreSlugPure(
  extractedSlug: string | null,
  affiliate: { storeSlug: string },
): { valid: boolean; reason?: string } {
  if (!extractedSlug) return { valid: true }; // sem slug extraído → fail-open
  if (extractedSlug !== affiliate.storeSlug) {
    return {
      valid: false,
      reason: `Magalu store_slug não corresponde ao afiliado: esperado ${affiliate.storeSlug}, recebido ${extractedSlug}`,
    };
  }
  return { valid: true };
}
```

> **Fail-open sem slug**: se a URL convertida não tem slug extraível (ex: shortlink não resolveu), o link-verifier **não bloqueia**. Assume que a conversão preservou o slug correto. Trade-off: false negatives raros (shortlink mal resolvido) vs. bloqueios desnecessários.

---

## 8. CLI `bun run magalu`

O CLI `bun run magalu <url>` usa `MAGALU_STORE_NAME` do `.env` como fallback (não usa o afiliado do banco — é para testes rápidos sem login):

```bash
$ bun run magalu https://www.magazineluiza.com.br/celular-x/p/12345/
🔗 Magalu: https://www.magazineluiza.com.br/celular-x/p/12345/
✅ https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/in/te/
   (store_slug=magazinetorre)
```

```bash
# .env
MAGALU_STORE_NAME=magazinetorre
```

Para uso em produção (múltiplos afiliados), use o painel (`Configurações → Magalu`) ou os endpoints REST acima — **não** use `MAGALU_STORE_NAME` global.

---

## 9. Observações

### Vantagens

- **Sem credenciais secretas**: ao contrário de ML (OAuth + cookies), a Magalu só precisa do slug. **Sem expiração**, **sem refresh**, **sem sync**.
- **Sem rate limit**: a construção da URL é local (sem chamadas à Magalu). Apenas `maga.lu/{id}` faz rede (1 GET).
- **Tenant-first**: cada afiliado tem slug próprio desde o dia 1.

### Limitações

- **Validação de slug opcional**: o HEAD em `magazinevoce.com.br/{slug}/` pode falhar/falsear. Fail-open é a escolha consciente (não bloqueamos o cadastro se a validação falhar).
- **Validação de ID ausente**: não fazemos GET por oferta (custaria 1 request por link espelhado). O link é construído determinístico e a comissão é confirmada só após a venda.
- **Slug imutável**: se o afiliado errar o slug no cadastro, precisa abrir ticket com a Magalu. UI deve ter tooltip com link para o portal.

### Pitfalls conhecidos

1. **`partner_id` / `promoter_id` legados** — URLs antigas do programa "divulgadores" têm esses parâmetros. **Não mapear** para config de afiliado (são ruído legado). Strip da URL construída.
2. **Shortlinks `maga.lu` sem resolução** — Se HEAD/GET falhar, bloquear a oferta (não dar fallback cego).
3. **Cookie `mlparceiro`** — interno da Magalu. Não usar.
4. **Slug case-sensitive** — `Magazinetorre` ≠ `magazinetorre`. Regex força lowercase na validação.
5. **`/produto-{id}/` placeholder** — quando a URL original não tem slug/categoria, o conversor gera placeholder determinístico. Em produção, considerar bloquear essas ofertas.

---

## 10. Referências

- **Influenciador Magalu:** https://www.magazinevoce.com.br/
- **Termo de Uso:** "Influenciador Magalu - Termo de Uso" (citado nas fontes importadas para o NotebookLM `Pesquisa Afiliados Magalu`).
- **Repositórios públicos de referência:**
  - `thiagoplb/affiliate_links` — Python toolkit com `MagaluAffiliateClient` (mesmo padrão).
- **API?** — **Não existe API oficial pública**. Construção de URL é o método padrão.
- **Cookie `mlparceiro`** — cookie interno da Magalu (não usado para afiliação).
- **Rede parceira:** Sovrn Commerce (Magazine Luiza BR Affiliate Program) — referência externa.

---

## Histórico de revisão

| Date       | Version | Change                                                                                                                                                                                                          |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-31 | 1.0.0   | Release inicial: db (migration 0020), conversor (magalu.ts + magalu-pure.ts), ingestor (link-converters + link-verifier), API (rotas /api/magalu/*), web (MagaluConfigSection), E2E (magalu.api.spec.ts + P11). |
