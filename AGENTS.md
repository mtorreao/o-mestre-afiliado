# AGENTS.md — O Mestre Afiliado

Guia definitivo para agentes LLM trabalhando neste repositório.

---

## 🏗️ Estrutura do Projeto

Monorepo Bun Workspaces com 3 apps (`apps/`) e 3 pacotes compartilhados (`packages/`):

```
o-mestre-afiliado/
├── apps/
│   ├── api/          # Elysia REST API (:3000) + webhook Evolution
│   ├── worker/       # Background worker (fila + polling + pipeline)
│   └── web/          # React 19 + Vite 6 (:5173)
├── packages/
│   ├── shared/       # Tipos e utils (@omestre/shared)
│   ├── converters/   # Lógica de conversão (@omestre/converters)
│   └── db/           # Schema Drizzle + conexão PG (@omestre/db)
├── docs/             # Documentação de arquitetura
├── package.json      # Workspace raiz
├── tsconfig.json     # Base compartilhada
├── .env.example      # Template de variáveis
├── .env.infra        # Variáveis da infra Docker
└── docker-compose.infra.yml  # Evolution API, PG, Redis
```

### Workspaces

```json
"workspaces": ["apps/*", "packages/*"]
```

**Todo workspace é dependência do workspace raiz** — `bun install` na raiz instala tudo.
**Dependências entre workspaces** usam `"workspace:*"`.

```
@omestre/shared  ←  @omestre/converters  ←  apps/api
                                          ←  apps/worker
@omestre/db      ←  apps/api
                 ←  apps/worker
```

---

## 🔧 Stack

| Componente | Tecnologia |
|------------|------------|
| Runtime | Bun 1.3+ |
| Monorepo | Bun Workspaces |
| API | Elysia 1.x |
| Web | React 19, Vite 6 |
| Worker | Bun runtime nativo (setInterval + fila em memória) |
| Database ORM | Drizzle ORM |
| Database | PostgreSQL 17 |
| Cache | Redis 7 |
| WhatsApp | Evolution API (Baileys) |
| Conversão | @omestre/converters (Shopee GraphQL, ML OAuth/Cookies/Fallback) |
| TypeScript | ^5, strict mode, verbatimModuleSyntax |
| Package manager | Bun (bun install, bun add) |

---

## 📐 TypeScript — Regras Essenciais

1. **`verbatimModuleSyntax: true`** — use `import type` para importações que são apenas tipo:
   ```typescript
   import type { ConversionResult } from '@omestre/shared';  // ✅
   import { convertUrl } from '@omestre/converters';          // ✅ valor
   ```

2. **`noUncheckedIndexedAccess: true`** — array access retorna `T | undefined`:
   ```typescript
   const first = arr[0]; // tipo: T | undefined
   if (first) { /* narrow */ }
   ```

3. **`allowImportingTsExtensions: true`** — imports de `.ts` local:
   ```typescript
   import { shopee } from './shopee.ts';  // ✅ obrigatório
   ```

4. **`noEmit: true`** — Bun executa TS diretamente, sem compilação.

5. **`noImplicitOverride: true`** — use `override` em métodos sobrescritos.

6. **Lib**: `["ESNext", "DOM", "DOM.Iterable"]` — DOM incluso para o web app, inócuo para API/worker.

---

## 📦 Convenções de Código

### API (Elysia)

- Nunca retorne HTTP 5xx para erros de negócio — sempre HTTP 200 com `success: false`.
- Rotas em `/api/convert` seguem o padrão REST.
- Use `@elysiajs/cors` e `@elysiajs/swagger` como plugins.

### Worker

- Fila em memória (`queue: QueueItem[]`) — não há persistência.
- 3 modos: `poll` (default), `batch` (--batch), `once` (--once).
- Logs em JSON estruturado no stdout.
- Graceful shutdown via SIGINT/SIGTERM.

### Web (React)

- Componente único `App.tsx` com estado local (useState).
- Proxy Vite em `/api` para API local em `:3000`.
- Sem roteador (SPA de página única).
- Estilo inline (sem CSS modules ou Tailwind).

### Converters

- Funções de conversão **nunca lançam exceções** — sempre retornam `ConversionResult` com `success`.
- Erros de credenciais são tratados como `success: false`, não throw.
- Duas estratégias para ML: `api → cookies`.

### Shared

- Tipos e constantes apenas — sem lógica de runtime além de `detectMarketplace`.

---

## 🧪 Comandos

| Comando | Descrição |
|---------|-----------|
| `bun install` | Instala tudo (workspaces) |
| `bun run dev` | Sobe todos os apps em paralelo |
| `bun run dev:api` | API em hot-reload (`--hot`) |
| `bun run dev:worker` | Worker em hot-reload |
| `bun run dev:web` | Web (Vite dev server) |
| `bun run shopee <url>` | CLI conversor Shopee |
| `bun run ml <url>` | CLI conversor Mercado Livre |
| `./node_modules/.bin/tsc --noEmit` | Typecheck completo |
| `bun run db:generate` | Gerar migrations Drizzle |
| `bun run db:migrate` | Aplicar migrations |
| `bun run db:push` | Push rápido (dev) |
| `docker compose --env-file .env.infra -f docker-compose.infra.yml up -d` | Subir infra (Evolution + PG + Redis) |

---

## 🔐 Variáveis de Ambiente

Arquivo `.env` na raiz, carregado automaticamente pelo Bun.

| Variável | Obrigatória | Apps |
|----------|-------------|------|
| `SHOPEE_APP_ID` | Para Shopee | converters, api, worker |
| `SHOPEE_SECRET` | Para Shopee | converters, api, worker |
| `ML_CLIENT_ID` | Para ML OAuth | converters, api, worker |
| `ML_CLIENT_SECRET` | Para ML OAuth | converters, api, worker |
| `ML_REFRESH_TOKEN` | Para ML OAuth | converters, api, worker |
| `ML_COOKIES` | Para ML Cookies | converters, api, worker |
| `API_PORT` | Não (default 3000) | api |
| `WORKER_POLL_INTERVAL` | Não (default 30000) | worker |
| `WORKER_MAX_RETRIES` | Não (default 3) | worker |
| `WORKER_CONCURRENCY` | Não (default 5) | worker |
| `EVOLUTION_API_KEY` | Sim | api, worker |
| `EVOLUTION_WEBHOOK_URL` | Não | api (default http://api:3000/webhook/message) |
| `POSTGRES_URL` | Não | api, worker (URI completa, sobrescreve vars abaixo) |
| `POSTGRES_HOST` | Não (default localhost) | api, worker |
| `POSTGRES_PORT` | Não (default 5443) | api, worker |
| `POSTGRES_DATABASE` | Não (default evolution_db) | api, worker |
| `POSTGRES_USERNAME` | Não (default evolution) | api, worker |
| `POSTGRES_PASSWORD` | Sim | api, worker |
| `POSTGRES_SCHEMA` | Não (default omestre) | api, worker |

---

## ⚠️ Pitfalls

1. **`--hot` não monitora `packages/`** — bun --hot no apps/api só observa arquivos dentro de apps/api/. Se alterar packages/shared ou packages/converters, **precisa reiniciar** o app manualmente.

2. **`parseInt` com string** — o segundo argumento de `parseInt(str, radix)` deve ser **number**, não string: `parseInt('10', 10)` ✅, `parseInt('10', '10')` ❌.

3. **`Cookie` header pode ser `undefined`** — Bun/TypeScript rejeita `undefined` no objeto headers. Use `if (!cookies) return null` antes de montar o header.

4. **Workspace * não são instalados via npm** — usar `bun add @omestre/shared@workspace:*` (não `npm install`).

5. **Domínio DOM** — o root tsconfig inclui `"DOM"` e `"DOM.Iterable"` na lib. Isso permite `window.navigator.clipboard`, `document.getElementById`, etc. no web app, mas adiciona tipos DOM também nos apps API/worker (inócuo).

6. **`as` casts com optional chaining** — formato `(data as T)?.field as U` causa erro TS1128. Prefira variáveis intermediárias:
   ```typescript
   const node = data as Record<string, unknown> | undefined;
   const field = node?.field as string | undefined;
   ```

---

## 🗺️ Fluxo de Dados

```
Usuário (CLI)    Usuário (Web)          Usuário (API)
    │                │                       │
    │                │ POST /api/convert      │ POST /api/convert
    ▼                ▼                       ▼
┌──────────┐   ┌──────────┐           ┌──────────┐
│ cli-*.ts │   │ App.tsx  │  proxy    │ api/     │
│ (CLI)    │   │ (React)  │ ──:3000──►│ (Elysia) │
└────┬─────┘   └──────────┘           └────┬─────┘
     │                                     │
     └──────────────┬──────────────────────┘
                    ▼
          ┌──────────────────┐
          │ @omestre/        │
          │ converters       │
          │ convertUrl()     │
          ├──────────────────┤
          │ Shopee: GraphQL  │
          │ ML: OAuth/Cookies │
          └──────────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │ @omestre/shared  │
          │ detectMarketplace│
          │ ConversionResult │
          └──────────────────┘
```

---

## 🧠 Padrões de Design

### Error handling

**Converters:** nunca lançam — retornam `ConversionResult` com `success: false`.
**API:** captura erros inesperados no handler e retorna HTTP 200 com `success: false`.
**Worker:** usa retry com limite (`MAX_RETRIES`) antes de marcar como falha permanente.

### Logging

- **Worker:** logs em JSON (`console.log(JSON.stringify(entry))`).
- **API:** logs nativos do Elysia (stdout).
- **CLI:** output formatado com emojis e bordas (`╔═══╗`).

### ADRs implícitas

| Decisão | Motivo |
|---------|--------|
| Fila em memória (não Redis/DB) | Projeto pequeno, sem necessidade de persistência |
| Estrutura plana no Web (sem router) | SPA de página única, sem navegação |
| Estilo inline no React | Evita dependências de CSS, mantém bundle pequeno |
| Workspace `*` em vez de semver | Todos os pacotes versionados juntos no monorepo |
