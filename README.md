# o-mestre-afiliado 🦸‍♂️

Conversor de links de afiliados para **Shopee** e **Mercado Livre**.

## 📦 Estrutura (Monorepo)

```
o-mestre-afiliado/
├── apps/
│   ├── api/          # Elysia API — endpoints REST de conversão
│   ├── worker/       # Background worker — fila de processamento em lote
│   └── web/          # React + Vite — interface web para conversão
├── packages/
│   ├── shared/       # Tipos e constantes compartilhados
│   └── converters/   # Lógica de conversão (Shopee, Mercado Livre)
├── docs/             # Documentação das APIs de marketplace
├── package.json      # Raiz do workspace
└── tsconfig.json     # Config TypeScript base
```

## 🚀 Começando

```bash
# Instalar dependências (raiz instala todos os workspaces)
bun install

# Copiar env vars
cp .env.example .env
# Edite .env com suas credenciais
```

## ▶️ Desenvolvimento

### Todos os apps simultaneamente
```bash
bun run dev
```

### Individualmente
```bash
# API (Elysia) — http://localhost:3000
bun run dev:api

# Worker (background processing)
bun run dev:worker

# Web (React + Vite) — http://localhost:5173
bun run dev:web
```

## 🔧 Scripts CLI (herdados do projeto original)

```bash
# Shopee
bun run shopee <url_do_produto>

# Mercado Livre
bun run mercadolivre <url_do_produto>
# ou
bun run ml <url_do_produto>
```

## 📡 API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Info do serviço |
| GET | `/health` | Health check |
| POST | `/api/convert` | Converte URL em link de afiliado |
| GET | `/docs` | Swagger UI (documentação interativa) |

### Exemplo de conversão

```bash
curl -X POST http://localhost:3000/api/convert \
  -H "Content-Type: application/json" \
  -d '{"url": "https://shopee.com.br/product/123/456"}'
```

## 🧱 Apps

### API (`apps/api`)
Servidor HTTP com [Elysia](https://elysiajs.com/), framework web para Bun.
- Rotas REST para conversão de links
- CORS habilitado
- Swagger docs em `/docs`

### Worker (`apps/worker`)
Processo background para conversão em lote.

**Modos:**
- `poll` (default) — polling contínuo de fila em memória
- `batch` — processa URLs passadas como argumento e sai:
  ```bash
  bun run --cwd apps/worker dev --batch "url1" "url2" "url3"
  ```
- `once` — executa uma rodada de polling e sai

### Web (`apps/web`)
Interface React + Vite com proxy para API.
- Roda em `http://localhost:5173`
- Proxy do Vite redireciona `/api/*` para `http://localhost:3000`

## 📦 Packages

### `@omestre/shared`
Tipos e utilitários compartilhados:
- `ConversionResult`, `Marketplace`, `ConversionMethod`
- `detectMarketplace()` — identifica marketplace pela URL

### `@omestre/converters`
Lógica de conversão de links:
- **Shopee:** API GraphQL oficial (`generateShortLink`)
- **Mercado Livre:** 3 estratégias (API OAuth → Cookies → Fallback URL params)
- `convertUrl()` — dispatcher automático por marketplace

## 🔐 Variáveis de Ambiente

```env
# Shopee
SHOPEE_APP_ID=seu_app_id
SHOPEE_SECRET=seu_app_secret

# Mercado Livre — API OAuth (recomendado)
ML_CLIENT_ID=seu_client_id
ML_CLIENT_SECRET=seu_client_secret
ML_REFRESH_TOKEN=seu_refresh_token

# Mercado Livre — Cookies (alternativa)
ML_COOKIES="session_id=xxx; ..."

# Mercado Livre — Fallback
ML_MELIID=seu_meliid
ML_MELITAT=om895584
ML_AFFILIATE_TAG=matt:USERNAME:TOOLID

# Worker
WORKER_POLL_INTERVAL=30000
WORKER_MAX_RETRIES=3
WORKER_CONCURRENCY=5
```

## 🛠️ Stack

- **Runtime:** [Bun](https://bun.sh) 1.3+
- **Monorepo:** Bun workspaces
- **API:** [Elysia](https://elysiajs.com/)
- **Web:** React 19 + Vite 6
- **Worker:** Bun runtime (processamento background)
- **Language:** TypeScript 5
