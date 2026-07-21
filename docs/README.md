# 📐 O Mestre Afiliado — Arquitetura Geral

> **Monorepo** com 3 apps, 3 pacotes compartilhados e 1 extensão Chrome, gerenciado por workspaces do Bun.

---

## 🧱 Visão Geral

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         o-mestre-afiliado                                  │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │   APPS (aplicações implantáveis)                                   │   │
│  │                                                                    │   │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐          │   │
│  │  │              │   │              │   │              │          │   │
│  │  │  api         │   │  worker      │   │  web         │          │   │
│  │  │  (Elysia)    │   │  (Bun proc)  │   │  (React+Vite)│          │   │
│  │  │              │   │              │   │              │          │   │
│  │  │  REST API    │   │  Background  │   │  Interface   │          │   │
│  │  │  :5442       │   │  processing  │   │  :5441       │          │   │
│  │  │  + webhook   │   │  + pipeline  │   │              │          │   │
│  │  │  Evolution   │   │  de msg      │   │              │          │   │
│  │  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘          │   │
│  └─────────┼──────────────────┼──────────────────┼───────────────────┘   │
│            │                  │                  │                        │
│  ┌─────────┼──────────────────┼──────────────────┼───────────────────┐   │
│  │         │                  │                  │                   │   │
│  │  PACKAGES (bibliotecas compartilhadas)                             │   │
│  │                                                                    │   │
│  │  ┌──────────────────┐   ┌──────────────────┐   ┌───────────────┐  │   │
│  │  │                  │   │                  │   │               │  │   │
│  │  │  @omestre/shared │   │  @omestre/       │   │  @omestre/db  │  │   │
│  │  │                  │   │  converters      │   │               │  │   │
│  │  │  Tipos, utils,   │   │                  │   │  Drizzle      │  │   │
│  │  │  constantes      │   │  Shopee + ML     │   │  ORM +        │  │   │
│  │  │  detectMarketpl. │   │  conversion      │   │  PostgreSQL   │  │   │
│  │  └──────────────────┘   │  logic +         │   │  schema       │  │   │
│  │                         │  link curto      │   └───────────────┘  │   │
│  │                         └──────────────────┘                      │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  EXTENSIONS                                                        │   │
│  │  ┌────────────────────────────────────┐                            │   │
│  │  │  chrome-cookie-importer/           │                            │   │
│  │  │  Lê cookies HttpOnly do ML e      │                            │   │
│  │  │  envia para o store do backend    │                            │   │
│  │  └────────────────────────────────────┘                            │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  DATA                                                              │   │
│  │  └── ml-affiliates.json  — Store de afiliados (tokens + cookies)    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 Fluxo de Dados — Conversão ML

```
Usuário (Web)
    │
    │ POST /api/ml/convert { url, mlUserId }
    ▼
┌─────────────────────────────────────────────────┐
│ apps/api/src/index.ts                           │
│                                                  │
│  1. Busca afiliado no store (ml-affiliates.json) │
│  2. Tem sessionCookies?                          │
│     ├── SIM                                     │
│     │   generateShortAffiliateLink()            │
│     │   ├── GET /afiliados/linkbuilder          │
│     │   │   → extrai CSRF de <meta> tag        │
│     │   ├── POST /affiliate-program/...         │
│     │   │   /api/v2/affiliates/createLink       │
│     │   │   → { "urls": [...], "tag": "..." }   │
│     │   └── → short_url: "https://meli.la/..."  │
│     │                                            │
│     └── NÃO → URL params (fallback)             │
│         generateViaUrlParams()                  │
│         → "...?matt_word=..." ou "?meliid=..."  │
└─────────────────────────────────────────────────┘
```

### Extensão Chrome

```
Navegador do usuário (logado no ML)
    │
    │ chrome.cookies.getAll({ domain: '.mercadolivre' })
    │ → lê TODOS os cookies (incluindo HttpOnly)
    ▼
Concatena como "nome=valor; nome=valor; ..."
    │
    │ PUT /api/ml/affiliates/:mlUserId
    │ { sessionCookies: "..." }
    ▼
Backend armazena em data/ml-affiliates.json
```

---

## 🚀 Desenvolvimento

### Comandos raiz

| Comando | Descrição |
|---------|-----------|
| `bun install` | Instala todas as dependências do monorepo |
| `bun run dev` | Sobe todos os apps em paralelo (API :5442, Web :5441) |
| `bun run dev:api` | Sobe apenas a API em modo hot-reload |
| `bun run dev:worker` | Sobe apenas o worker |
| `bun run dev:web` | Sobe apenas o web app |
| `bun run shopee <url>` | Executa conversor Shopee via CLI |
| `bun run ml <url>` | Executa conversor Mercado Livre via CLI |
| `bun run build` | Compila todos os apps |
| `SKIP_INFRA=1 bun run dev` | Sobe apps sem Docker (PG, Redis, Evolution) |

### Portas

| App | Porta | Descrição |
|-----|-------|-----------|
| API | 5442 | Elysia REST API |
| Web | 5441 | Vite dev server + Cloudflare Tunnel |
| Evolution API | 5444 | WhatsApp |
| PostgreSQL | 5443 | Banco de dados |
| Redis | 5445 | Cache/fila |

### Hot-reload

Cada app usa `bun --hot` para reload automático. **Nota:** arquivos de pacotes (`packages/`) não são monitorados pelo hot-reload — ao alterar um pacote, reinicie o app manualmente.

---

## 🔐 Variáveis de Ambiente

| Variável | Apps | Obrigatória |
|----------|------|-------------|
| `SHOPEE_APP_ID` | converters, api, worker | Para Shopee |
| `SHOPEE_SECRET` | converters, api, worker | Para Shopee |
| `ML_CLIENT_ID` | converters, api, worker | Para ML OAuth |
| `ML_CLIENT_SECRET` | converters, api, worker | Para ML OAuth |
| `ML_COOKIES` | converters, api, worker | Para ML Cookies |
| `API_PORT` | api | Não (default 5442) |
| `WORKER_POLL_INTERVAL` | worker | Não (default 30000ms) |
| `EVOLUTION_API_KEY` | api, worker | Para Evolution API |
| `POSTGRES_URL` | api, worker | URI do PostgreSQL |
| `FRONTEND_URL` | api | Não (default http://localhost:5441) |
| `ML_REDIRECT_URI` | api | Não (default http://localhost:5442/api/ml/callback) |

---

## 📦 Store de Afiliados

Arquivo `data/ml-affiliates.json` — lido/escrito em cada request.

```typescript
interface AffiliateRecord {
  mlUserId: string;
  nickname: string;
  accessToken: string;      // OAuth token
  refreshToken: string;
  expiresAt: string;
  connectedAt: string;
  lastUsedAt: string;
  meliid?: string;          // URL param (formato antigo)
  melitat?: string;          // Etiqueta do afiliado
  sessionCookies?: string;   // Cookies de sessão ML (para link curto)
}
```

---

## 📚 Documentação de Terceiros

| Documento | Link |
|-----------|------|
| Shopee Afiliados API | `docs/marketplaces/shopee/api-reference.md` |
| Mercado Livre Afiliados API | `docs/marketplaces/mercadolivre/api-reference.md` |
| Amazon Associates API | `docs/marketplaces/amazon/api-reference.md` |
| Evolution API | `docs/evolution-api/api-reference.md` |

---

## 🛠️ Stack

| Componente | Tecnologia |
|------------|-----------|
| Runtime | Bun 1.3+ |
| Monorepo | Bun Workspaces |
| API | Elysia 1.x |
| Web | React 19, Vite 6 |
| Worker | Bun runtime nativo |
| Database ORM | Drizzle ORM + postgres driver |
| Database | PostgreSQL 17 |
| Cache | Redis 7 |
| WhatsApp | Evolution API (Baileys) |
| Conversão | @omestre/converters (Shopee GraphQL, ML link curto + URL params) |
| Extensão | Chrome Cookie Importer (Manifest V3) |
| Linguagem | TypeScript 5 (strict mode) |
| CLI | Bun scripts |
