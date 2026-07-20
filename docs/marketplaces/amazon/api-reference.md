# Amazon — Programa de Afiliados (Amazon Associates / Creators API)

> **Fonte:** Documentação oficial Amazon Product Advertising API 5.0 + Creators API + portal Amazon Associates Brasil.
> **Última atualização:** 2026-07-19
> **Link do programa:** https://associados.amazon.com.br/
> **Portal do desenvolvedor (PAAPI 5.0 - legado):** https://webservices.amazon.com/paapi5/documentation/
> **Creators API (novo):** https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction

---

## Sumário

- [1. Visão Geral](#1-visão-geral)
- [2. Autenticação](#2-autenticação)
- [3. Geração de Link de Afiliado](#3-geração-de-link-de-afiliado)
- [4. Product Advertising API 5.0 (Legado)](#4-product-advertising-api-50-legado)
  - [4.1 Operações Disponíveis](#41-operações-disponíveis)
  - [4.2 Exemplo de Requisição](#42-exemplo-de-requisição)
- [5. Creators API (Nova)](#5-creators-api-nova)
- [6. Locale Brasil](#6-locale-brasil)
- [7. Exemplos Práticos](#7-exemplos-práticos)
  - [7.1 Gerar Link de Afiliado](#71-gerar-link-de-afiliado)
  - [7.2 Buscar Produto + Link de Afiliado (PAAPI 5.0)](#72-buscar-produto--link-de-afiliado-paapi-50)
- [8. Detecção de Links no WhatsApp](#8-detecção-de-links-no-whatsapp)
- [9. Observações](#9-observações)
- [10. Referências](#10-referências)

---

## 1. Visão Geral

A Amazon possui o programa **Amazon Associates** (Amazon.com.br Associados) que permite a afiliados ganhar comissão indicando produtos. A conversão de links para links de afiliado segue o mesmo princípio do Mercado Livre: **adicionar um parâmetro de tracking à URL**.

### ⚠️ Atualização Importante (2026)

A Amazon **descontinuou o Product Advertising API 5.0 (PAAPI)** em **15 de maio de 2026**. A nova API é a **Creators API**. Porém, o mecanismo de link de afiliado (parâmetro `?tag=`) permanece o mesmo — mudou apenas a API de consulta de produtos.

### Como funciona a conversão de link

```
URL original:    https://www.amazon.com.br/dp/B0XXXXX
URL de afiliado: https://www.amazon.com.br/dp/B0XXXXX?tag=meutracking-20
                              ↑                               ↑
                         link original            parâmetro de afiliado adicionado
```

---

## 2. Autenticação

### Credenciais da API

A Amazon utiliza **AWS Signature Version 4** para autenticação na API (PAAPI 5.0 e Creators API).

| Credencial | Descrição | Onde obter |
|------------|-----------|------------|
| **Access Key** | Chave de acesso AWS | AWS IAM ou console do Associados |
| **Secret Key** | Chave secreta AWS | AWS IAM ou console do Associados |
| **Partner Tag (Tracking ID)** | Seu identificador de afiliado | Console Amazon Associates |
| **Partner Type** | `Associates` | Fixo |

### Obtendo as credenciais

1. Cadastre-se no [Amazon Associates](https://associados.amazon.com.br/)
2. Crie um Tracking ID (ex: `meusite-20`)
3. Inscreva-se no Product Advertising API:
   - Acesse "Product Advertising API" no menu do Associates
   - Vincule sua conta AWS (ou crie uma)
   - Obtenha Access Key e Secret Key

---

## 3. Geração de Link de Afiliado

A Amazon **não possui um endpoint de conversão de links**. O link de afiliado é gerado adicionando o parâmetro `?tag=` à URL do produto.

```
https://www.amazon.com.br/dp/B0XXXXX?tag=SEUTRACKINGID-20
```

| Parâmetro | Descrição | Exemplo |
|-----------|-----------|---------|
| `tag` | Seu Tracking ID de afiliado | `meusite-20` |
| `ref_` | Parâmetro de referral (opcional) | `ref_=as_li_ss_tl` |

### Formato do Tracking ID

```
{nome}-{numero}
```

- `{nome}` — identificador escolhido por você
- `{numero}` — número de loja (geralmente 20 para Brasil)

Exemplos: `meusite-20`, `minhaloja-20`, `promocoes-20`

**Importante:** cada país tem um sufixo diferente:
| País | Região | Exemplo |
|------|--------|---------|
| Brasil | `amazon.com.br` | `meusite-20` |
| EUA | `amazon.com` | `meusite-20` |
| Alemanha | `amazon.de` | `meusite-21` |
| Reino Unido | `amazon.co.uk` | `meusite-21` |

---

## 4. Product Advertising API 5.0 (Legado)

> ⚠️ **Deprecada em 15/05/2026.** Documentação mantida apenas para referência. Migrar para Creators API.

### 4.1 Operações Disponíveis

| Operação | Descrição |
|----------|-----------|
| `GetItems` | Buscar detalhes de um ou mais ASINs |
| `SearchItems` | Buscar produtos por palavra-chave |
| `GetVariations` | Buscar variações de um produto |
| `GetBrowseNodes` | Buscar árvore de categorias |

### 4.2 Exemplo de Requisição

Endpoint: `https://webservices.amazon.com.br/paapi5/searchitems`

```json
{
  "Keywords": "iphone 15",
  "Resources": [
    "Images.Primary.Large",
    "ItemInfo.Title",
    "Offers.Listings.Price"
  ],
  "PartnerTag": "meusite-20",
  "PartnerType": "Associates",
  "Marketplace": "www.amazon.com.br"
}
```

Parâmetros obrigatórios:

| Parâmetro | Descrição |
|-----------|-----------|
| `PartnerTag` | Seu Tracking ID |
| `PartnerType` | Sempre `"Associates"` |
| `Marketplace` | `"www.amazon.com.br"` para Brasil |

---

## 5. Creators API (Nova)

A **Creators API** é a sucessora do PAAPI 5.0. Documentação disponível em:

```
https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction
```

> **Nota:** O acesso à documentação requer autenticação (retorna 403 sem login).

As mudanças principais esperadas:
- Endpoints e autenticação diferentes do PAAPI
- Mesmo conceito de `PartnerTag` (Tracking ID)
- Suporte contínuo aos mesmos marketplaces

**Para nosso sistema:** o método de conversão de link (`?tag=...`) permanece o mesmo independente da API utilizada. A API é necessária apenas para buscar dados do produto (título, preço, imagem).

---

## 6. Locale Brasil

| Propriedade | Valor |
|-------------|-------|
| Marketplace | `www.amazon.com.br` |
| Moeda | `BRL` (Real) |
| Idioma | `pt_BR` |
| Região AWS | `us-east-1` (padrão) |
| Host da API | `webservices.amazon.com.br` |

### Search Indexes disponíveis (Brasil)

| Índice | Descrição |
|--------|-----------|
| `All` | Todos os departamentos |
| `Books` | Livros |
| `Computers` | Computadores e Informática |
| `Electronics` | Eletrônicos |
| `HomeAndKitchen` | Casa e Cozinha |
| `KindleStore` | Loja Kindle |
| `MobileApps` | Apps e Jogos |
| `VideoGames` | Games |

---

## 7. Exemplos Práticos

### 7.1 Gerar Link de Afiliado

```typescript
// TypeScript — geração de link de afiliado Amazon
function generateAffiliateLink(productUrl: string, trackingId: string): string {
  if (!trackingId) return productUrl;

  const url = new URL(productUrl);
  url.searchParams.set('tag', trackingId);
  return url.toString();
}

// Uso
const url = 'https://www.amazon.com.br/dp/B0C1H5F3K2';
const trackingId = 'meusite-20';

const affiliateLink = generateAffiliateLink(url, trackingId);
// Resultado: https://www.amazon.com.br/dp/B0C1H5F3K2?tag=meusite-20
```

### 7.2 Buscar Produto + Link de Afiliado (PAAPI 5.0)

```typescript
import { createHash, createHmac } from 'node:crypto';

// Configurações
const ACCESS_KEY = 'sua_access_key_aws';
const SECRET_KEY = 'sua_secret_key_aws';
const PARTNER_TAG = 'meusite-20';

async function searchAmazonProducts(keyword: string) {
  const payload = {
    Keywords: keyword,
    Resources: [
      'Images.Primary.Large',
      'ItemInfo.Title',
      'ItemInfo.Features',
      'Offers.Listings.Price',
      'Offers.Listings.DeliveryInfo.IsFreeShippingEligible',
    ],
    PartnerTag: PARTNER_TAG,
    PartnerType: 'Associates',
    MarketPlace: 'www.amazon.com.br',
  };

  // A requisição usa AWS Signature V4
  // Recomenda-se usar o SDK oficial @aws-sdk/client-paapi
  // https://docs.aws.amazon.com/pt_br/paapi/latest/guides/getting-started.html

  const res = await fetch('https://webservices.amazon.com.br/paapi5/searchitems', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // X-Amz-Target, Authorization, Date, etc. (AWS SigV4)
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

// Função auxiliar para gerar link de afiliado a partir de um ASIN
function makeAmazonAffiliateLink(asin: string, trackingId: string): string {
  return `https://www.amazon.com.br/dp/${asin}?tag=${trackingId}`;
}
```

> **Nota:** A implementação completa da AWS Signature V4 é complexa. Para PAAPI 5.0, recomenda-se usar o SDK oficial. Para Creators API, a documentação específica ainda está sendo analisada.

---

## 8. Detecção de Links no WhatsApp

Padrões de URL da Amazon Brasil para detectar nas mensagens:

```
amazon.com.br/dp/{ASIN}
amazon.com.br/{produto}/dp/{ASIN}
amazon.com.br/gp/product/{ASIN}
amazon.com.br/{produto}/product/{ASIN}
amzn.to/{codigo}        (link encurtado oficial)
```

O ASIN é o identificador único de produto da Amazon (10-13 caracteres alfanuméricos).

Regex para detecção:

```typescript
const AMAZON_LINK_REGEX = /amazon\.com\.br\/(?:[^/\s]+\/)?(?:dp|gp\/product|product)\/[A-Z0-9]{10,}/i;
const AMAZON_SHORT_REGEX = /amzn\.to\/[A-Za-z0-9]+/i; // Links encurtados precisam ser resolvidos
```

---

## 9. Observações

1. **PAAPI 5.0 está deprecado** — desde maio/2026. Para novas implementações, usar **Creators API**.

2. **A Creators API requer login** — a documentação oficial (`affiliate-program.amazon.com/creatorsapi/docs/`) retorna 403 sem autenticação. Será necessário revisar quando tivermos acesso.

3. **Links encurtados** — `amzn.to` é o encurtador oficial da Amazon. Resolver com HEAD request.

4. **Link de terceiros** — se o link original já contiver `?tag=...`, ignorar a conversão para não roubar a comissão de outro afiliado.

5. **ASIN** — identificador universal do produto na Amazon, usado em URLs e na API.

6. **Tracking ID por país** — cada país da Amazon requer um Tracking ID diferente. Para Brasil, usa-se `amazon.com.br` com seu tracking.

---

## 10. Referências

- **Amazon Associates Brasil:** https://associados.amazon.com.br/
- **PAAPI 5.0 Documentação:** https://webservices.amazon.com/paapi5/documentation/
- **Creators API (requer login):** https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction
- **PAAPI 5.0 SDK Python:** https://github.com/amzs/paapi5-python-sdk
- **Locale Reference Brasil:** https://webservices.amazon.com/paapi5/documentation/locale-reference/brazil.html
- **Common Request Parameters (PartnerTag):** https://webservices.amazon.com/paapi5/documentation/common-request-parameters.html
