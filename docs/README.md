# 📐 O Mestre Afiliado — Arquitetura Geral

> **Monorepo** com 3 apps e 3 pacotes compartilhados, gerenciado por workspaces do Bun.

---

## 🧱 Visão Geral

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        o-mestre-afiliado                                │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │   APPS (aplicações implantáveis)                                │   │
│  │                                                                 │   │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐       │   │
│  │  │              │   │              │   │              │       │   │
│  │  │  api         │   │  worker      │   │  web         │       │   │
│  │  │  (Elysia)    │   │  (Bun proc)  │   │  (React+Vite)│       │   │
│  │  │              │   │              │   │              │       │   │
│  │  │  REST API    │   │  Background  │   │  Interface   │       │   │
│  │  │  :3000       │   │  processing  │   │  :5173       │       │   │
│  │  │  + webhook   │   │  + pipeline  │   │              │       │   │
│  │  │  Evolution   │   │  de msg      │   │              │       │   │
│  │  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘       │   │
│  └─────────┼──────────────────┼──────────────────┼────────────────┘   │
│            │                  │                  │                      │
│  ┌─────────┼──────────────────┼──────────────────┼────────────────┐   │
│  │         │                  │                  │                │   │
│  │  PACKAGES (bibliotecas compartilhadas)                          │   │
│  │                                                                 │   │
│  │  ┌──────────────────┐   ┌──────────────────┐   ┌────────────┐  │   │
│  │  │                  │   │                  │   │            │  │   │
│  │  │  @omestre/shared │   │  @omestre/       │   │@omestre/db │  │   │
│  │  │                  │   │  converters      │   │            │  │   │
│  │  │  Tipos, utils,   │   │                  │   │ Drizzle    │  │   │
│  │  │  constantes      │   │  Shopee + ML     │   │ ORM +      │  │   │
│  │  │  detectMarketpl. │   │  conversion      │   │ PostgreSQL │  │   │
│  │  └──────────────────┘   │  logic           │   │ schema     │  │   │
│  │                         └──────────────────┘   └────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Workspaces (Bun)

O Bun gerencia o monorepo nativamente via `workspaces` no `package.json` raiz:

```json
"workspaces": ["apps/*", "packages/*"]
```

**Regras:**
- Cada `apps/*` e `packages/*` tem seu próprio `package.json`
- Dependências entre workspaces usam `"workspace:*"` como versão
- `bun install` na raiz instala **todas** as dependências de uma vez
- O `node_modules` é compartilhado (hoisting), mas Bun resolve corretamente cada workspace

### Dependências entre workspaces

```
@omestre/shared       ← @omestre/converters  ← apps/api
                    ← apps/worker
                                           ← apps/api
                    → @omestre/converters  ← apps/worker
                    → @omestre/db          ← apps/api
                                          ← apps/worker
```

---

## 🔗 Fluxo de Dados

```
Usuário (CLI)
    │
    ├── bun run shopee <url>
    │   └── packages/converters/src/cli-shopee.ts
    │       └── shopee.generateShortLink()
    │
    ├── bun run mercadolivre <url>
    │   └── packages/converters/src/cli-mercadolivre.ts
    │       └── mercadolivre.convertMercadoLivreUrl()
    │
Usuário (Web)
    │
    ├── http://localhost:5173  (React + Vite)
    │   └── POST /api/convert  (proxy Vite → API)
    │       └── apps/api/src/index.ts (Elysia)
    │           └── converters.convertUrl()
    │               ├── converters.convertShopeeUrl()
    │               └── converters.convertMercadoLivreUrl()
    │
Usuário (API direta)
    │
    └── POST http://localhost:3000/api/convert
        └── apps/api/src/index.ts (Elysia)
            └── converters.convertUrl()
```

---

## 🚀 Desenvolvimento

### Comandos raiz

| Comando | Descrição |
|---------|-----------|
| `bun install` | Instala todas as dependências do monorepo |
| `bun run dev` | Sobe todos os apps em paralelo (concurrently) |
| `bun run dev:api` | Sobe apenas a API em modo hot-reload |
| `bun run dev:worker` | Sobe apenas o worker |
| `bun run dev:web` | Sobe apenas o web app |
| `bun run shopee <url>` | Executa conversor Shopee via CLI |
| `bun run ml <url>` | Executa conversor Mercado Livre via CLI |
| `bun run build` | Compila todos os apps |
| `bun run db:generate` | Gera migrations do Drizzle |
| `bun run db:migrate` | Aplica migrations no banco |
| `bun run db:push` | Push rápido (dev) |
| `bun run db:studio` | Drizzle Studio (UI) |
| `docker compose --env-file .env.infra -f docker-compose.infra.yml up -d` | Sobe infra local (Evolution + PG + Redis) |

### Hot-reload

Cada app usa `bun --hot` para reload automático. **Nota:** arquivos de pacotes (`packages/`) não são monitorados pelo hot-reload — ao alterar um pacote, reinicie o app manualmente.

### TypeScript

- `tsconfig.json` raiz serve como base para todos os sub-projetos
- Cada sub-projeto estende a raiz com seu `tsconfig.json` específico
- O `verbatimModuleSyntax` está habilitado — use `import type` para tipos
- `bun run typecheck` disponível em cada sub-projeto (use `./node_modules/.bin/tsc --noEmit` na raiz)

---

## 🔐 Variáveis de Ambiente

As variáveis são carregadas pelo Bun do arquivo `.env` na raiz. Cada app lê as que precisa:

| Variável | Apps | Obrigatória |
|----------|------|-------------|
| `SHOPEE_APP_ID` | converters, api, worker | Para Shopee |
| `SHOPEE_SECRET` | converters, api, worker | Para Shopee |
| `ML_CLIENT_ID` | converters, api, worker | Para ML OAuth |
| `ML_CLIENT_SECRET` | converters, api, worker | Para ML OAuth |
| `ML_REFRESH_TOKEN` | converters, api, worker | Para ML OAuth |
| `ML_COOKIES` | converters, api, worker | Para ML Cookies |
| `API_PORT` | api | Não (default 3000) |
| `WORKER_POLL_INTERVAL` | worker | Não (default 30000ms) |
| `WORKER_MAX_RETRIES` | worker | Não (default 3) |
| `WORKER_CONCURRENCY` | worker | Não (default 5) |
| `EVOLUTION_API_KEY` | api, worker | Para Integration com Evolution API |
| `POSTGRES_URL` | api, worker | URI do PostgreSQL (sobrescreve variáveis individuais) |
| `POSTGRES_HOST` | api, worker | Host do PG (default: localhost) |
| `POSTGRES_PORT` | api, worker | Porta do PG (default: 5443) |
| `POSTGRES_DATABASE` | api, worker | Nome do banco (default: evolution_db) |
| `POSTGRES_USERNAME` | api, worker | Usuário do PG (default: evolution) |
| `POSTGRES_PASSWORD` | api, worker | Senha do PG |
| `POSTGRES_SCHEMA` | api, worker | Schema do projeto (default: omestre) |

---

## 📦 Implantação

Cada app é independente e pode ser implantado separadamente:

1. **API** (`apps/api`) — Servidor HTTP. Build: `bun run build:api`. O `dist/` contém um binário Bun autocontido.
2. **Worker** (`apps/worker`) — Processo background. Build: `bun run build:worker`.
3. **Web** (`apps/web`) — Static SPA. Build: `bun run build:web` → `dist/` com HTML/JS/CSS estáticos.

### Infraestrutura local

O arquivo `docker-compose.infra.yml` sobe os serviços necessários:

| Serviço | Container | Porta |
|---------|-----------|-------|
| Evolution API | `evolution_api` | 5444 |
| PostgreSQL (compartilhado) | `omestre_postgres` | 5443 |
| Redis | `omestre_redis` | 5445 |

```bash
docker compose --env-file .env.infra -f docker-compose.infra.yml up -d
```

---

## 📚 Documentação de Terceiros

| Documento | Link |
|-----------|------|
| Shopee Afiliados API | `docs/marketplaces/shopee/api-reference.md` |
| Mercado Livre Afiliados API | `docs/marketplaces/mercadolivre/api-reference.md` |
| Amazon Associates API | `docs/marketplaces/amazon/api-reference.md` |
| **Evolution API** | `docs/evolution-api/api-reference.md` |

---

## 🛠️ Stack

|| Componente | Tecnologia |
||------------|-----------|
|| Runtime | Bun 1.3+ |
|| Monorepo | Bun Workspaces |
|| API | Elysia 1.x |
|| Web | React 19, Vite 6 |
|| Worker | Bun runtime nativo |
|| Database ORM | Drizzle ORM + postgres driver |
|| Database | PostgreSQL 17 |
|| Cache | Redis 7 |
|| WhatsApp | Evolution API (Baileys) |
|| Conversão | @omestre/converters (Shopee GraphQL, ML OAuth) |
|| Linguagem | TypeScript 5 (strict mode) |
|| CLI | Bun scripts |
