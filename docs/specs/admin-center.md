# Spec — Admin Center (admin-api + admin-web)

> **Status:** implementado (worktree `wt/admin-center`)
> **Stack:** Hono + Bun (API) · React 19 + Vite 6 (Web)
> **Última atualização:** 2026-08-04

## 1. Objetivo

Painel administrativo **single-user** do O Mestre Afiliado, usado por
Matheus (único admin) para operar o deploy em produção e receber
notificações. Nome genérico de propósito: **admin-center** — abre espaço
para futuras features administrativas (métricas, gestão de containers,
feature flags, etc.) além do deploy.

## 2. Arquitetura

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
                              │ Telegram: notificações           │
                              └─────────────────────────────────┘
```

- **admin-api** e **admin-web** são 2 apps separados no monorepo
  (`apps/admin-api`, `apps/admin-web`), seguindo o padrão `apps/api` +
  `apps/web` do projeto.
- Comunicação: admin-web (nginx) faz proxy reverso de `/api/*` →
  `admin-api:9090`.
- Exposição pública futura: `admin.omestreafiliado.com.br` via Cloudflare
  Tunnel → `127.0.0.1:9091` (admin-web).
- **Logs de deploy ficam no mesmo volume `oma_admin_state`** que o
  registry JSON (campo `logBody` no `DeployRecord`). Persiste entre
  restarts do container sem dependência externa.

## 3. Admin-API (Hono + Bun)

### 3.1 Stack e justificativa

| Escolha                               | Justificativa                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hono** (não Elysia)                 | Portabilidade futura p/ Cloudflare Workers (mesmo código `app.fetch`); mais leve; sem dependência do catálogo Elysia.                                                    |
| **Bun.serve** (não @hono/node-server) | App roda no runtime Bun como os demais apps do monorepo.                                                                                                                 |
| **argon2id** (não scrypt)             | `Bun.password` nativo suporta `bcrypt`/`argon2*` — não tem scrypt. Argon2id é mais forte que bcrypt.                                                                     |
| **Ed25519** (não HMAC)                | Assinatura assimétrica: GitHub Action assina com privada (só no GitHub Secrets), API valida com pública (no .env). Sem segredo compartilhado na rede.                    |
| **Filesystem local** (não R2)         | Logs ficam em `logBody` no JSON local — mesmo volume Docker que persiste o registry. Sem dep externa (sem aws4fetch), sem token de R2, sem edge case de R2 indisponível. |

### 3.2 Variáveis de ambiente

Obrigatórias (falta → boot falha com erro claro):

| Var                       | Descrição                                                                 |
| ------------------------- | ------------------------------------------------------------------------- |
| `OMA_ADMIN_USER`          | Username único do admin                                                   |
| `OMA_ADMIN_PASSWORD_HASH` | Hash argon2id (gerar: `bun run --cwd apps/admin-api hash-password`)       |
| `OMA_DEPLOY_PUBLIC_KEY`   | Chave pública Ed25519 (base64 32 bytes)                                   |
| `OMA_DEPLOY_SCRIPT`       | Caminho do script de deploy no VPS (container: `/scripts/deploy-prod.sh`) |
| `TELEGRAM_BOT_TOKEN`      | Bot token do @BotFather                                                   |
| `TELEGRAM_CHAT_ID`        | Chat/grupo destino                                                        |

Opcionais: `ADMIN_API_PORT` (default 9090), `OMA_DEPLOY_STATE_DIR`
(default `/var/lib/oma`), `OMA_DEPLOY_TIMEOUT_MS` (default 600000),
`OMA_LOG_LEVEL`.

### 3.3 Endpoints

| Método | Rota                         | Auth    | Descrição                                            |
| ------ | ---------------------------- | ------- | ---------------------------------------------------- |
| GET    | `/health`                    | —       | Healthcheck (Docker)                                 |
| POST   | `/api/admin/auth/login`      | Basic   | Valida user+senha → devolve `{ token }` (sessão 12h) |
| POST   | `/api/admin/auth/logout`     | Bearer  | Invalida sessão                                      |
| GET    | `/api/admin/auth/me`         | Bearer  | Checa sessão                                         |
| POST   | `/webhook/deploy`            | Ed25519 | Webhook do GitHub Action (assíncrono)                |
| GET    | `/api/admin/deploys`         | Bearer  | Lista histórico                                      |
| GET    | `/api/admin/deploys/:id`     | Bearer  | Detalhe de 1 deploy                                  |
| GET    | `/api/admin/deploys/:id/log` | Bearer  | Log do deploy (do `logBody` no registry)             |
| POST   | `/api/admin/deploys`         | Bearer  | Deploy manual (body `{ ref, sha? }`)                 |
| POST   | `/api/admin/test-telegram`   | Bearer  | Testa notificação                                    |

### 3.4 Fluxo do webhook de deploy

1. GitHub Action (tag `v*`) monta payload `{ ref, sha }`.
2. Assina `ed25519_sign(privKey, sha256(payload))` → header `X-Oma-Signature`.
3. Envia POST `/webhook/deploy` com headers `X-Oma-Ref`, `X-Oma-Sha`.
4. admin-api valida assinatura com `OMA_DEPLOY_PUBLIC_KEY` (WebCrypto).
5. Cria registro `running` → responde `202 { deployId }` imediatamente.
6. Background: roda `OMA_DEPLOY_SCRIPT` com timeout, captura stdout/stderr.
7. Atualiza registro com `logBody` (stdout + stderr) + status final.
8. Notifica Telegram (🚀 iniciado / ✅ sucesso / ❌ falha / ⏱️ timeout).

### 3.5 Estrutura de arquivos

```
apps/admin-api/
├── Dockerfile
├── package.json          # hono + @omestre/worker-common
├── tsconfig.json
└── src/
    ├── index.ts          # createApp() + Bun.serve (entrypoint)
    ├── config.ts         # loadConfig (valida env) + makeLogger
    ├── auth.ts           # argon2id, sessões, middlewares Hono
    ├── verify-ed25519.ts # validação de assinatura (WebCrypto)
    ├── notify/telegram.ts  # reusa buildTelegram* de worker-common
    ├── deploy/runner.ts  # spawn do script com timeout
    ├── deploy/registry.ts# histórico JSON local (top 100, com logBody)
    ├── routes/auth.ts    # login/logout/me
    ├── routes/webhook.ts # webhook do GitHub Action
    ├── routes/admin.ts   # deploys CRUD + test-telegram
    └── scripts/hash-password.ts
```

## 4. Admin-Web (React + Vite)

### 4.1 Stack

- React 19 + Vite 6 + react-router-dom 7 (mesma base do `apps/web`).
- **Sem Tailwind** — CSS vars dark-first em `src/styles.css` (filosofia do
  projeto).
- Sem Radix por enquanto (painel simples); pode adicionar quando crescer.

### 4.2 Rotas

| Rota           | Página           | Descrição                                                        |
| -------------- | ---------------- | ---------------------------------------------------------------- |
| `/login`       | LoginPage        | Form user+senha → Basic → token (localStorage `oma_admin_token`) |
| `/`            | DashboardPage    | Deploy manual + histórico + test-telegram + logout               |
| `/deploys/:id` | DeployDetailPage | Log do deploy (auto-refresh 10s)                                 |

Guards: `App.tsx` checa sessão (`/api/admin/auth/me`) no boot. Guard
controlado via callback `onAuthChange` (passado pro LoginPage e
DashboardPage) — logout muda estado imediatamente sem reload.

### 4.3 Proxy dev

`vite.config.ts` porta 9091, proxy `/api` → `http://localhost:9090`.

## 5. Integração Docker (docker-compose.dev.yml)

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

## 6. Segurança

- **Single-user**: sem cadastro, sem recuperação. Senha definida 1x no
  setup via `hash-password.ts`. Esqueceu? Gera novo hash e atualiza `.env`.
- **Sessões em memória** (12h TTL) — aceitável single-user; restart do
  container derruba sessões (refazer login).
- **Webhook**: assinatura Ed25519; payload com timestamp anti-replay pode
  ser adicionado depois (hoje confia em HTTPS + chave).
- **Recomendado em prod**: Cloudflare Access (email OTP) na frente de
  `admin.omestreafiliado.com.br` como segunda camada.

## 7. Testes

Fluxo validado manualmente (E2E via Docker):

- [x] `GET /health` → 200
- [x] Login correto → token; senha errada → 401
- [x] Rota protegida sem token → 401
- [x] Webhook com assinatura inválida → 401
- [x] Deploy manual: POST → `running` → `success`/`failed` → registro com
      `logBody` completo + summary
- [x] Log lido direto do `logBody` (sem R2)
- [x] admin-web: login via proxy → dashboard → histórico vazio
- [x] SPA fallback (`/deploys/:id` direto serve index.html)
- [x] Logs estruturados JSON no stdout do container
- [x] Persistência cross-restart (volume `oma_admin_state`)
- [x] Build estático de prod servido pelo nginx do container
- [x] Logout redireciona pro login imediatamente (callback `onAuthChange`)

Unit tests: 38 (ed25519, auth, config, registry) — todos passando.

## 8. Próximos passos

1. Gerar par de chaves Ed25519 e colocar pública no `.env` (setup VPS).
2. Criar `scripts/deploy-prod.sh` (fase deploy do plano) e montar no
   container `/scripts`.
3. Configurar bot do Telegram real.
4. GitHub Action `.github/workflows/deploy.yml` com assinatura Ed25519.
5. Tunnel: adicionar `admin.omestreafiliado.com.br` ao config do tunnel.
