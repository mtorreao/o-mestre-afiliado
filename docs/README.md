# 📐 O Mestre Afiliado — Arquitetura Geral

> **Monorepo** com 3 apps, 3 pacotes compartilhados e 1 extensão Chrome, gerenciado por workspaces do Bun.

---

## 🗂️ Índice da Documentação

| Pasta                                     | Conteúdo                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/README.md`](./README.md)           | Este arquivo — arquitetura geral, stack, variáveis de ambiente.                                                                                                                                                                                        |
| [`docs/planos/`](./planos/)               | Planos de feature e arquitetura (`arquitetura-worker`, `melhorias-ml`, `template-mensagem`, `autenticacao-cadastro-afiliado`, `roles-e-super-admin`, `historico-precos`, `multi-worktree-dev-stack`, `worker-monitoring`, `extensao-chrome-evolucao`). |
| [`docs/investigacoes/`](./investigacoes/) | Relatórios de investigação (`investigacao-mirror-2026-07-25`).                                                                                                                                                                                         |
| [`docs/marketplaces/`](./marketplaces/)   | Referências de API de terceiros (`mercadolivre`, `shopee`, `amazon`) + PDFs de cadastro ML.                                                                                                                                                            |
| [`docs/evolution-api/`](./evolution-api/) | Referência da Evolution API (WhatsApp).                                                                                                                                                                                                                |

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
│  1. Busca afiliado no banco (tabela ml_affiliates) │
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
Backend armazena no PostgreSQL (tabela ml_affiliates.session_cookies)
```

---

## 🚀 Desenvolvimento

### Comandos raiz

| Comando                                                       | Descrição                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `bun install`                                                 | Instala todas as dependências do monorepo                              |
| `bun run dev`                                                 | Sobe `docker-compose.dev.yml` em um ambiente isolado pela branch atual |
| `bun run scripts/dev.ts --dry-run`                            | Mostra slug e portas calculadas sem subir Docker                       |
| `SKIP_TUNNEL=1 bun run dev`                                   | Sobe a stack da branch sem Cloudflare Tunnel                           |
| `DEV_BUILD=0 bun run dev`                                     | Reutiliza as imagens Docker existentes                                 |
| `DEV_PORT_BASE=6000 bun run dev`                              | Força o bloco de portas 6001–6007                                      |
| `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... bun run dev` | Cria/atualiza o CNAME da branch na zona correta                        |
| `bun run ml <url>`                                            | Executa conversor Mercado Livre via CLI                                |
| `bun run build`                                               | Compila todos os apps                                                  |

### Portas

O script escolhe um bloco de sete portas livre e determinístico por branch. A saída de `bun run dev` (ou `--dry-run`) mostra as portas efetivas:

| Offset do bloco | Serviço            |
| --------------- | ------------------ |
| `base + 1`      | Web                |
| `base + 2`      | API                |
| `base + 3`      | PostgreSQL         |
| `base + 4`      | Evolution API      |
| `base + 5`      | Redis              |
| `base + 6`      | Ingestor metrics   |
| `base + 7`      | Dispatcher metrics |

Use `DEV_PORT_BASE=6000` para fixar o bloco 6001–6007. Cada ambiente usa builds Docker; para reduzir o tempo de restart, use `DEV_BUILD=0`.

---

## 🔐 Variáveis de Ambiente

| Variável            | Apps                    | Obrigatória                                         |
| ------------------- | ----------------------- | --------------------------------------------------- |
| `SHOPEE_APP_ID`     | converters, api, worker | Para Shopee                                         |
| `SHOPEE_SECRET`     | converters, api, worker | Para Shopee                                         |
| `ML_CLIENT_ID`      | converters, api, worker | Para ML OAuth                                       |
| `ML_CLIENT_SECRET`  | converters, api, worker | Para ML OAuth                                       |
| `API_PORT`          | api                     | Não (default 5442)                                  |
| `EVOLUTION_API_KEY` | api, worker             | Para Evolution API                                  |
| `POSTGRES_URL`      | api, worker             | URI do PostgreSQL                                   |
| `FRONTEND_URL`      | api                     | Não (default http://localhost:5441)                 |
| `ML_REDIRECT_URI`   | api                     | Não (default http://localhost:5442/api/ml/callback) |

---

## 📦 Store de Afiliados

Armazenamento no PostgreSQL (tabela `omestre.ml_affiliates`):

```typescript
interface MlAffiliateRecord {
  id: number;
  mlUserId: string;
  nickname: string;
  accessToken: string; // OAuth token
  refreshToken: string;
  expiresAt: Date;
  connectedAt: Date;
  lastUsedAt: Date;
  meliid?: string; // URL param (formato antigo)
  melitat?: string; // Etiqueta do afiliado
  sessionCookies?: string; // Cookies de sessão ML (para link curto)
}
```

---

## 📚 Documentação de Terceiros

| Documento                   | Link                                              |
| --------------------------- | ------------------------------------------------- |
| Shopee Afiliados API        | `docs/marketplaces/shopee/api-reference.md`       |
| Mercado Livre Afiliados API | `docs/marketplaces/mercadolivre/api-reference.md` |
| Amazon Associates API       | `docs/marketplaces/amazon/api-reference.md`       |
| Evolution API               | `docs/evolution-api/api-reference.md`             |

---

## 🛠️ Stack

| Componente   | Tecnologia                                                       |
| ------------ | ---------------------------------------------------------------- |
| Runtime      | Bun 1.3+                                                         |
| Monorepo     | Bun Workspaces                                                   |
| API          | Elysia 1.x                                                       |
| Web          | React 19, Vite 6                                                 |
| Worker       | Bun runtime nativo                                               |
| Database ORM | Drizzle ORM + postgres driver                                    |
| Database     | PostgreSQL 17                                                    |
| Cache        | Redis 7                                                          |
| WhatsApp     | Evolution API (Baileys)                                          |
| Conversão    | @omestre/converters (Shopee GraphQL, ML link curto + URL params) |
| Extensão     | Chrome Cookie Importer (Manifest V3)                             |
| Linguagem    | TypeScript 5 (strict mode)                                       |
| CLI          | Bun scripts                                                      |
