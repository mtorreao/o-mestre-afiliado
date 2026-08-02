# 🦊 API — `@omestre/api`

> Servidor HTTP baseado em [Elysia](https://elysiajs.com/) para conversão de links de afiliados.

---

## 📡 Endpoints

### `GET /`

Retorna informações do serviço e links para os endpoints disponíveis.

```json
{
  "service": "O Mestre Afiliado API",
  "version": "1.0.0",
  "endpoints": {
    "health": "/health",
    "docs": "/docs"
  }
}
```

### `GET /health`

Health check simples. Útil para probes de Kubernetes, Docker, etc.

```json
{
  "status": "ok",
  "timestamp": "2026-07-20T16:54:19.856Z"
}
```

### `GET /docs`

Interface Swagger UI interativa para explorar e testar a API.

---

## 🚀 Como Rodar

```bash
# Desenvolvimento (hot-reload)
bun run dev:api

# Ou direto na pasta
cd apps/api && bun run --hot src/index.ts
```

A API será iniciada em `http://localhost:3000`.

### Porta customizada

```env
API_PORT=4000
```

---

## 🔧 Dependências

| Pacote                | Versão      | Uso                   |
| --------------------- | ----------- | --------------------- |
| `elysia`              | ^1.2.25     | Framework web         |
| `@elysiajs/cors`      | ^1.2.0      | CORS headers          |
| `@elysiajs/swagger`   | ^1.2.0      | Swagger UI em `/docs` |
| `@omestre/converters` | workspace:* | Lógica de conversão   |
| `@omestre/shared`     | workspace:* | Tipos compartilhados  |

---

## 🧠 Arquitetura

```
Requisição HTTP → Elysia Router → módulos de conversão por afiliado
    │
    ├── /api/ml/convert (Mercado Livre, credenciais do afiliado)
    ├── /api/affiliate (Shopee, credenciais do afiliado)
    └── /api/magalu/convert (Magalu, slug do afiliado)
        │   └── convertShopeeUrl() → generateShortLink() (GraphQL API)
        │
        └── marketplace === 'mercadolivre'
            └── convertMercadoLivreUrl()
                ├── Estratégia 1: API OAuth (access_token)
                ├── Estratégia 2: Cookies (Link Builder simulado)
                └── Estratégia 3: Fallback (?meliid=&melitat=)
```

### Comportamento de erro

A API **nunca** retorna HTTP 5xx para erros de conversão ou credenciais. Toda resposta é HTTP 200 com um campo `success: false` e `error` descritivo. Isso permite que o frontend trate todos os cenários uniformemente.

---

## 🔐 Variáveis de Ambiente

A API usa as mesmas variáveis dos converters (definidas no `.env` raiz):

```env
# Shopee
SHOPEE_APP_ID=seu_app_id
SHOPEE_SECRET=seu_app_secret

# Mercado Livre
ML_CLIENT_ID=seu_client_id
ML_CLIENT_SECRET=seu_client_secret
ML_REFRESH_TOKEN=seu_refresh_token
ML_MELIID=seu_meliid
ML_MELITAT=om895584
ML_AFFILIATE_TAG=matt:USERNAME:TOOLID

# API
API_PORT=3000
```

---

## 📦 Build para Produção

```bash
bun run build:api
# ou
cd apps/api && bun build src/index.ts --outdir=dist --target=bun

# Executar
bun run dist/index.js
```

O `--target=bun` gera um bundle otimizado para o runtime Bun.
