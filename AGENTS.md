# AGENTS.md — O Mestre Afiliado

Guia definitivo para agentes LLM trabalhando neste repositório.

---

## 🏗️ Estrutura do Projeto

Monorepo Bun Workspaces com 3 apps (`apps/`), 3 pacotes compartilhados (`packages/`) e uma extensão Chrome:

```
o-mestre-afiliado/
├── apps/
│   ├── api/          # Elysia REST API (:5442)
│   ├── worker/       # Background worker (pipeline de espelhamento via Redis Stream)
│   └── web/          # React 19 + Vite 6 (:5441)
├── packages/
│   ├── shared/       # Tipos e utils (@omestre/shared)
│   ├── converters/   # Lógica de conversão (@omestre/converters)
│   └── db/           # Schema Drizzle + conexão PG (@omestre/db)
├── extensions/
│   └── chrome-cookie-importer/  # Extensão Chrome para importar cookies de sessão ML
├── assets/
│   └── logos/        # Logos do projeto
├── docs/             # Documentação de arquitetura
├── scripts/          # Scripts auxiliares (dev.ts)
├── deploy/           # Config de deploy (cloudflared, etc.)
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

| Componente      | Tecnologia                                                       |
| --------------- | ---------------------------------------------------------------- |
| Runtime         | Bun 1.3+                                                         |
| Monorepo        | Bun Workspaces                                                   |
| API             | Elysia 1.x                                                       |
| Web             | React 19, Vite 6                                                 |
| Worker          | Bun runtime nativo (Redis Stream + pipeline de espelhamento)     |
| Database ORM    | Drizzle ORM                                                      |
| Database        | PostgreSQL 17                                                    |
| Cache           | Redis 7                                                          |
| WhatsApp        | Evolution API (Baileys)                                          |
| Conversão       | @omestre/converters (Shopee GraphQL, ML URL params / link curto) |
| Extensão Chrome | Cookie Importer (Manifest V3)                                    |
| TypeScript      | ^5, strict mode, verbatimModuleSyntax                            |
| Package manager | Bun (bun install, bun add)                                       |

---

## 📐 TypeScript — Regras Essenciais

1. **`verbatimModuleSyntax: true`** — use `import type` para importações que são apenas tipo:

   ```typescript
   import type { ConversionResult } from '@omestre/shared'; // ✅
   import { convertUrl } from '@omestre/converters'; // ✅ valor
   ```

2. **`noUncheckedIndexedAccess: true`** — array access retorna `T | undefined`:

   ```typescript
   const first = arr[0]; // tipo: T | undefined
   if (first) {
     /* narrow */
   }
   ```

3. **`allowImportingTsExtensions: true`** — imports de `.ts` local:

   ```typescript
   import { shopee } from './shopee.ts'; // ✅ obrigatório
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
- Store de afiliados em PostgreSQL via Drizzle (`@omestre/db` + `MlAffiliateRepository`).

### Worker

- Pipeline de espelhamento via Redis Stream com consumer group e ACK explícito.
- Modo: `mirror` (default) — lê do Redis Stream continuamente.
- Modos auxiliares: `--revalidate` (uma rodada) e `--revalidate-daemon` (daemon periódico).
- Logs em JSON estruturado no stdout.
- Graceful shutdown via SIGINT/SIGTERM.

### Web (React)

- **React Router** (`react-router-dom`) com rotas `/`, `/espelhamentos`, `/configuracoes`, `/logs`, `/worker-status`.
- `App.tsx` define `ProtectedRoute` / `GuestRoute` e o layout (sidebar + topbar).
- Páginas em `apps/web/src/pages/` (ex: `WorkerStatusPage.tsx`).
- Proxy Vite em `/api` para API local em `:5442`.
- Design system em `apps/web/src/components/ui/` (Card, Badge, Button, Loading, Switch, Select...). **Usar CSS vars do design system, nunca cores hardcoded.**
- Estilo inline ou CSS modules — sem Tailwind.
- Estado de autenticação em `apps/web/src/hooks/useAuth.ts` (token em `localStorage` sob a chave `omestre_auth_token`).

### Converters

- Funções de conversão **nunca lançam exceções** — sempre retornam `ConversionResult` com `success`.
- Erros de credenciais são tratados como `success: false`, não throw.
- ML: duas estratégias — `short link (API interna) → URL params (fallback)`.

### ML Link Builder (ml-linkbuilder.ts)

- Função `generateShortAffiliateLink()` para gerar links curtos `meli.la`.
- Requer cookies de sessão completos (incluindo HttpOnly).
- Fluxo: GET no linkbuilder → extrai CSRF de `<meta>` → POST `/affiliate-program/api/v2/affiliates/createLink`.
- Endpoint interno do ML, **não documentado** publicamente.
- Cookies expirados → fallback automático para URL params.

### Extensão Chrome

- `extensions/chrome-cookie-importer/` — Manifest V3.
- Usa `chrome.cookies.getAll()` para ler cookies HttpOnly do ML.
- Envia cookies via `PUT /api/ml/affiliates/:mlUserId` para o store.

### Shared

- Tipos e constantes apenas — sem lógica de runtime além de `detectMarketplace`.

---

## 🪝 Git Hooks

Todos os hooks ficam versionados em `.githooks/` e são ativados via
`git config core.hooksPath .githooks`.

### Setup (uma vez após clonar)

```bash
bun run setup:hooks
```

Torna os hooks executáveis e configura o Git para usá-los.

### Hooks ativos

| Hook         | Quando               | O que faz                                                                           |
| ------------ | -------------------- | ----------------------------------------------------------------------------------- |
| `pre-commit` | Antes de cada commit | Roda prettier --check, lint-notifier e typecheck (só dos apps/packages modificados) |
| `commit-msg` | Antes de cada commit | Valida mensagem contra conventional commits                                         |
| `pre-push`   | Antes de cada push   | Roda typecheck completo + build                                                     |

### Conventional commits

Formato: `<type>(<scope>): <subject>`

Tipos permitidos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Exemplos válidos:

```
feat(api): adicionar endpoint /api/affiliate/profile
fix(web): corrigir layout do MirrorFormPage em mobile
chore(deps): atualizar bun para 1.3.5
docs(agents): documentar hook de pre-push
```

### Bypass de emergência

```bash
git commit --no-verify -m "hotfix crítico"   # pula pre-commit + commit-msg
git push --no-verify                          # pula pre-push
```

Use apenas em emergências — os guards existem para evitar pushes quebrados.

### Em CI (GitHub Actions)

Os mesmos guards rodam em `.github/workflows/ci.yml` (typecheck + build + prettier no diff do PR). Commits com `--no-verify` ainda passam pelo CI.

---

## 🧪 Comandos

| Comando                                                                  | Descrição                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `bun install`                                                            | Instala tudo (workspaces)                                                                                     |
| `bun run dev`                                                            | Sobe `docker-compose.dev.yml` isolado pela branch atual (containers, rede, volumes, portas e tunnel próprios) |
| `bun run scripts/dev.ts --dry-run`                                       | Exibe slug, Compose project, hostname e portas sem alterar o ambiente                                         |
| `SKIP_TUNNEL=1 bun run dev`                                              | Sobe a stack da branch sem Cloudflare Tunnel                                                                  |
| `DEV_BUILD=0 bun run dev`                                                | Reutiliza as imagens Docker já construídas                                                                    |
| `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... bun run dev`            | Cria/atualiza o CNAME da branch via API da zona correta; o token precisa de `Zone / DNS / Edit`               |
| `bun run shopee <url>`                                                   | CLI conversor Shopee                                                                                          |
| `bun run ml <url>`                                                       | CLI conversor Mercado Livre                                                                                   |
| `bun run build`                                                          | Compila todos os apps (api + worker + web)                                                                    |
| `bun run typecheck`                                                      | Typecheck de todos os subprojetos (via `scripts/typecheck-all.ts`)                                            |
| `bun run typecheck:root`                                                 | Typecheck só dos arquivos de tooling (scripts/, e2e/, deploy/)                                                |
| `bun run db:generate`                                                    | Gerar migrations Drizzle                                                                                      |
| `bun run db:migrate`                                                     | Aplicar migrations                                                                                            |
| `bun run db:push`                                                        | Push rápido (dev)                                                                                             |
| `docker compose --env-file .env.infra -f docker-compose.infra.yml up -d` | Subir infra (Evolution + PG + Redis)                                                                          |

---

## 🔐 Variáveis de Ambiente

Arquivo `.env` na raiz, carregado automaticamente pelo Bun.

| Variável                | Obrigatória                                         | Apps                       |
| ----------------------- | --------------------------------------------------- | -------------------------- |
| `SHOPEE_APP_ID`         | Para Shopee                                         | converters, api, worker    |
| `SHOPEE_SECRET`         | Para Shopee                                         | converters, api, worker    |
| `ML_CLIENT_ID`          | Para ML OAuth                                       | converters, api, worker    |
| `ML_CLIENT_SECRET`      | Para ML OAuth                                       | converters, api, worker    |
| `ML_REFRESH_TOKEN`      | Para ML OAuth                                       | converters, api, worker    |
| `API_PORT`              | Não (default 5442)                                  | api                        |
| `EVOLUTION_API_KEY`     | Sim                                                 | api, worker                |
| `EVOLUTION_WEBHOOK_URL` | Não                                                 | api                        |
| `POSTGRES_URL`          | Não                                                 | api, worker (URI completa) |
| `POSTGRES_HOST`         | Não (default localhost)                             | api, worker                |
| `POSTGRES_PORT`         | Não (default 5443)                                  | api, worker                |
| `POSTGRES_DATABASE`     | Não (default omestre_db)                            | api, worker                |
| `POSTGRES_USERNAME`     | Não (default evolution)                             | api, worker                |
| `POSTGRES_PASSWORD`     | Sim                                                 | api, worker                |
| `POSTGRES_SCHEMA`       | Não (default omestre)                               | api, worker                |
| `FRONTEND_URL`          | Não (default http://localhost:5441)                 | api                        |
| `ML_REDIRECT_URI`       | Não (default http://localhost:5442/api/ml/callback) | api                        |

---

## 🗺️ Fluxo de Dados — Mercado Livre

```
Usuário (Web)
    │
    │ POST /api/ml/convert { url, mlUserId }
    ▼
┌─────────────────────────────────────────────────┐
│ apps/api/src/index.ts                           │
│                                                  │
│  1. Busca afiliado no banco (ml_affiliates)    │
│  2. Tem sessionCookies?                          │
│     ├── SIM → generateShortAffiliateLink()       │
│     │         GET linkbuilder → CSRF            │
│     │         POST createLink → meli.la/xxx     │
│     │                                            │
│     └── NÃO → generateViaUrlParams()            │
│               URL + ?matt_word= / ?meliid=...   │
└─────────────────────────────────────────────────┘
    │
    ▼
Usuário recebe link de afiliado

── Extensão Chrome ──────────────────────────────
chrome.cookies.getAll({ domain: '.mercadolivre' })
    → PUT /api/ml/affiliates/:mlUserId
    → store.sessionCookies
```

### Store de afiliados (PostgreSQL — tabela `ml_affiliates`)

```sql
CREATE TABLE omestre.ml_affiliates (
  id SERIAL PRIMARY KEY,
  ml_user_id TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  access_token TEXT NOT NULL,        -- OAuth token
  refresh_token TEXT NOT NULL,       -- OAuth refresh
  expires_at TIMESTAMP NOT NULL,     -- expiração do access token
  connected_at TIMESTAMP NOT NULL,
  last_used_at TIMESTAMP NOT NULL,
  meliid TEXT,                       -- URL param (formato antigo)
  melitat TEXT,                      -- etiqueta do afiliado
  session_cookies TEXT,              -- cookies de sessão ML (para link curto)
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

Acesso via `MlAffiliateRepository` em `packages/db/src/repository/mlAffiliates.repository.ts`.  
Repositório expõe métodos: `findAll()`, `findByUserId()`, `upsert()`, `patch()`, `refreshTokens()`, `touch()`, `delete()`.

> Dados são lidos/escritos exclusivamente via PostgreSQL.

### Formatos de link gerados

| Formato           | Parâmetros                | Exemplo                                     |
| ----------------- | ------------------------- | ------------------------------------------- |
| Link curto        | API interna ML            | `https://meli.la/2DSBbLg`                   |
| Novo (mtorreao)   | `matt_word` + `matt_tool` | `...?matt_word=mtorreao&matt_tool=71835809` |
| Antigo (om895584) | `meliid` + `melitat`      | `...?meliid=...&melitat=om895584`           |

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

7. **API do Link Builder não é documentada** — endpoint `/affiliate-program/api/v2/affiliates/createLink` é interno do ML, descoberto via F12. Pode mudar sem aviso.

8. **Cookies de sessão expiram** — a cada login no ML, precisam ser reimportados via extensão.

9. **NUNCA usar `convertUrl()` como fallback em fluxo multi-afiliado** — `convertUrl()` lê credenciais do `.env`, que pertencem a um afiliado específico. Isso resultaria em link com conta errada.

10. **Subir extensão Chrome** — após alterar arquivos da extensão, recarregar em `chrome://extensions/`.

11. **Link curto vs URL params** — link curto (`meli.la`) é preferível mas requer cookies de sessão. URL params funcionam sempre, independente de login.

---

## 📊 Worker Monitoring

Tela web de **saúde e performance** dos workers de espelhamento, em
`apps/web/src/pages/WorkerStatusPage.tsx` (rota `/worker-status`, protegida).

### Estrutura da página (5 seções)

1. **🔗 Pipeline** — visualização do fluxo `Queue A → Ingestor → Queue B → Dispatcher → Evolution` com XLEN das filas Redis.
2. **📊 Resumo de Saúde** — grid com Uptime, Modo, Queue size, DLQ count e erros distintos de cada worker.
3. **📥 Ingestor** — Recebidas, Bloqueadas (breakdown por `reason`), Publicadas, latência por etapa, últimos erros.
4. **📤 Dispatcher** — Enviadas (por `marketplace`), Descartadas (por `reason`), Falhas (por `type`), latência por etapa, últimos erros.
5. **🗑️ DLQ** — destaque, com expansão inline por item (body original, fila/etapa de falha, link "Ver espelhamento") e gestão (re-enfileirar / remover / limpar).

### Backend (API)

Endpoints em `apps/api/src/index.ts`:

| Método | Rota                            | Descrição                                                               |
| ------ | ------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/worker/status`            | Status agregado (Ingestor + Dispatcher) — `getAggregatedWorkerStatus()` |
| GET    | `/api/worker/dlq`               | Lista DLQ com filtros server-side                                       |
| POST   | `/api/worker/dlq/requeue?id=ID` | Re-enfileira item (Queue A ou B conforme origem)                        |
| POST   | `/api/worker/dlq/remove?id=ID`  | Remove item da DLQ                                                      |
| POST   | `/api/worker/dlq/purge`         | Remove todos os itens da DLQ                                            |

**`GET /api/worker/dlq`** aceita query params: `offset`, `limit`, `queue` (`A`/`B`),
`reason` (failureReason exato) e `since` (ISO ou `Nh`/`Nd`). Responde com `total`
(zcard global da DLQ, usado no badge do header) e `totalFiltered` (após filtros).
A implementação está em `apps/api/src/services/worker-metrics.ts` (`listDlqItems`)
sobre `packages/worker-common/src/dead-letter-queue.ts` (`listDLQ`).

### Helpers de UI

- `apps/web/src/lib/worker-status.ts` — tipos (`WorkerStatus`, `DLQEntry`, `DLQListResponse`),
  dicionários PT-BR (`COUNTER_LABELS`, `STEP_LABELS`, `LABEL_LABELS`) e `getFailureMeta(reason)`
  (mapeia reason → fila/etapa de falha).
- `apps/web/src/lib/worker-counters.ts` — `parseCounterKey`, `sumByName`, `aggregateByLabel`,
  `rankedByLabel` para agregar counters Prometheus por label.

### Convenções da página

- **Auto-refresh:** header com switch "Auto" (poll global). A seção DLQ tem switch "Auto"
  próprio de 30s, independente do global.
- **Indicador de frescor:** dot verde/amarelo/vermelho conforme idade do último dado.
- **Badge pulsante:** quando `total` da DLQ cresce entre polls, o badge do header pulsa
  (keyframe `.dlq-badge-bump` em `apps/web/src/styles/globals.css`).
- **Copiar JSON:** botão "Copiar JSON" no body expandido copia o item completo
  (id + failureReason + failedAt + lastError + attempts + marketplace + originalUrl +
  conversionSuccess + reprocessed + event) via Clipboard API com fallback `<textarea>`+`execCommand`.
- **PT-BR obrigatório** em todos os labels.

---

## 🧠 Padrões de Design

### Error handling

**Converters:** nunca lançam — retornam `ConversionResult` com `success: false`.
**API:** captura erros inesperados no handler e retorna HTTP 200 com `success: false`.
**Worker:** pipeline de espelhamento com retry e Dead Letter Queue.

### Logging

- **Worker:** logs em JSON (`console.log(JSON.stringify(entry))`).
- **API:** logs nativos do Elysia (stdout).
- **CLI:** output formatado com emojis e bordas (`╔═══╗`).
