# 📦 `@omestre/shared`

> Pacote de tipos, constantes e utilitários compartilhados entre todos os apps do ecossistema "O Mestre Afiliado".

---

## 🎯 Propósito

Evitar duplicação de tipos e lógica de detecção entre API, Worker, Web e Converters. Qualquer código que precise ser consistente entre múltiplos apps pertence aqui.

---

## 📤 Exportações

### `ConversionResult`

Tipo principal que representa o resultado de uma conversão de link.

```typescript
interface ConversionResult {
  success: boolean;
  originalUrl: string;
  affiliateUrl: string | null;
  marketplace: Marketplace;
  method: ConversionMethod;
  error?: string;
}
```

| Campo | Descrição |
|-------|-----------|
| `success` | `true` se o link de afiliado foi gerado |
| `originalUrl` | URL original fornecida |
| `affiliateUrl` | Link de afiliado gerado (ou `null` se falhou) |
| `marketplace` | Marketplace detectado |
| `method` | Método usado na conversão |
| `error` | Mensagem de erro (se `success === false`) |

### `Marketplace`

```typescript
type Marketplace = 'shopee' | 'mercadolivre' | 'amazon' | 'unknown';
```

### `ConversionMethod`

```typescript
type ConversionMethod =
  | 'api'        // API oficial (Shopee GraphQL, ML OAuth)
  | 'cookies'    // Simulação via cookies (ML Link Builder)
  | 'fallback'   // Parâmetros na URL (ML ?meliid=, Amazon ?tag=)
  | 'unknown';
```

### `detectMarketplace(url: string): Marketplace`

Detecta qual marketplace uma URL pertence, baseado em padrões de domínio.

```typescript
import { detectMarketplace } from '@omestre/shared';

detectMarketplace('https://shopee.com.br/produto/123');
// → 'shopee'

detectMarketplace('https://www.mercadolivre.com.br/produto-X/p/MLB123');
// → 'mercadolivre'

detectMarketplace('https://meli.la/ABC123');
// → 'mercadolivre'

detectMarketplace('https://amazon.com.br/dp/123');
// → 'amazon'

detectMarketplace('https://example.com');
// → 'unknown'
```

### `MARKETPLACE_DOMAINS`

Mapa de marketplaces para padrões de regex de domínio.

```typescript
const MARKETPLACE_DOMAINS: Record<Marketplace, RegExp[]>;
```

Uso interno do `detectMarketplace`. Disponível para consulta direta se necessário.

### `AffiliateConfig` e interfaces de configuração

```typescript
interface AffiliateConfig {
  shopee?: ShopeeConfig;
  mercadolivre?: MercadoLivreConfig;
  amazon?: AmazonConfig;
}

interface ShopeeConfig {
  appId: string;
  secret: string;
}

interface MercadoLivreConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  meliid?: string;
  melitat?: string;
  affiliateTag?: string;
  cookies?: string;
}

interface AmazonConfig {
  trackingId?: string;
}
```

---

## 🧩 Uso em outros workspaces

```bash
# No package.json de qualquer workspace:
bun add @omestre/shared@workspace:*
```

```typescript
// Uso no código
import { detectMarketplace, type ConversionResult } from '@omestre/shared';
```

---

## ✅ Type Safety

Este pacote é TypeScript estrito. Ao adicionar novos tipos:

1. Defina a interface/tipo no `src/index.ts`
2. Exporte com `export` nomeado
3. Use `import type` em vez de `import` quando for apenas tipo
4. Documente campos novos com JSDoc
