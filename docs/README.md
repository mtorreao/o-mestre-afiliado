# 📐 O Mestre Afiliado — Arquitetura Geral

> **Monorepo** com 3 apps, 3 pacotes compartilhados e 1 extensão Chrome, gerenciado por workspaces do Bun.

---

## 🗂️ Índice da Documentação

| Pasta                                             | Conteúdo                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/README.md`](./README.md)                   | Este arquivo — arquitetura geral, stack, variáveis de ambiente.                                                                                                          |
| [`docs/roadmap.md`](./roadmap.md)                 | Roadmap operacional: **topo = entregue** (com link para spec) + **final = planejado por impacto** (maior → menor).                                                       |
| [`docs/specs/`](./specs/)                         | **Specs do que já foi implementado.** Fonte da verdade do que está no código hoje. Critério de aceite e decisões ficam registrados.                                      |
| [`docs/plans/`](./plans/)                         | Planos de features ainda não iniciadas: `feature-flags`, `historico-precos`, `magalu`, `melhorias-ml`.                                                                   |
| [`docs/investigacoes/`](./investigacoes/)         | _(removido em 2026-07-28 — migrado para `docs/lessons-learned/`)_                                                                                                        |
| [`docs/lessons-learned.md`](./lessons-learned.md) | Índice de lições aprendidas (retrospectives). Cada entrada vira um arquivo em [`docs/lessons-learned/`](./lessons-learned/).                                             |
| [`docs/lessons-learned/`](./lessons-learned/)     | Lições aprendidas individuais (uma por arquivo). Caso inaugural: `2026-07-25-mirror-parou-de-entregar.md` (mirror bloqueado por commit com argumento técnico incorreto). |
| [`docs/marketplaces/`](./marketplaces/)           | Referências de API de terceiros (`mercadolivre`, `shopee`, `amazon`) + PDFs de cadastro ML.                                                                              |
| [`docs/evolution-api/`](./evolution-api/)         | Referência da Evolution API (WhatsApp).                                                                                                                                  |
| [`docs/known-issues.md`](./known-issues.md)       | Índice de testes E2E desativados temporariamente com `test.skip` + motivo e reativação.                                                                                  |

### Specs disponíveis (`docs/specs/`)

| Spec                                                                             | Resumo                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`arquitetura-worker.md`](./specs/arquitetura-worker.md)                         | Worker v2: 2 filas Redis (`omestre:mirror:raw`, `omestre:mirror:send`) + `apps/ingestor` + `apps/dispatcher` + `packages/worker-common`. Dedup webhook 30s, send-dedup 1h, send-completed 24h, fan-out 1:N.                                                                                                                                  |
| [`autenticacao-cadastro-afiliado.md`](./specs/autenticacao-cadastro-afiliado.md) | Tabela `users` + `user_credentials` + `user_id` em `ml_affiliates`. JWT via `@elysiajs/jwt`. Hook `useAuth` + Login/Register/Dashboard + `/api/affiliate/test-conversion` por usuário.                                                                                                                                                       |
| [`extensao-chrome-evolucao.md`](./specs/extensao-chrome-evolucao.md)             | Extensão Chrome: Fases 0 (segurança) + 1 (sync inteligente) implementadas. Service worker MV3, popup simplificado, validação da URL da API, sincronização via `validate-cookies`. Fases 2–5 continuam em [`docs/plans/`](./plans/).                                                                                                          |
| [`multi-worktree-dev-stack.md`](./specs/multi-worktree-dev-stack.md)             | `bun run dev` com identidade derivada da branch (slug DNS/Compose, portas determinísticas, lockdir, 3 modos de tunnel Cloudflare).                                                                                                                                                                                                           |
| [`testes-e2e-arquitetura-worker.md`](./specs/testes-e2e-arquitetura-worker.md)   | Suíte Playwright `mirror-pipeline.api.spec.ts` (P1–P9) + `worker-status.api.spec.ts` (W1–W7). Cobre pipeline end-to-end via Amazon, fan-out, dedup, fallback imagem→texto, mirror inativo.                                                                                                                                                   |
| [`template-mensagem.md`](./specs/template-mensagem.md)                           | Fases 1–4 entregues: `TemplateContext` + `buildTemplateContext` + `resolvePlaceholders`; `parseConditionalTemplate` (técnica + humanizada); `/api/affiliate/preview-template` + `/api/affiliate/validate-template`; `PlaceholderPicker`, `TemplateEditor`, `TemplatePreview` integrados em `MirrorFormPage`. Fase 5 (E2E dedicado) pendente. |
| [`worker-monitoring.md`](./specs/worker-monitoring.md)                           | `WorkerStatusPage` com 5 seções (Pipeline / Resumo / Ingestor / Dispatcher / DLQ). Filtros server-side, auto-refresh 30s, copiar JSON, badge pulsante. Endpoints `/api/worker/dlq*` com `total` + `totalFiltered`.                                                                                                                           |
| [`grupos-autocomplete.md`](./specs/grupos-autocomplete.md)                       | `MirrorFormPage` mostra foto do grupo no dropdown (`pictureUrl` da Evolution + `GroupAvatar` com fallback de inicial), `whatsapp:groups:v3:{user}` com TTL 86400s, botão "Atualizar grupos" no `PageHeader` que dispara `?force=true` em ambos os autocompletes. JID removido de ambos os dropdowns mas mantido nas tags de origem.          |

### Planos disponíveis

| Plano                                                           | Status                                                                      | Resumo                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/plans/magalu.md`](./plans/magalu.md)                     | Planejado (prioridade alta)                                                 | Marketplace 4 funcional (afiliado/tenant/conversor/E2E). Conversor já existe (`packages/converters/src/magalu{,-pure}.ts`); falta DB/API/UI/ingestor.                                                                                                                                                                             |
| [`docs/plans/feature-flags.md`](./plans/feature-flags.md)       | Fases 1–6 entregues (status misto) — Dívida D + Phase 1 fechados 2026-07-31 | Modo manutenção + kill switch do envio + kill switch do ingestor + tela admin. **✅ Bootstrap admin entregue** (`users.is_admin` migration `0019`, `ADMIN_EMAILS`, JWT com `isAdmin`). Restam Fase 5 (ingestor kill switch) e Fase 7 (E2E dedicado) → Phase 8. Detalhes do entregue no topo do [`docs/roadmap.md`](./roadmap.md). |
| [`docs/plans/historico-precos.md`](./plans/historico-precos.md) | Não iniciado                                                                | Persistência de ofertas + histórico de preço + UI admin. Worker isolado (Queue C `omestre:mirror:catalog`).                                                                                                                                                                                                                       |
| [`docs/plans/melhorias-ml.md`](./plans/melhorias-ml.md)         | Não iniciado                                                                | Renovação automática de cookies (`refreshSessionCookies` já existe), fallback inteligente, batch de URLs, mensagens descritivas, testes ML.                                                                                                                                                                                       |

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
