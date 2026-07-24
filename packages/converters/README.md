# 🔄 `@omestre/converters`

> Pacote de lógica de conversão de links de afiliados para **Shopee** e **Mercado Livre**. Usado pela API, Worker e CLI.

---

## 📤 API Pública

### `convertUrl(url: string): Promise<ConversionResult>`

**Função principal.** Detecta automaticamente o marketplace e aplica a estratégia de conversão adequada.

```typescript
import { convertUrl } from '@omestre/converters';

const result = await convertUrl('https://shopee.com.br/produto/123/456');
// → { success: true, affiliateUrl: 'https://shortlink...', marketplace: 'shopee', method: 'api' }
```

---

## 🏪 Shopee

### Fluxo

```
URL do produto → generateShortLink(url) → GraphQL Mutation → Link curto de afiliado
```

### `generateShortLink(originUrl: string): Promise<string | null>`

Faz uma chamada GraphQL para a API oficial da Shopee:

**Endpoint:** `POST https://open-api.affiliate.shopee.com.br/graphql`

**Autenticação:**

| Header | Valor |
|--------|-------|
| `Content-Type` | `application/json` |
| `Authorization` | `SHA256 Credential={appId}, Timestamp={ts}, Signature={sha256(appId + ts + body + secret)}` |

A assinatura SHA256 é gerada com o payload: `{appId}{timestamp}{body}{secret}`.

**Credenciais necessárias:**
- `SHOPEE_APP_ID` — App ID do programa de afiliados
- `SHOPEE_SECRET` — App Secret do programa de afiliados

### `convertShopeeUrl(url: string): Promise<ConversionResult>`

Wrapper que valida o marketplace, chama `generateShortLink` e retorna um `ConversionResult` padronizado.

---

## 🏪 Mercado Livre

### Fluxo (2 estratégias em cascata)

```
URL do produto
    │
    ├── Estratégia 1: API OAuth 2.0 (se ML_CLIENT_ID + ML_CLIENT_SECRET)
    │   └── generateViaApi(url, token) → link de afiliado
    │
    └── Estratégia 2: Fallback URL params (se ML_AFFILIATE_TAG ou ML_MELIID+MELITAT)
        └── generateViaUrlParams(url, creds) → link
```

### Estratégia 1: API OAuth 2.0 (Recomendada)

```typescript
import { getAccessToken, generateViaApi } from '@omestre/converters';

// 1. Obter access token (refresh ou authorization_code)
const auth = await getAccessToken(clientId, clientSecret, undefined, undefined, refreshToken);

// 2. Gerar link via API oficial
const link = await generateViaApi('https://...', auth.access_token);
```

| **Endpoint OAuth:** `POST https://api.mercadolibre.com/oauth/token`
| **Endpoint Link Builder:** `POST https://api.mercadolibre.com/affiliates/link-builder`

### Estratégia 2: Cookies

```typescript
import { generateViaCookies, refreshSessionCookies } from '@omestre/converters';

// Tentativa inicial
let link = await generateViaCookies(url, cookies);

// Se falhar, tenta renovar
if (!link) {
  const newCookies = await refreshSessionCookies(cookies);
  link = await generateViaCookies(url, newCookies);
}
```

Simula o formulário do Link Builder do painel de afiliados do ML. Requer cookies de sessão ativos.

### `convertMercadoLivreUrl`

Wrapper que tenta as 2 estratégias em ordem e retorna um `ConversionResult` padronizado.

**Options:**

```typescript
interface MlConversionOptions {
  prefer?: MlStrategy[]; // Ordem de tentativa, default: ['api', 'cookies']
}
```

---

## 🖥️ CLI (uso direto)

Os entrypoints CLI replicam o comportamento dos scripts originais.

```bash
# Shopee
bun run shopee "https://shopee.com.br/product/123/456"

# Mercado Livre
bun run mercadolivre "https://www.mercadolivre.com.br/produto-X/p/MLB123"
# ou
bun run ml "https://www.mercadolivre.com.br/produto-X/p/MLB123"
```

---

## 🔐 Variáveis de Ambiente

| Variável | Estratégia | Obrigatória |
|----------|-------------|-------------|
| `SHOPEE_APP_ID` | Shopee API | ✅ Para Shopee |
| `SHOPEE_SECRET` | Shopee API | ✅ Para Shopee |
| `ML_CLIENT_ID` | ML API OAuth | Para estratégia 1 |
| `ML_CLIENT_SECRET` | ML API OAuth | Para estratégia 1 |
| `ML_REFRESH_TOKEN` | ML API OAuth | Para estratégia 1 |
| `ML_AFFILIATE_TAG` | URL params | Para estratégia 2 (fallback) |

---

## 🧩 Estrutura de Arquivos

```
packages/converters/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Exportações públicas + convertUrl()
    ├── shopee.ts             # Lógica Shopee (GraphQL API)
    ├── mercadolivre.ts       # Lógica ML (3 estratégias)
    ├── cli-shopee.ts         # CLI entrypoint Shopee
    └── cli-mercadolivre.ts   # CLI entrypoint Mercado Livre
```

---

## 🧪 Tratamento de Erros

Todas as funções de conversão capturam erros internamente e retornam um `ConversionResult` com `success: false` e `error` descritivo — nunca lançam exceções. Isso permite que os apps consumidores (API, Worker) tratem erros uniformemente.
