# Spec — Admin Center + Design System Compartilhado

> **Status:** implementado e validado (PRs #10 e #15)
> **Branch:** `wt/admin-center`
> **Stack:** Hono + Bun (API) · React 19 + Vite 6 (Web) · @omestre/ui (design system)
> **Última atualização:** 2026-08-04

---

## 1. Contexto da conversa (decisões que moldaram o projeto)

Esta spec documenta **o projeto** (admin-center + design system) e **o contexto das decisões** tomadas ao longo da investigação. Motivação original: o usuário queria entender o que precisaria para subir o app O Mestre Afiliado em produção na Cloudflare.

### 1.1 Linha do tempo das decisões

| Decisão                         | Escolha                                                  | Motivo                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Onde rodar produção**         | Contabo puro (VPS atual)                                 | Mais barato (R$30/mês), zero refactor, código pronto; Cloudflare puro exigiria reescrever Elysia→Hono e migrar Postgres→D1 (5-10 dias) sem ganho imediato. Cloudflare Workers descartado como infra principal. |
| **Frontend da API**             | Cloudflare Tunnel (não Caddy)                            | Simplicidade + ocultação do IP do VPS.                                                                                                                                                                         |
| **Cloudflare puro vs híbrido**  | Híbrido descartado; **Contabo puro**                     | Para o porte atual (projeto pessoal, <200 usuários), migrar para Workers/D1/DO/Queues custaria ~R$25/mês a mais + 5-10 dias de refactor sem desbloquear caso de uso novo.                                      |
| **D1 como banco**               | Investigado, descartado                                  | D1 é SQLite (não Postgres) — exigiria migrar `pgSchema('omestre')`, `pgEnum`, `jsonb` para TEXT/CHECK. Não justifica.                                                                                          |
| **Evolution API + SQLite**      | ❌ Impossível                                            | Evolution exige Postgres (Prisma provider `postgresql`) + Redis (ioredis TCP). D1/Durable Objects não substituem. Fica no Contabo.                                                                             |
| **Custo Cloudflare**            | Workers Paid $5/mês cobre quase tudo                     | D1 25B reads + 50M writes, DO 1M requests, Queues 1M ops, KV 10M reads, Hyperdrive ilimitado — inclusos nos $5. R2 pago à parte ($0.015/GB). Containers (Evolution) ~$7-12/mês.                                |
| **Estratégia de deploy**        | Webhook admin app (Ed25519)                              | GitHub Action assina com chave privada (só no Secrets); admin-api valida com pública (no .env). Sem segredo compartilhado na rede.                                                                             |
| **Nome do app admin**           | **admin-center** (genérico)                              | Abre espaço para futuras features administrativas além do deploy.                                                                                                                                              |
| **Framework da API admin**      | **Hono** (não Elysia)                                    | Portabilidade futura para Cloudflare Workers (mesmo `app.fetch`); mais leve.                                                                                                                                   |
| **Login do admin**              | Single-user, senha só (argon2id)                         | Uso pessoal; menor superfície de ataque; sem cadastro/recuperação.                                                                                                                                             |
| **Onde guardar logs de deploy** | **Filesystem local** (logBody no JSON) — **R2 removido** | Single-user, single-VPS: não há caso de uso para storage externo. Volume Docker `oma_admin_state` já persiste entre restarts. R2 adicionava complexidade (aws4fetch, tokens, edge cases) sem ganho.            |
| **Telegram**                    | Bot **@o_mestre_afiliado_bot**, one-way (só notificação) | Deploy iniciado/concluído/falha + teste manual. Sem comandos/webhook no bot por enquanto.                                                                                                                      |
| **Tunnel dev do admin**         | `admin-dev.omestreafiliado.com.br` → `localhost:9091`    | Reaproveita o tunnel `omestre-afiliado` (f1437a45) que já expõe `dev.omestreafiliado.com.br`.                                                                                                                  |
| **Design system**               | **Extrair `@omestre/ui`** (PR #15)                       | Web e admin-web usavam design systems paralelos (tokens divergentes, paletas invertidas, componentes duplicados). Unificar elimina duplicação e centraliza mudanças de tema.                                   |

### 1.2 Fatores que descartaram a Cloudflare como infra principal

1. **Workers não roda Bun/Elysia** — exige reescrever a API em Hono (ou Containers pagos).
2. **D1 é SQLite, não Postgres** — schema Drizzle atual (`pgSchema('omestre')`, `pgEnum`, `jsonb`) não porta diretamente.
3. **Evolution API exige Postgres + Redis reais** — D1/Durable Objects não substituem; manter no Contabo.
4. **Containers para Evolution 24/7** — custo fixo (~$7-12/mês com o cálculo correto de GiB-segundo; ~$54 se mal calculado).
5. **Custo marginal** — Contabo R$30/mês fixo vs ~$5-60/mês Cloudflare dependendo do cenário.

---

## 2. Admin Center — Arquitetura

```
┌──────────────────────────┐     ┌──────────────────────────┐
│  admin-web (React+Vite)  │ ──► │  admin-api (Hono+Bun)    │
│  :9091 via nginx         │ /api│  :9090 (Bun.serve)       │
│  login + dashboard + log │     │  auth · webhook          │
└──────────────────────────┘     │  deploy · telegram       │
                                 └────────────┬─────────────┘
                                              │
                              ┌───────────────┴────────────────┐
                              │ VPS: /scripts/deploy-prod.sh    │
                              │ Estado: /var/lib/oma/deployments.json │
                              │ Telegram: @o_mestre_afiliado_bot │
                              └────────────────────────────────┘
```

- **admin-api** e **admin-web** são 2 apps separados no monorepo (`apps/admin-api`, `apps/admin-web`).
- Comunicação: admin-web (nginx) faz proxy reverso de `/api/*` → `admin-api:9090`.
- Exposição dev: `admin-dev.omestreafiliado.com.br` via Cloudflare Tunnel → `localhost:9091`.
- Exposição prod (futura): `admin.omestreafiliado.com.br` via tunnel do VPS.

### 2.1 Admin-API (Hono + Bun)

| Aspecto           | Detalhe                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| **Runtime**       | Bun 1.3+, `Bun.serve` (sem node-server)                                                           |
| **Framework**     | Hono 4.x (portável para Workers)                                                                  |
| **Hash de senha** | `argon2id` via `Bun.password` (scrypt NÃO é suportado pelo Bun — corrigido na implementação)      |
| **Sessão**        | Token random 32 bytes hex, TTL 12h, em memória (aceitável single-user)                            |
| **Webhook**       | Ed25519 via WebCrypto: GitHub Action assina `sha256(payload)` com privada; API valida com pública |

#### Variáveis de ambiente (obrigatórias)

| Var                       | Descrição                                                               |
| ------------------------- | ----------------------------------------------------------------------- |
| `OMA_ADMIN_USER`          | Username único (ex: `admin`)                                            |
| `OMA_ADMIN_PASSWORD_HASH` | Hash argon2id (`bun run --cwd apps/admin-api hash-password -- "senha"`) |
| `OMA_DEPLOY_PUBLIC_KEY`   | Chave pública Ed25519 (base64 32 bytes)                                 |
| `OMA_DEPLOY_SCRIPT`       | Script de deploy no VPS (container: `/scripts/deploy-prod.sh`)          |
| `TELEGRAM_BOT_TOKEN`      | Token do @BotFather (ex: `8658689979:AAH...`)                           |
| `TELEGRAM_CHAT_ID`        | Chat destino (ex: `5697357434` = DM do Matheus)                         |

Opcionais: `ADMIN_API_PORT` (9090), `OMA_DEPLOY_STATE_DIR` (/var/lib/oma), `OMA_DEPLOY_TIMEOUT_MS` (600000), `OMA_LOG_LEVEL`.

#### Endpoints

| Método | Rota                         | Auth    | Descrição                                |
| ------ | ---------------------------- | ------- | ---------------------------------------- |
| GET    | `/health`                    | —       | Healthcheck Docker                       |
| POST   | `/api/admin/auth/login`      | Basic   | Valida user+senha → token                |
| POST   | `/api/admin/auth/logout`     | Bearer  | Invalida sessão                          |
| GET    | `/api/admin/auth/me`         | Bearer  | Checa sessão                             |
| POST   | `/webhook/deploy`            | Ed25519 | GitHub Action (assíncrono, responde 202) |
| GET    | `/api/admin/deploys`         | Bearer  | Lista histórico                          |
| GET    | `/api/admin/deploys/:id`     | Bearer  | Detalhe                                  |
| GET    | `/api/admin/deploys/:id/log` | Bearer  | Log (do `logBody` no registry)           |
| POST   | `/api/admin/deploys`         | Bearer  | Deploy manual                            |
| POST   | `/api/admin/test-telegram`   | Bearer  | Testa notificação                        |

#### Fluxo do webhook de deploy

1. GitHub Action (tag `v*`) monta payload `{ ref, sha }`, assina com Ed25519, envia headers `X-Oma-Signature`/`X-Oma-Ref`/`X-Oma-Sha`.
2. admin-api valida assinatura → cria registro `running` → responde `202 { deployId }` imediatamente.
3. Background: roda `OMA_DEPLOY_SCRIPT` com timeout (10min default), captura stdout/stderr.
4. Salva `logBody` completo no registry JSON (volume `oma_admin_state`) — **sem R2**.
5. Atualiza status (`success|failed|timeout`) + summary; notifica Telegram.

### 2.2 Admin-Web (React + Vite)

| Rota           | Página           | Descrição                                                             |
| -------------- | ---------------- | --------------------------------------------------------------------- |
| `/login`       | LoginPage        | Basic auth → token (localStorage `oma_admin_token`)                   |
| `/`            | DashboardPage    | Deploy manual + histórico (auto-refresh 15s) + test-telegram + logout |
| `/deploys/:id` | DeployDetailPage | Log viewer (auto-refresh 10s)                                         |

- Guard de sessão via callback `onAuthChange` no App.tsx (logout redireciona imediatamente — bug corrigido).
- Dark-first: `main.tsx` força `data-theme='dark'` no `<html>`.
- Usa componentes do `@omestre/ui` (Card, Button, Badge, Input).
- `admin-styles.css`: só layout específico do admin (tokens vêm do pacote).

---

## 3. Design System Compartilhado — `@omestre/ui`

### 3.1 Motivação (o problema que resolveu)

Antes do PR #15, os dois apps tinham design systems **paralelos e divergentes**:

| Aspecto     | apps/web                     | apps/admin-web (antes)              |
| ----------- | ---------------------------- | ----------------------------------- |
| Tokens      | `--color-*` (indigo #4f46e5) | `--bg`, `--primary` (âmbar #f59e0b) |
| Tema        | Light                        | Dark (invertido)                    |
| Componentes | 15 componentes React + Radix | Classes CSS puras inline            |
| Reuso       | —                            | Zero (imports inexistentes)         |

### 3.2 Estrutura do pacote

```
packages/ui/
├── package.json          # deps: radix, lucide-react, clsx, react
├── tsconfig.json
└── src/
    ├── index.ts          # barrel: componentes + hooks + toast-emitter
    ├── styles/
    │   ├── tokens.css    # design tokens (light + dark via [data-theme='dark'])
    │   └── globals.css   # reset + base + Radix styles (@import './tokens.css')
    ├── components/ui/    # 15 componentes (Badge, Button, Card, ...)
    ├── hooks/
    │   ├── useTheme.tsx  # ThemeProvider + useTheme (localStorage persistence)
    │   ├── useTheme-pure.ts  # lógica pura (testável)
    │   └── useMediaQuery.ts
    └── lib/
        └── toast-emitter.ts  # event-based toast dispatch (fora de hooks)
```

### 3.3 Consumo nos apps

```ts
// apps/web/src/main.tsx e apps/admin-web/src/main.tsx
import '@omestre/ui/globals.css';

// qualquer página
import { Card, Button, Badge, Input } from '@omestre/ui';
```

**Tema**: `data-theme='dark'` no `<html>` ativa dark mode (tokens.css). Web usa light (default) + ThemeToggle; admin-web força dark.

### 3.4 Pitfall resolvido: alias Vite para workspace packages

O Vite não resolve subpaths de CSS de workspace packages via `exports` map de forma confiável. A solução é o alias com **`$` (exact match)** no `vite.config.ts` de cada app:

```ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '@omestre/ui/globals.css': path.resolve(__dirname, '../../packages/ui/src/styles/globals.css'),
    '@omestre/ui/tokens.css': path.resolve(__dirname, '../../packages/ui/src/styles/tokens.css'),
    '@omestre/ui$': path.resolve(__dirname, '../../packages/ui/src/index.ts'),  // $ = exact match
  },
},
```

Sem o `$`, o alias `@omestre/ui` casa como prefixo e quebra `@omestre/ui/globals.css` → `index.ts/globals.css` (ENOENT).

### 3.5 Fix de contraste no design system (PR #15)

- Button primary usava `color:#fff` hardcoded → ilegível no dark (primária clara `#818cf8`).
- Novo token `--color-on-primary` (light: `#fff`, dark: `#0f172a`) + Button usa `var(--color-on-primary)`.
- Danger mantém `#fff` (vermelho `#dc2626` tem contraste bom nos 2 temas).

---

## 4. Integração com Cloudflare

### 4.1 Tunnel dev (admin-dev)

- Tunnel `omestre-afiliado` (UUID `f1437a45-faee-4b13-ba05-04a87bbecbae`) — já expõe `dev.omestreafiliado.com.br`.
- Config local Windows: `C:\Users\torre\.cloudflared\omestre-afiliado.yml` (fora do repo).
- Ingress adicionado: `admin-dev.omestreafiliado.com.br → http://localhost:9091`.
- Config de referência no repo: `deploy/cloudflared/config.yml` (`admin-dev → http://admin-web:9091` para quando o tunnel roda dentro do Docker).
- CNAME criado via `cloudflared tunnel route dns omestre-afiliado admin-dev.omestreafiliado.com.br`.
- ⚠️ Pitfall: quando o tunnel roda **nativo no Windows**, o ingress precisa ser `localhost:9091` (não `admin-web:9091` — nome Docker não resolve no host). Quando roda **no container Docker**, usa `admin-web:9091`.

### 4.2 Custos Cloudflare (pesquisados, para referência)

| Produto      | Custo                   | Nota                                                   |
| ------------ | ----------------------- | ------------------------------------------------------ |
| Workers Paid | $5/mês                  | Base; inclui D1, DO, Queues, KV, Hyperdrive, Logs      |
| D1           | ~$0-15/mês              | 25B reads + 50M writes inclusos; SQLite (não Postgres) |
| R2           | $0.015/GB-mês           | Egress grátis; removido do admin (log local)           |
| Hyperdrive   | $0 (Paid)               | Pool + cache de Postgres externo                       |
| Containers   | ~$7-12/mês (basic 24/7) | Para Evolution; cálculo correto em GiB-segundo         |
| Tunnel       | $0                      | Usado no dev                                           |

---

## 5. Integração com Telegram

### 5.1 Bot criado

- **Nome**: O Mestre Afiliado
- **Username**: `@o_mestre_afiliado_bot`
- **Bot ID**: `8658689979`
- **Chat ID do Matheus**: `5697357434` (DM, via `/start`)
- **Uso**: one-way (app → você). Sem comandos/webhook no bot por enquanto.

### 5.2 Fluxo de envio

```
admin-api → POST https://api.telegram.org/bot<TOKEN>/sendMessage
            { chat_id: "5697357434", text, parse_mode: "Markdown" }
```

- Reusa `buildTelegramApiUrl`/`buildTelegramPayload` do `@omestre/worker-common` (notifier-pure).
- Mensagens: 🚀 iniciado, ✅ sucesso, ❌ falha, ⏱️ timeout, teste manual.
- Logs estruturados JSON no stdout: `"msg":"notificação telegram enviada","chatId":"..."`.

### 5.3 Como descobrir o chat_id

1. Crie o bot no @BotFather (`/newbot`).
2. Abra o chat com o bot e envie `/start`.
3. `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` → procure `"chat":{"id":...}`.

---

## 6. Docker Compose (dev)

```yaml
admin-api:
  build: { context: ., dockerfile: apps/admin-api/Dockerfile }
  ports: ['127.0.0.1:9090:9090']
  env_file: .env
  environment:
    {
      ADMIN_API_PORT: 9090,
      OMA_DEPLOY_SCRIPT: /scripts/deploy-prod.sh,
      OMA_DEPLOY_STATE_DIR: /var/lib/oma,
    }
  volumes: [oma_admin_state:/var/lib/oma]
  healthcheck: fetch /health

admin-web:
  build: { context: ., dockerfile: apps/admin-web/Dockerfile }
  ports: ['127.0.0.1:9091:9091']
  depends_on: [admin-api healthy]
```

- Volume `oma_admin_state` persiste `deployments.json` (registros + `logBody`) entre restarts.
- Para rodar em dev: `docker compose -f docker-compose.dev.yml up -d admin-api admin-web`.
- Tunnel nativo: `cloudflared tunnel --config "C:\Users\torre\.cloudflared\omestre-afiliado.yml" run omestre-afiliado`.

---

## 7. Testes e Validação

### 7.1 Unit tests (admin-api)

38 testes: `verify-ed25519` (assinatura válida/adulterada/chave errada/formato inválido), `auth` (parseBasicAuth, safeEqual, sha256Hex, hash/verify argon2id, sessões), `config` (loadConfig valida env, defaults, freeze, logger), `registry` (create/update/get/list, persistência, top-100, arquivo corrompido).

### 7.2 Unit tests (packages/ui)

40 testes: useTheme (+pure), Toast (ToastEmitter + Provider), Input, coverage (render de todos os componentes).

### 7.3 E2E manual (via Docker + tunnel)

- [x] Login correto → token; senha errada → 401; sem token → 401
- [x] Webhook com assinatura inválida → 401
- [x] Deploy manual: POST → `running` → `success`/`failed` → registro com `logBody`
- [x] Log lido do `logBody` (sem R2)
- [x] Logout redireciona imediatamente (callback onAuthChange)
- [x] Persistência cross-restart (volume `oma_admin_state`)
- [x] Telegram real: `{"success":true,"sent":true}` + log `notificação telegram enviada`
- [x] Visual: web light + admin-web dark (contraste `--color-on-primary` validado)

### 7.4 Gates

- Typecheck: 14/14 subprojetos
- Unit tests: 2474 pass / 0 fail
- Build: web + admin-web + Docker build web

---

## 8. Próximos passos

1. **GitHub Action** `.github/workflows/deploy.yml` com assinatura Ed25519 (payload `{ref, sha}` + headers).
2. **`scripts/deploy-prod.sh`** real no VPS (fase deploy do plano) montado em `/scripts` do container.
3. **Prod**: tunnel do VPS com `admin.omestreafiliado.com.br` + Cloudflare Access (email OTP) como 2ª camada.
4. **Bot Telegram**: se quiser comandos (`/status`, `/deploy`) no futuro, implementar webhook + allowlist `from.id === 5697357434`.
5. **@omestre/ui**: quando crescer, considerar mover `components/layout/` (AppShell, DataPage, PageHeader) para o pacote — hoje ficam no web por serem específicos do app.

---

## 9. Referências

- PR #10: `feat(admin-center)` (mergeado) — apps/admin-api + apps/admin-web + spec inicial.
- PR #15: `refactor(ui)` — extração do `@omestre/ui` + migração dos 2 apps + fix contraste.
- `docs/plans/deploy-producao-vps.md` (worktree `wt/prod-deploy`) — plano de deploy em produção.
- `docs/plans/producao-cloudflare.md` — investigação Cloudflare (preços, D1, Hyperdrive, Containers).
- `docs/specs/arquitetura-worker.md` — pipeline de espelhamento (contexto do que o admin monitora).
