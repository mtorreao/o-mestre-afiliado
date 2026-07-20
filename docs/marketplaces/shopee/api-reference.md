# Shopee — API de Afiliados (Open API)

> **Fonte:** Documentação oficial extraída do portal de afiliados Shopee + análise de wrappers open source + testes diretos nos endpoints.
> **Última atualização:** 2026-07-19
> **Link oficial:** https://affiliate.shopee.com.br/ (requer login)
> **Base URL da API:** `https://open-api.affiliate.shopee.com.br/graphql`

---

## Sumário

- [1. Visão Geral](#1-visão-geral)
- [2. Autenticação](#2-autenticação)
- [3. Endpoints](#3-endpoints)
- [4. GraphQL — Schema](#4-graphql--schema)
  - [4.1 Mutations](#41-mutations)
  - [4.2 Queries](#42-queries)
- [5. Exemplos Práticos](#5-exemplos-práticos)
  - [5.1 Converter Link (generateShortLink)](#51-converter-link-generateshortlink)
  - [5.2 Buscar Produtos (productOfferV2)](#52-buscar-produtos-productofferv2)
- [6. Países Suportados](#6-países-suportados)
- [7. Códigos de Erro](#7-códigos-de-erro)
- [8. Referências](#8-referências)

---

## 1. Visão Geral

A Shopee disponibiliza uma **API GraphQL** para afiliados, chamada **Open API**. Ela permite:

- ✅ **Converter** URLs genéricas de produto em links de afiliado (`generateShortLink`)
- ✅ **Buscar** ofertas disponíveis para promover (`productOfferV2`, `shopeeOfferV2`)
- ✅ **Consultar** comissões, preços e dados de produtos
- ✅ **Relatórios** de conversão e vendas validadas

### Diferenciais

- API unificada para **todos os países** onde a Shopee opera (Brasil, Indonésia, Tailândia, etc.)
- Autenticação via **App ID + App Secret** (par de chaves gerado no painel do afiliado)
- Requisições **assinadas com SHA256** (sem token JWT ou OAuth complexo)
- Documentação oficial acessível **após login** em `https://affiliate.shopee.com.br/open-api`

---

## 2. Autenticação

### Credenciais

Obtidas no painel do afiliado Shopee:

| Campo       | Descrição                          | Onde encontrar                          |
|-------------|------------------------------------|-----------------------------------------|
| `App ID`    | Identificador único da aplicação   | Menu → Open API → Gerar App             |
| `App Secret`| Chave secreta para assinar requests| Menu → Open API → Revelar Secret        |

### Assinatura SHA256

Toda request precisa de um header `Authorization` com o seguinte formato:

```
Authorization: SHA256 Credential={app_id}, Timestamp={timestamp}, Signature={signature}
```

Onde:

```
payload = $app_id + $timestamp + $body_json + $secret
signature = SHA256(payload)
```

| Componente | Descrição |
|------------|-----------|
| `app_id`   | Seu App ID (string) |
| `timestamp`| Unix timestamp atual (segundos). Tolerância de ~5min. |
| `body_json`| Corpo da request em JSON **exatamente como enviado** |
| `secret`   | Seu App Secret (string) |
| `signature`| SHA256 hex digest da concatenação acima |

### Exemplo de geração (Node.js)

```typescript
import { createHash } from 'node:crypto';

function generateAuth(appId: string, secret: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${appId}${timestamp}${body}${secret}`;
  const signature = createHash('sha256').update(payload).digest('hex');
  
  return {
    Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    'Content-Type': 'application/json',
  };
}
```

### Exemplo de geração (Python)

```python
import time
import hashlib
import json

def get_headers(app_id: str, secret: str, payload: dict) -> dict:
    body = json.dumps(payload)
    timestamp = int(time.time())
    sign_factor = f"{app_id}{timestamp}{body}{secret}"
    signature = hashlib.sha256(sign_factor.encode()).hexdigest()
    
    return {
        "Content-Type": "application/json",
        "Authorization": f"SHA256 Credential={app_id}, Timestamp={timestamp}, Signature={signature}"
    }
```

---

## 3. Endpoints

| Ambiente | URL | Status |
|----------|-----|--------|
| Produção (GraphQL) | `https://open-api.affiliate.shopee.com.br/graphql` | ✅ OK (200) |
| Produção (GraphQL) | `https://open-api.affiliate.shopee.{country}/graphql` | ✅ Por país |
| REST v1 (deprecated) | `https://affiliate.shopee.com.br/api/v1/shopify/generate_affiliate_link` | ❌ 404 |

**Nota:** O endpoint REST V1 (`/api/v1/shopify/generate_affiliate_link`) utilizado por bots mais antigos retorna **404**. A API oficial agora é exclusivamente GraphQL.

---

## 4. GraphQL — Schema

### 4.1 Mutations

#### `generateShortLink` ⭐ — **Converter Link em Link de Afiliado**

Esta é a **operação principal** do nosso sistema. Converte uma URL genérica de produto da Shopee em um link curto de afiliado.

```graphql
mutation {
  generateShortLink(input: { originUrl: "https://shopee.com.br/produto-X" }) {
    shortLink
  }
}
```

**Input:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `originUrl` | String | ✅ | URL do produto na Shopee |
| `subIds` | [String] | ❌ | IDs de sub-campanha para rastreamento |

**Output:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `shortLink` | String | Link curto de afiliado |

**Exemplo de request:**

```json
{
  "query": "mutation { generateShortLink(input: { originUrl: \"https://shopee.com.br/product/1234567890/0987654321\" }) { shortLink } }"
}
```

**Exemplo de resposta:**

```json
{
  "data": {
    "generateShortLink": {
      "shortLink": "https://shopee.com.br/Product-X-(i.1234567890.0987654321)?af_id=SEUCODIGO"
    }
  }
}
```

### 4.2 Queries

#### `productOfferV2` — Buscar Ofertas de Produtos

```graphql
query {
  productOfferV2(keyword: "tênis", sortType: 5, limit: 10) {
    nodes { itemId productName priceMin priceMax commissionRate offerLink imageUrl }
    pageInfo { page hasNextPage }
  }
}
```

**Parâmetros:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `keyword` | String | Palavra-chave para busca |
| `sortType` | Int | 1=Relevância, 2=Mais vendidos, 3=Preço decrescente, 4=Preço crescente, 5=Comissão decrescente |
| `page` | Int | Página (default: 1) |
| `limit` | Int | Itens por página (default: 20) |
| `shopId` | Int | Filtrar por loja |
| `itemId` | Int | Filtrar por item específico |
| `listType` | Int | 1=Maior comissão, 2=Top performance, 3=Categoria principal, 4=Subcategoria, 5=Loja |
| `isAMSOffer` | Boolean | Ofertas AMS (Anúncio patrocinado) |
| `isKeySeller` | Boolean | Key seller |

**Campos de retorno (nodes):**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `itemId` | Int | ID do produto |
| `productName` | String | Nome do produto |
| `priceMin` | Float | Preço mínimo |
| `priceMax` | Float | Preço máximo |
| `commissionRate` | Float | Taxa de comissão (%) |
| `commission` | Float | Valor da comissão |
| `sellerCommissionRate` | Float | Taxa de comissão do seller |
| `shopeeCommissionRate` | Float | Taxa de comissão da Shopee |
| `sales` | Int | Quantidade vendida |
| `ratingStar` | Float | Avaliação |
| `priceDiscountRate` | Float | Percentual de desconto |
| `imageUrl` | String | URL da imagem do produto |
| `productLink` | String | Link do produto |
| `offerLink` | String | Link de afiliado |
| `shopId` | Int | ID da loja |
| `shopName` | String | Nome da loja |
| `shopType` | Int | Tipo de loja |
| `productCatIds` | [Int] | IDs das categorias |
| `periodStartTime` | Int | Início da oferta (timestamp) |
| `periodEndTime` | Int | Fim da oferta (timestamp) |

#### `shopeeOfferV2` — Ofertas Promovidas pela Shopee

```graphql
query {
  shopeeOfferV2(listType: 1, limit: 10) {
    nodes { itemId productName offerLink commissionRate }
    pageInfo { page hasNextPage }
  }
}
```

#### `shopOfferV2` — Ofertas por Loja

```graphql
query {
  shopOfferV2(shopId: 12345, limit: 10) {
    nodes { itemId productName offerLink }
    pageInfo { page hasNextPage }
  }
}
```

#### Relatórios

##### `conversionReport`

Relatório de conversões (cliques, pedidos, comissão).

##### `validatedReport`

Relatório de pedidos validados (comissionáveis).

---

## 5. Exemplos Práticos

### 5.1 Converter Link (generateShortLink)

```typescript
// TypeScript — Bun
import { createHash } from 'node:crypto';

const APP_ID = 'seu_app_id';
const SECRET = 'seu_app_secret';
const URL = 'https://open-api.affiliate.shopee.com.br/graphql';

async function generateShortLink(originUrl: string): Promise<string | null> {
  const query = JSON.stringify({
    query: `mutation {
      generateShortLink(input: { originUrl: "${originUrl}" }) {
        shortLink
      }
    }`
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${APP_ID}${timestamp}${query}${SECRET}`;
  const signature = createHash('sha256').update(payload).digest('hex');

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}`
    },
    body: query
  });

  const data = await res.json();
  return data?.data?.generateShortLink?.shortLink ?? null;
}
```

### 5.2 Buscar Produtos (productOfferV2)

```typescript
async function searchProducts(keyword: string) {
  const query = JSON.stringify({
    query: `query {
      productOfferV2(keyword: "${keyword}", sortType: 5, limit: 5) {
        nodes { itemId productName priceMin priceMax commissionRate offerLink imageUrl }
        pageInfo { page hasNextPage }
      }
    }`
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${APP_ID}${timestamp}${query}${SECRET}`;
  const signature = createHash('sha256').update(payload).digest('hex');

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}`
    },
    body: query
  });

  return res.json();
}
```

---

## 6. Países Suportados

| País | Código no domínio | URL da API |
|------|-------------------|------------|
| 🇧🇷 Brasil | `com.br` | `https://open-api.affiliate.shopee.com.br/graphql` |
| 🇮🇩 Indonésia | `co.id` | `https://open-api.affiliate.shopee.co.id/graphql` |
| 🇻🇳 Vietnã | `vn` | `https://open-api.affiliate.shopee.vn/graphql` |
| 🇲🇾 Malásia | `my` | `https://open-api.affiliate.shopee.my/graphql` |
| 🇹🇭 Tailândia | `th` | `https://open-api.affiliate.shopee.th/graphql` |
| 🇸🇬 Singapura | `sg` | `https://open-api.affiliate.shopee.sg/graphql` |
| 🇵🇭 Filipinas | `ph` | `https://open-api.affiliate.shopee.ph/graphql` |
| 🇹🇼 Taiwan | `tw` | `https://open-api.affiliate.shopee.tw/graphql` |

---

## 7. Códigos de Erro

| Código | Mensagem | Causa |
|--------|----------|-------|
| `10020` | Invalid Authorization Header | App ID ou assinatura inválida |
| `10021` | Invalid Signature | Timestamp expirado ou payload incorreto |
| `10022` | Timestamp expired | Relógio do servidor muito dessincronizado (>5min) |
| `10023` | Invalid App ID | App ID não encontrado ou inativo |
| `10024` | Permission denied | App não tem permissão para esta operação |
| `20001` | Invalid parameter | Parâmetro obrigatório ausente ou formato inválido |
| `20003` | Product not found | URL de produto inválida ou produto inexistente |

---

## 8. Observações Importantes

1. **Link detection nos grupos:** O sistema precisa detectar links da Shopee em mensagens no WhatsApp. Padrão de URL:
   ```
   shopee.com.br/products/{item_id}
   shopee.com.br/produto-X-i.{shop_id}.{item_id}
   shopee.com.br/{produto}/dp/{item_id}  (raro)
   ```

2. **Links encurtados:** Muitos grupos compartilham links encurtados (bit.ly, murl.com, etc.). Será necessário resolver o redirect com HEAD request antes de passar ao conversor.

3. **Rate limit:** A API da Shopee tem rate limit. Respeitar ~10 req/s no máximo.

4. **Link de terceiros:** Se o link original já contiver parâmetro de afiliado (`af_id`, `af_click_lal`), NÃO converter — apenas repassar o link original. A conversão só deve ser feita em links limpos (sem parâmetros de afiliado).

5. **Produto indisponível:** Se o link do produto retornar 404, o `generateShortLink` pode falhar. Tratar esse caso.

---

## 9. Referências

- **Portal de Afiliados Shopee:** https://affiliate.shopee.com.br/
- **Open Platform (sellers):** https://open.shopee.com/
- **Wrapper Python (saapi):** https://github.com/RenanGalvao/saapi
- **Bot WhatsApp + Shopee (referência):** https://github.com/mariaeduarda2212/shopee-affiliate-whatsapp-bot
- **Documentação oficial (requer login):** https://affiliate.shopee.com.br/open-api
