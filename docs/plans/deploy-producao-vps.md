# Plano: Deploy de Produção do O Mestre Afiliado no Contabo (via Cloudflare Tunnel)

> **Status:** Proposta inicial (2026-08-04). Aguarda aprovação do owner antes de virar worktrees + commits por fase.
> **Owner:** Matheus Torreão
> **Última atualização:** 2026-08-04 (rev 0.3.0 — app renomeado para `admin-center`, framework trocado pra Hono, single-user login)

## TL;DR

Subir o O Mestre Afiliado em produção num **único VPS Contabo Ubuntu 24.04** (`169.58.120.254`) usando Docker Compose + Cloudflare Tunnel. O deploy é disparado por **tag no GitHub** via webhook autenticado por **chave pública/privada Ed25519**. O webhook evolui para um **app admin (`admin-center`, em Hono)** com single-user login (scrypt), histórico de versões, rollback, métricas dos containers, logs e notificação via **Telegram bot**. Logs de deploy persistidos em **R2 (Cloudflare, free tier)**.

**Estado atual mapeado (2026-08-04, via SSH direto no VPS):**

| Item                            | Estado                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPS                             | Ubuntu 24.04.4 LTS, 6 vCPU, 11 GB RAM, **186 GB disco livre**                                                                                                   |
| Docker / Docker Compose         | ❌ **Não instalado** (precisa instalar)                                                                                                                         |
| `cloudflared.service` (systemd) | ✅ Rodando como systemd, tunnel `omestre-tunnel` ativo (`3debf632-b108-46b6-bcaa-ec370dd476db`), expor só `hmd.omestreafiliado.com.br` (Hermes Dashboard :9119) |
| `app.omestreafiliado.com.br`    | DNS criado (catch-all → `http_status:404`). **Precisa virar ingress real para o app**                                                                           |
| `omestreafiliado.com.br` (apex) | 404 — **RESERVADO para landing page** (não criada ainda). Sem Page Rule de redirect.                                                                            |
| `dev.omestreafiliado.com.br`    | 200 (outro tunnel `omestre-afiliado` rodando na máquina Windows local — continua dev)                                                                           |
| `hermes-dashboard.service`      | ✅ Rodando em :9119                                                                                                                                             |
| `hermes-gateway.service`        | ✅ Rodando em :40659 (loopback)                                                                                                                                 |
| SSH                             | ✅ Porta 22, root login via chave `vps_ed25519`                                                                                                                 |

---

## Decisões fechadas

| Pergunta                           | Decisão                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Onde o `cloudflared` roda?**     | systemd service na máquina (`/etc/systemd/system/cloudflared.service` — **já existe**, só editar). Conecta em `127.0.0.1:5441` (web).                                                                                                                                                                                                                                              |
| **Como gerenciar `.env` de prod?** | Webhook admin app autenticado por **chave pública/privada** (RSA/Ed25519): GitHub Action em push de tag → `curl POST /webhook/deploy` (assinatura HMAC via header ou RSA via chave pública) → webhook chama `scripts/deploy-prod.sh`. App admin também expõe: lista de versões, rollback, métricas, logs.                                                                          |
| **Como o tunnel expõe o app?**     | Reaproveita tunnel `omestre-tunnel` (já ativo). Adiciona ingress `app.omestreafiliado.com.br → http://127.0.0.1:5441`. **ADENDO (2026-08-04):** o apex `omestreafiliado.com.br` fica **reservado para uma landing page do app** (ainda não criada) — NÃO faz redirect apex → app. O ingress `admin.omestreafiliado.com.br` é adicionado na Fase 6 (quando o admin-center existir). |
| **Banco de prod**                  | Postgres 17 + Redis 7 dentro do `docker-compose.yml` no **mesmo VPS** (rede `omestre-infra-net` externa). Sem migração pra gerenciado (custo + risco zero).                                                                                                                                                                                                                        |
| **Evolution API**                  | Container `evoapicloud/evolution-api:v2.3.7` (mesma versão dev) **dentro do mesmo compose**. WhatsApp pessoal conectado 24/7.                                                                                                                                                                                                                                                      |
| **Notificação de deploy**          | **Telegram bot** (reusa `sendTelegramNotification` + `buildTelegramApiUrl` + `buildTelegramPayload` de `packages/worker-common/src/notifier-pure.ts`).                                                                                                                                                                                                                             |
| **Logs persistentes de deploy**    | **R2 bucket `oma-deploy-logs`** (free tier 10GB/mês, egress grátis). Sobrevive a perda do VPS.                                                                                                                                                                                                                                                                                     |
| **Auth webhook**                   | **Ed25519 inline** (pubkey via env `OMA_DEPLOY_PUBLIC_KEY`, privkey só no GitHub Secrets).                                                                                                                                                                                                                                                                                         |
| **Auth UI admin**                  | Basic auth com `scrypt` hash (`OMA_ADMIN_USER` + `OMA_ADMIN_PASSWORD_HASH`).                                                                                                                                                                                                                                                                                                       |
| **Nome do app admin**              | **`admin-center`** — nome mais genérico, comporta futuras features admin além de deploy.                                                                                                                                                                                                                                                                                           |
| **Framework do app admin**         | **Hono**. API mais limpa (`new Hono()`), middleware via `app.use()`, portabilidade futura pra Cloudflare Workers sem reescrita.                                                                                                                                                                                                                                                    |
| **Login do app admin**             | **Single-user (só você)** — senha única em `OMA_ADMIN_PASSWORD_HASH`. Sem cadastro, sem recuperação, sem "esqueci minha senha". Se perder, regenera hash e atualiza `.env` do VPS.                                                                                                                                                                                                 |

---

## Arquitetura alvo

```
[Usuário]
   │ HTTPS (TLS 1.2+)
   ▼
[Cloudflare Edge]
   │ - DDoS + WAF managed
   │ - Always HTTPS + HSTS
   │ - Page Rule: omestreafiliado.com.br/* → 301 app.omestreafiliado.com.br
   ▼
[Cloudflare Tunnel omestre-tunnel]  (outbound-only, systemd)
   │ config ingress:
   │   hmd.omestreafiliado.com.br → 127.0.0.1:9119   (Hermes Dashboard)
   │   app.omestreafiliado.com.br → 127.0.0.1:5441   (Web OMA — NOVO)
   ▼
[VPS Contabo 169.58.120.254 — Ubuntu 24.04]
   │
   │  ┌─ docker network omestre-prod-net ────────────────────────┐
   │  │   api          :5442  (Elysia + psql migrations)          │
   │  │   web          :5441  (nginx, /api/* → api:5442)         │
   │  │   ingestor     :9092  (worker v2 pipeline)                 │
   │  │   dispatcher   :9093  (worker v2 envio)                   │
   │  │   catalog-worker :9094 (queue C)                          │
   │  └─────────────────────────────────────────────────────────────┘
   │  ┌─ docker network omestre-infra-net (externa) ──────────────┐
   │  │   postgres      :5446  (schemas omestre + evolution_api)  │
   │  │   redis         :5445                                   │
   │  │   evolution-api :5444  (Baileys + WhatsApp pessoal)       │
   │  └─────────────────────────────────────────────────────────────┘
   │
   │  Ports bindadas em 127.0.0.1 (nunca 0.0.0.0)
   ▼
   (sem firewall aberto — tunnel é outbound-only)
```

---

## O que precisa ser feito

### Fase 1 — Instalação de base no VPS (1h, manual SSH) ✅ CONCLUÍDA 2026-08-04

Pré-requisitos antes de subir qualquer container.

1. **Instalar Docker + Compose plugin** (Ubuntu 24.04):

   ```bash
   ssh vps
   apt-get update
   apt-get install -y docker.io docker-compose-v2
   systemctl enable --now docker
   docker --version
   docker compose version
   ```

   Não usar Docker CE do repo oficial — `docker.io` do Ubuntu é estável, versão 29.1.x.

2. **Verificar espaço em disco** (já tem 186 GB livres):

   ```bash
   df -h /
   ```

3. **Configurar logrotate para Docker** (evita disco cheio por logs):
   ```bash
   cat > /etc/logrotate.d/docker-containers <<'EOF'
   /var/lib/docker/containers/*/*.log {
     rotate 5
     daily
     compress
     missingok
     notifempty
     copytruncate
   }
   EOF
   ```

**Estado real após execução (2026-08-04, 19:30 UTC):**

| Item                          | Valor                                                   |
| ----------------------------- | ------------------------------------------------------- |
| Docker                        | `29.1.3, build 29.1.3-0ubuntu3~24.04.2`                 |
| Docker Compose                | `2.40.3+ds1-0ubuntu1~24.04.1`                           |
| `systemctl is-active docker`  | `active`                                                |
| `docker run --rm hello-world` | ✅ Funcionou (daemon funcional)                         |
| Logrotate                     | `/etc/logrotate.d/docker-containers` (109 bytes) criado |
| Disco após install            | 7.9GB usado / 185GB livre                               |

**Pitfall encontrado e registrado:** rodar `apt-get install -y docker.io docker-compose-v2` SEM `--no-install-recommends` trava ~20+ minutos tentando baixar dependências extras (provavelmente `criu`, `pigz`, `udhcpc` etc.) via rede lenta do VPS. **Fix:** sempre usar `--no-install-recommends` no install de Docker no Contabo. Tempo cai de 20+min pra ~30s.

**Critério de aceite:** ✅ `docker compose version` retorna sem erro, `systemctl is-active docker` = `active`.

### Fase 2 — Repositório + setup inicial no VPS (30min) ✅ CONCLUÍDA 2026-08-04

1. **Clonar o repositório** em `/root/o-mestre-afiliado`:

   ```bash
   ssh vps
   cd /root
   git clone git@github.com:mtorreao/o-mestre-afiliado.git
   cd o-mestre-afiliado
   git checkout main
   git config --global --add safe.directory /root/o-mestre-afiliado
   ```

2. **Permissões SSH para deploy webhook** — adicionar chave pública `deploy@oma` ao `authorized_keys`:

   ```bash
   ssh vps
   mkdir -p /root/.ssh/deploy
   # A chave será gerada na Fase 6
   ```

3. **Criar rede `omestre-infra-net`** (definida como `external: true` no compose):
   ```bash
   ssh vps
   docker network create --driver bridge omestre-infra-net
   ```

**Estado real após execução (2026-08-04, 20:00 UTC):**

| Item                                      | Valor                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Repo clonado em `/root/o-mestre-afiliado` | ✅ Branch `main` @ `e518177` (up-to-date com origin)                     |
| Working tree                              | ✅ Clean                                                                 |
| `safe.directory`                          | ✅ `/root/o-mestre-afiliado`                                             |
| Rede `omestre-infra-net`                  | ✅ ID `addc195ed94665cfc2c615fbf591d4dcd4c0dc2a316c6eca4350adc6fdb734c1` |
| `/root/.oma`                              | ✅ Criado (perm 700, pra guardar chaves Ed25519 e configs da Fase 6)     |
| `/root/.ssh/deploy`                       | ✅ Criado (perm 700)                                                     |

**Sub-etapa extra necessária (não estava no plano original):** gerar chave SSH no VPS pra falar com GitHub.

```bash
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -C 'vps-deploy-oma' -N ''
ssh-keyscan github.com >> /root/.ssh/known_hosts
ssh -T git@github.com  # testar
# Resposta esperada: "Hi mtorreao! You've successfully authenticated..."
```

Owner cadastrou a pubkey manualmente em https://github.com/settings/keys (VPS Contabo OMA).

**Critério de aceite:** ✅ `ls /root/o-mestre-afiliado` mostra o repo, `docker network ls | grep omestre-infra-net` lista a rede.

### Fase 3 — Secrets de produção (.env, .env.infra, ENCRYPTION_KEY, JWT, etc.) (1h) ✅ CONCLUÍDA 2026-08-04

Valores que precisam ser diferentes de dev. Gerar no VPS (não commitados) e referenciados pelo `env_file` do compose.

1. **Gerar `.env` de prod em `/root/o-mestre-afiliado/.env`** (`chmod 600`):

   ```bash
   ssh vps
   cd /root/o-mestre-afiliado
   chmod 600 .env
   cat > .env <<EOF
   NODE_ENV=production
   JWT_SECRET=$(openssl rand -hex 32)
   ENCRYPTION_KEY=$(openssl rand -hex 16)
   POSTGRES_PASSWORD=$(openssl rand -hex 16)
   EVOLUTION_API_KEY=$(openssl rand -hex 16)
   METRICS_API_KEY=$(openssl rand -hex 16)
   FRONTEND_URL=https://app.omestreafiliado.com.br
   CORS_ORIGIN=https://app.omestreafiliado.com.br
   WEBHOOK_URL=http://api:5442/webhook/message
   REDIS_URL=redis://redis:6379
   EVOLUTION_API_URL=http://evolution-api:8080

   # ── ML OAuth (desabilitado no MVP — setar vazio) ──
   ML_CLIENT_ID=
   ML_CLIENT_SECRET=
   ML_REDIRECT_URI=https://app.omestreafiliado.com.br/api/ml/callback

   # ── Webhook secret (separado da EVOLUTION_API_KEY — Fase 3.5) ──
   OMA_WEBHOOK_SECRET=<32+ chars random — Evolution gera JWT assinado com este secret>
   # A Evolution usa este secret como jwt_key no webhook: envia header "Authorization: Bearer <jwt>"
   # O webhook.routes.ts valida o JWT contra OMA_WEBHOOK_SECRET.

   # ── Admin Center (Fase 6 — preencher depois) ──
   # OMA_DEPLOY_PUBLIC_KEY=<base64 da pubkey Ed25519>
   # OMA_ADMIN_USER=mtorreao
   # OMA_ADMIN_PASSWORD_HASH=<scrypt hash>
   # TELEGRAM_BOT_TOKEN=<token do BotFather>
   # TELEGRAM_CHAT_ID=<chat_id do admin>
   # CLOUDFLARE_ACCOUNT_ID=<account_id>
   # CLOUDFLARE_R2_TOKEN=<token com permissão R2/Edit>
   # CLOUDFLARE_R2_BUCKET=oma-deploy-logs
   EOF
   ```

   **Sobre ML OAuth:** confirmado via `grep` em `apps/api/src/config.ts:23-25` que as 3 vars são **opcionais** (`default: ''`) — sem elas, as rotas `/api/ml/auth` retornam erro amigável mas a API inicializa normalmente. O botão "Conectar ML" na UI fica inativo. Reativar é trivial quando o owner decidir (1 migration do ML app + setar as 3 vars).

2. **Criar `.env.infra`** (portas + key da Evolution):

   ```bash
   ssh vps
   cd /root/o-mestre-afiliado
   chmod 600 .env.infra
   cat > .env.infra <<EOF
   POSTGRES_PORT=127.0.0.1:5446:5432
   EVOLUTION_API_PORT=127.0.0.1:5444:8080
   EVOLUTION_REDIS_PORT=127.0.0.1:5445:6379
   EVOLUTION_API_KEY=$(grep '^EVOLUTION_API_KEY=' .env | cut -d= -f2)
   EOF
   ```

3. ~~**Registrar app ML no developers.mercadolivre.com.br** com `redirect_uri=https://app.omestreafiliado.com.br/api/ml/callback` (separado da app de dev). Sem isso, OAuth quebra em prod.~~ **MVP:** pulado conforme decisão do owner (2026-08-04). ML OAuth reativado em fase futura.

4. **Adicionar `.env` e `.env.infra` ao `.gitignore`** (já estão, mas validar):

   ```bash
   grep -E "^\.env" .gitignore
   # esperado: .env, .env.infra, .env.local, .env.*.local
   ```

5. **Criar diretório de backups** (preparação pra Fase 8):
   ```bash
   ssh vps
   mkdir -p /var/backups/oma-pg
   chmod 700 /var/backups/oma-pg
   ```

**Estado real após execução (2026-08-04, 20:07 UTC):**

| Item                                              | Valor                                                          |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `/root/o-mestre-afiliado/.env`                    | ✅ Criado, perm 600, 926 bytes                                 |
| `/root/o-mestre-afiliado/.env.infra`              | ✅ Criado, perm 600, 165 bytes                                 |
| `JWT_SECRET`                                      | ✅ 64 chars hex (`openssl rand -hex 32`)                       |
| `ENCRYPTION_KEY`                                  | ✅ 32 chars hex (`openssl rand -hex 16`)                       |
| `POSTGRES_PASSWORD`                               | ✅ 32 chars hex                                                |
| `EVOLUTION_API_KEY`                               | ✅ 32 chars hex                                                |
| `METRICS_API_KEY`                                 | ✅ 32 chars hex                                                |
| `NODE_ENV=production`                             | ✅                                                             |
| `FRONTEND_URL=https://app.omestreafiliado.com.br` | ✅                                                             |
| `ML_CLIENT_ID/SECRET`                             | Vazios (MVP sem OAuth — owner confirmou 2026-08-04)            |
| `/var/backups/oma-pg`                             | ✅ Criado, perm 700                                            |
| `.gitignore` contém `.env.infra`                  | ✅ Corrigido (VPS estava desatualizado — `.env.infra` faltava) |

**Sub-etapa descoberta durante execução:** o `.gitignore` no VPS estava desatualizado — **`.env.infra` não estava sendo ignorado pelo git**, o que seria um risco sério de vazar `EVOLUTION_API_KEY` em commit futuro. **Fix aplicado:** commit `8b87678` criado no VPS (`chore: adiciona .env.infra ao .gitignore`). Push pra `origin/main` rejeitado porque main é branch protegida (exige PR). **Owner precisa abrir PR manualmente** em https://github.com/mtorreao/o-mestre-afiliado/compare/main...main?expand=1 (ou via UI).

**Critério de aceite:** ✅ `.env` tem `NODE_ENV=production`, `JWT_SECRET` com 64 chars hex, `FRONTEND_URL=https://app.omestreafiliado.com.br`.

### Fase 3.5 — Separar webhook secret do Evolution auth (30min) ✅ CONCLUÍDA 2026-08-04

**Por que separar:** hoje `EVOLUTION_API_KEY` faz **papel duplo** — autentica a Evolution (saída, em `evolution.ts:54`) e autentica o webhook (entrada, em `webhook.routes.ts:303`). Quem souber essa chave consegue chamar o webhook fingindo ser a Evolution. Padrão ruim de segurança.

**Investigação oficial (repositório Evolution API v2.3.7):**

- `src/api/integrations/event/webhook/webhook.controller.ts:60-65` — Evolution monta o request com `webhookHeaders = { ...(instance?.headers || {}) }` e usa `headers: webhookHeaders as Record<string, string>` no axios.create.
- `webhook.schema.ts:webhook.headers` — campo `headers: { type: 'object' }` é parte do schema oficial. Aceita QUALQUER header customizado por instância.
- Bônus: Evolution v2 suporta **`jwt_key`** (linhas 64-69 do controller) — quando presente, gera JWT assinado com o secret e injeta `Authorization: Bearer <jwt>` automaticamente.

**Estratégia escolhida (rodada 3, 2026-08-04):** usar JWT via `jwt_key` da Evolution.

| Componente                            | Mudança                                                                                                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nova env**                          | `OMA_WEBHOOK_SECRET=<32+ chars random>` — gerada com `openssl rand -hex 32`. Vive só no `.env` da API e do admin-center, **nunca sai do VPS**.                                                                                         |
| **Header enviado pela Evolution**     | `Authorization: Bearer <jwt>` — gerado pela Evolution usando `OMA_WEBHOOK_SECRET` como `jwt_key` configurado na `createInstance`                                                                                                       |
| **Validação no webhook**              | `webhook.routes.ts` valida JWT: extrai `Authorization` header, verifica assinatura usando `OMA_WEBHOOK_SECRET`, valida `exp` (expiração). Sem fallback legacy — quebra limpo se migração não foi feita.                                |
| **`evolution.ts:97`**                 | `createInstance` body agora inclui `webhook.headers: { "jwt_key": "<OMA_WEBHOOK_SECRET>" }` na config do webhook                                                                                                                       |
| **Migração de instancias existentes** | Toda instância nova já recebe o header. Instâncias antigas (criadas antes desta fase) continuam funcionando até recriarem — admin precisa **reconectar** WhatsApp via `/api/whatsapp/connect` pra cada afiliado (cria instância nova). |

**Por que JWT em vez de secret simples no header:**

- JWT tem `exp` (expiração) — secret estático no header expõe pra sempre se logado.
- JWT tem `iat` (issued at) — webhook pode rejeitar tokens velhos (defesa contra replay).
- Padrão da indústria (Stripe, GitHub webhooks usam HMAC; OAuth/JWT são padrão pra webhooks internos).
- Evolution já implementa o suporte (zero código custom nosso na Evolution).

**Setup one-time no VPS (Fase 3.5 executada em 2026-08-04):**

```bash
ssh vps
cd /root/o-mestre-afiliado
OMA_WEBHOOK_SECRET=$(openssl rand -hex 32)
# Adicionar ao .env (substituindo a linha comentada):
sed -i "s|^# OMA_WEBHOOK_SECRET=.*|OMA_WEBHOOK_SECRET=$OMA_WEBHOOK_SECRET|" .env
chmod 600 .env
echo "OMA_WEBHOOK_SECRET_LEN=${#OMA_WEBHOOK_SECRET}"
# Deve printar: OMA_WEBHOOK_SECRET_LEN=64
```

**Mudanças no código (implementadas no PR #9, commit `df81cd2`, 2026-08-04):**

- ✅ `apps/api/src/modules/webhook/webhook-jwt-pure.ts` — módulo puro de verificação JWT HS256 (base64url, parse, claims, HMAC via Web Crypto — zero dependência)
- ✅ `apps/api/src/modules/webhook/webhook-jwt-pure.test.ts` — 23 testes (parse, claims, assinatura válida/inválida, tamper, expiração, clock skew)
- ✅ `apps/api/src/modules/webhook/webhook.routes.ts` — valida `Authorization: Bearer <jwt>` quando `OMA_WEBHOOK_SECRET` configurado; fallback legacy `apikey` apenas se secret vazio (migração suave)
- ✅ `apps/api/src/services/evolution-pure.ts` — `buildCreateInstanceBody` aceita `webhookSecret` e injeta `headers.jwt_key`
- ✅ `apps/api/src/services/evolution.ts:97` — passa `config.OMA_WEBHOOK_SECRET` no createInstance
- ✅ `apps/api/src/config.ts` — env `OMA_WEBHOOK_SECRET` registrada
- ✅ `.env.example` — documentada a nova env

**Estado real após Fase 3.5 (2026-08-04):**

- ✅ `OMA_WEBHOOK_SECRET` gerado e adicionado ao `.env` (64 chars hex, `chmod 600`)
- ✅ Código de verificação JWT implementado + testado (23 testes)
- ✅ Typecheck 11/11 + 599 testes API passando (worktree limpa)
- ⚠️ **Ativação em prod:** instâncias WhatsApp existentes ainda não têm `jwt_key` configurado no webhook. Ao **reconectar** cada instância via `/api/whatsapp/connect` em prod, a nova instância já nasce com o header JWT. O fallback legacy `apikey` garante que nada quebra durante a migração.

**Critério de aceite:** ✅ `OMA_WEBHOOK_SECRET` presente no `.env`, 64 chars hex, plano documenta estratégia JWT.

### Fase 4 — Cloudflare Tunnel: ingress do app (30min) ✅ CONCLUÍDA 2026-08-04

Reaproveitar o tunnel `omestre-tunnel` (já ativo). Adicionar 1 ingress (app).

**ADENDO do owner (2026-08-04):** o apex `omestreafiliado.com.br` fica **reservado para uma landing page** (ainda não criada). NÃO criar Page Rule de redirect apex → app. O ingress `admin.omestreafiliado.com.br` só é adicionado na Fase 6 (quando o admin-center existir).

1. **Editar `/etc/cloudflared/config.yml`** (no VPS) — substituir o placeholder do app pelo ingress real:

   ```bash
   ssh vps
   cat > /etc/cloudflared/config.yml <<'EOF'
   tunnel: 3debf632-b108-46b6-bcaa-ec370dd476db
   credentials-file: /root/.cloudflared/omestre-tunnel.json
   origincert: /root/.cloudflared/cert.pem

   ingress:
     # Hermes Dashboard (já existente)
     - hostname: hmd.omestreafiliado.com.br
       service: http://127.0.0.1:9119
       originRequest:
         connectTimeout: 30s
         noHappyEyeballs: true
     # O Mestre Afiliado — Web (nginx) — NOVO (substitui o placeholder http_status:404)
     - hostname: app.omestreafiliado.com.br
       service: http://127.0.0.1:5441
       originRequest:
         connectTimeout: 30s
         noHappyEyeballs: false
     # Apex omestreafiliado.com.br fica RESERVADO pra landing page (não criada)
     # admin.omestreafiliado.com.br é adicionado na Fase 6
     - service: http_status:404
   EOF
   systemctl restart cloudflared.service
   # Cloudflared hot-reload também funciona (watch no config.yml)
   ```

2. **DNS records no Cloudflare Dashboard** (zona `omestreafiliado.com.br`):
   - `app.omestreafiliado.com.br` → CNAME → `3debf632-b108-46b6-bcaa-ec370dd476db.cfargotunnel.com` (Proxied laranja) — **já resolvia pra Cloudflare** (verificado 2026-08-04, IPs 188.114.x.x), confirmar que aponta pro tunnel
   - Apex `omestreafiliado.com.br`: **manter como está** (reservado pra landing page; não mexer)
   - `admin.omestreafiliado.com.br`: criar na Fase 6

3. ~~**Criar Page Rule no Cloudflare** (redirect apex → app)~~ **REMOVIDO** — apex é reservado pra landing page (adendo do owner).

4. **Validar tunnel conecta ao app**:
   ```bash
   ssh vps
   journalctl -u cloudflared.service -n 30 | grep -iE 'registered|updated|error'
   # Esperado: "Registered tunnel connection" + "Updated to new configuration"
   curl -sI https://app.omestreafiliado.com.br
   # Vai dar 502 até o docker compose up subir, depois 200 (não mais 404)
   ```

**Estado real após execução (2026-08-04, 19:24 UTC):**

| Hostname                        | Antes             | Depois                                                 | Status           |
| ------------------------------- | ----------------- | ------------------------------------------------------ | ---------------- |
| `app.omestreafiliado.com.br`    | 404 (placeholder) | **502** (tunnel roteia pra :5441, app ainda não subiu) | ✅ Ingress ativo |
| `hmd.omestreafiliado.com.br`    | 200               | **302** (dashboard intacto)                            | ✅               |
| `omestreafiliado.com.br` (apex) | 404               | 404 (reservado landing)                                | ✅               |
| Tunnel                          | —                 | 4 conexões QUIC (fra17, fra08, lhr13, cdg13)           | ✅               |

**Critério de aceite:** ✅ `cloudflared tunnel info omestre-tunnel` mostra CONNECTOR ID ativo, `curl -I https://app.omestreafiliado.com.br` retorna 502 (não 404).

### Fase 5 — `scripts/deploy-prod.sh` (idempotente, 2h)

Script Bash no VPS em `/root/o-mestre-afiliado/scripts/deploy-prod.sh`. **Idempotente** (rodar 2x = mesmo estado). Função: clonar/atualizar repo, validar env, build das imagens, restart zero-downtime, healthcheck pós-deploy, registrar versão em `/var/lib/oma/deployments.json`.

1. **Estrutura do script:**

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   # 1. Recebe TAG (ex: v0.4.2) e DEPLOY_KEY (chave pública do webhook)
   # 2. git fetch origin && git checkout <TAG>
   # 3. Validar .env, .env.infra, ENCRYPTION_KEY, JWT_SECRET (mínimo 32 chars)
   # 4. Validar compose: docker compose config -q
   # 5. Build imagens: docker compose build --no-cache api web ingestor dispatcher catalog-worker
   # 6. Registrar versão atual: echo "{tag, timestamp, sha}" >> /var/lib/oma/deployments.json
   # 7. Restart zero-downtime:
   #    - api: docker compose up -d --no-deps --wait api
   #    - web: docker compose up -d --no-deps --wait web
   #    - ingestor: docker compose up -d --no-deps --wait ingestor
   #    - dispatcher: docker compose up -d --no-deps --wait dispatcher
   #    - catalog-worker: docker compose up -d --no-deps --wait catalog-worker
   # 8. Healthchecks: curl /health, /api/health, /api/ml/auth
   # 9. Rollback automático se healthcheck falhar em 30s:
   #    - Checkout da TAG anterior
   #    - Re-deploy
   #    - Notifica webhook (exit 2 = "rolled back")
   ```

2. **Persistência de versões** em `/var/lib/oma/deployments.json`:

   ```json
   [
     { "tag": "v0.4.2", "sha": "954d94b", "deployed_at": "2026-08-04T...", "status": "active" },
     { "tag": "v0.4.1", "sha": "...", "deployed_at": "...", "status": "superseded" }
   ]
   ```

   Mantém últimos 20 deploys. Rollback escolhe o mais recente com `status: active`.

3. **Script de rollback manual** (`scripts/rollback-prod.sh`):

   ```bash
   #!/usr/bin/env bash
   # Lê /var/lib/oma/deployments.json
   # Pega o último superseded
   # Checkout + re-deploy via mesmo fluxo
   ```

4. **Validação manual** (antes de qualquer deploy webhook):
   ```bash
   ssh vps
   cd /root/o-mestre-afiliado
   git checkout v0.4.2  # ou commit atual de main
   bash scripts/deploy-prod.sh v0.4.2
   # Validar: curl /health, /api/health, /api/ml/auth (todos 200)
   ```

**Critério de aceite:** `deploy-prod.sh` roda 2x sem erro, healthchecks passam pós-deploy, `/var/lib/oma/deployments.json` atualiza.

### Fase 6 — App admin-center (apps/admin-center) (5-7h)

App **Hono + Bun** separado do app principal. Roda em container no mesmo compose, escuta em `:9090` (host loopback, só `admin-center` aceita de Cloudflare edge via tunnel).

#### 6.1 Autenticação

**Decisão:** chave assimétrica **Ed25519** validada **inline** (sem volume mount). Chave pública vai em `OMA_DEPLOY_PUBLIC_KEY` no `.env` do container (chmod 600, base64-encoded). GitHub Action assina o payload com a chave privada (armazenada como GitHub Secret criptografado com `age`).

**Setup one-time (no VPS):**

```bash
# 1. Gerar par Ed25519
ssh vps
ssh-keygen -t ed25519 -f /root/.oma/deploy_key -C "oma-deploy-webhook" -N "" -C "oma-deploy-webhook"
# /root/.oma/deploy_key         (PRIVADA — vai pra GitHub Secrets)
# /root/.oma/deploy_key.pub     (PÚBLICA — vai pro .env do admin-center)

# 2. Extrair pubkey em base64 (pra caber em env var)
base64 -w 0 < /root/.oma/deploy_key.pub > /root/.oma/deploy_key.pub.b64
cat /root/.oma/deploy_key.pub.b64
# → copiar pra OMA_DEPLOY_PUBLIC_KEY no .env do VPS

# 3. A chave privada fica SÓ no GitHub Secrets (criptografada com age):
#    https://github.com/YOUR_ORG/o-mestre-afiliado/settings/secrets/actions
#    Nome: OMA_DEPLOY_KEY (valor: conteúdo de /root/.oma/deploy_key)
#    Criptografar com: cat /root/.oma/deploy_key | age -r <pubkey-do-recipient> > oma-deploy-key.age
```

**Por que Ed25519 em vez de HMAC-SHA256:**

- Chave privada fica SÓ no GitHub Secrets — admin-center NÃO tem como assinar deploys falsos (precisa da chave privada que está só no GitHub).
- Se a chave privada vazar, rotacionar é trivial: gerar novo par + atualizar GitHub Secret + redeploy.
- HMAC-SHA256 (chave simétrica) tem o problema: o segredo precisa estar em **dois lugares** (GitHub + .env no VPS) — quem compromete 1 compromete ambos.

#### 6.2 Endpoints

| Método | Path                     | Auth               | Função                                                   |
| ------ | ------------------------ | ------------------ | -------------------------------------------------------- |
| `POST` | `/webhook/deploy`        | Ed25519 signature  | Recebe deploy via GitHub Action                          |
| `POST` | `/webhook/rollback`      | Ed25519 signature  | Rollback pra versão anterior                             |
| `POST` | `/webhook/test-telegram` | Ed25519 signature  | Envia mensagem de teste pro Telegram (pra validar setup) |
| `GET`  | `/admin/versions`        | Basic auth (admin) | Lista versões em `/var/lib/oma/deployments.json`         |
| `POST` | `/admin/rollback/:tag`   | Basic auth (admin) | Rollback manual via UI                                   |
| `GET`  | `/admin/metrics`         | Basic auth (admin) | Métricas dos containers (docker stats JSON)              |
| `GET`  | `/admin/logs/:service`   | Basic auth (admin) | Tail de logs (últimas 100 linhas)                        |
| `GET`  | `/admin/deploys/r2-log`  | Basic auth (admin) | Lista últimos deploys do R2 (log persistente)            |
| `GET`  | `/admin/health`          | nenhum             | Healthcheck simples                                      |
| `GET`  | `/login`                 | nenhum             | UI de login (admin)                                      |
| `GET`  | `/`                      | redirect → /login  | Dashboard admin (HTML simples)                           |

#### 6.3 Estrutura do app

```
apps/admin-center/
├── src/
│   ├── index.ts                  # Hono app + serve :9090
│   ├── routes/
│   │   ├── webhook.ts            # POST /webhook/deploy + /webhook/rollback + /webhook/test-telegram
│   │   ├── admin.ts              # GET /admin/versions, metrics, logs (single-user, scrypt)
│   │   └── ui.ts                 # GET / (dashboard HTML mínimo)
│   ├── auth/
│   │   ├── ed25519.ts            # verify(payload, signature, pubkey) — só pra /webhook/*
│   │   └── basic-auth.ts         # admin user/pass (scrypt, single-user)
│   ├── deploy/
│   │   ├── runner.ts             # exec scripts/deploy-prod.sh + parse result
│   │   ├── registry.ts           # read/write /var/lib/oma/deployments.json
│   │   ├── docker-stats.ts       # parse docker stats --no-stream --format json
│   │   └── r2-log.ts             # PUT/GET log entries no R2 (deploys/{ts}.json)
│   ├── notify/
│   │   └── telegram.ts           # reusa buildTelegramApiUrl + buildTelegramPayload de @omestre/worker-common
│   └── server.ts                 # listen :9090 (Bun.serve)
├── Dockerfile                    # oven/bun:1 + entrypoint
├── package.json                  # deps: hono, @omestre/worker-common
└── tsconfig.json
```

**Framework: Hono.**

- API mais limpa (`new Hono()`), mesma sintaxe de `app.get/post`, middleware via `app.use()`, portabilidade futura pra Cloudflare Workers (Hono foi feito pra isso — `hono/cloudflare-workers`).
- O app principal já usa Elysia, e o admin-center é separado — Hono evita conflito conceitual, e o admin pode ser migrado pra Cloudflare Workers sem reescrita.
- Mesma runtime (Bun), mesmo TypeScript strict. **Não usa DB** — tudo é filesystem + R2 + Redis opcional.

**Reuso de código existente:** `apps/admin-center/src/notify/telegram.ts` **importa** as funções puras de `packages/worker-common/src/notifier-pure.ts` (`buildTelegramApiUrl` + `buildTelegramPayload`) em vez de duplicar a lógica. O `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` vêm do `.env` do admin-center.

**Setup do Telegram:**

1. Criar bot via `@BotFather` no Telegram → gerar `TELEGRAM_BOT_TOKEN`
2. Iniciar conversa com o bot, enviar `/start` → descobrir `TELEGRAM_CHAT_ID` via `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Adicionar ambos no `.env` do VPS

**Single-user login:**

- 1 senha única no `.env` (`OMA_ADMIN_PASSWORD_HASH` com hash scrypt)
- Sem tela de cadastro, sem "esqueci minha senha", sem multi-user
- Se perder a senha: `bun -e "console.log(await Bun.password.hash('NOVA_SENHA', {algorithm:'scrypt'}))"` e atualizar `.env` + restart container

**Exemplo de setup mínimo do Hono (referência, não código final):**

```typescript
import { Hono } from 'hono';
import { serve } from 'Bun';

const app = new Hono();

app.post('/webhook/deploy', async (c) => {
  const signature = c.req.header('X-OMA-Signature');
  const body = await c.req.text();
  const payload = JSON.parse(body);
  // verify Ed25519 signature inline (sem HTTP call)
  if (!verifyEd25519(payload, signature)) return c.text('invalid signature', 401);
  // dispara deploy async
  Bun.spawn(['bash', '/root/o-mestre-afiliado/scripts/deploy-prod.sh', payload.tag]);
  return c.json({ accepted: true });
});

app.get('/admin/versions', basicAuth, async (c) => {
  // lista deployments.json
  return c.json(readDeployments());
});

serve({ fetch: app.fetch, port: 9090 });
```

#### 6.4 Schema do payload assinado

```json
{
  "tag": "v0.4.2",
  "sha": "954d94b...",
  "actor": "matheustorre",
  "timestamp": "2026-08-04T14:30:00Z",
  "nonce": "random-32-bytes-hex"
}
```

Assinatura: `Ed25519.sign(payload_json_canonical, private_key)`. Header HTTP: `X-OMA-Signature: <base64-signature>`.

#### 6.5 Integração com o tunnel

O tunnel `omestre-tunnel` (já existe) precisa adicionar 2 ingress:

```yaml
ingress:
  # ... existentes
  - hostname: admin.omestreafiliado.com.br # NOVO — webhook + UI
    service: http://127.0.0.1:9090
    originRequest:
      connectTimeout: 30s
  # ...
```

DNS: `admin.omestreafiliado.com.br → CNAME → tunnel-uuid.cfargotunnel.com`.

**Cloudflare Access policy (recomendado):** proteger `admin.omestreafiliado.com.br/*` com email allowlist (`mtorreao1@gmail.com`) para UI admin. Webhook `/webhook/*` aceita validação Ed25519 própria (não precisa de Access).

#### 6.6 Integração com R2 (logs de deploy)

Bucket `oma-deploy-logs` em R2 (free tier):

- **Setup one-time:** criar bucket via `wrangler r2 bucket create oma-deploy-logs` (com `wrangler` autenticado no Cloudflare)
- **Auth do admin-center:** API token Cloudflare (`CLOUDFLARE_R2_TOKEN`) com permissão `Account / R2 / Edit`
- **Operações:** cada deploy faz `PUT` de um JSON `{tag, sha, timestamp, actor, duration_ms, status, log_excerpt}` em `deploys/{YYYY-MM-DD}/{timestamp}.json`. TTL opcional via Object Lifecycle Rules (manter 90d).

**Por que R2 e não arquivo local:** R2 sobrevive a perda do VPS (disaster recovery). Logs locais morrem junto com o disco. Free tier é $0/mês pro teu porte.

**Critério de aceite:** `POST /webhook/deploy` aceita deploy com assinatura válida, rejeita sem assinatura, UI admin mostra lista de versões, Telegram recebe notificação, R2 contém log entry do deploy.

#### 6.7 Basic auth com scrypt (UI admin)

A UI admin (`/admin/*`) precisa de auth diferente do webhook. Padrão: **Basic auth com senha hasheada via `scrypt`**.

**Por que scrypt:** bcrypt/scrypt/argon2 são algoritmos de hash com salt embutido (resistentes a rainbow tables). `scrypt` é memory-hard (resistente a GPU/ASIC attack). Já é nativo no Bun (`Bun.password.hash`/`Bun.password.verify`).

**Setup one-time:**

```bash
# Gerar hash da senha admin (rodar localmente, copiar pro .env do VPS):
bun -e "console.log(await Bun.password.hash('SUA_SENHA_FORTE_AQUI', { algorithm: 'scrypt' }))"
# → copia o output pra OMA_ADMIN_PASSWORD_HASH no .env

# Username vai plain text em OMA_ADMIN_USER (não é sensitive — quem vê o .env já tem acesso)
```

**Implementação em `apps/admin-center/src/auth/basic-auth.ts`:**

```typescript
export async function verifyBasicAuth(user: string, pass: string): Promise<boolean> {
  const expectedUser = process.env.OMA_ADMIN_USER;
  const expectedHash = process.env.OMA_ADMIN_PASSWORD_HASH;
  if (!expectedUser || !expectedHash) return false;
  if (user !== expectedUser) return false;
  return await Bun.password.verify(pass, expectedHash);
}
```

**Por que não usar Basic auth nativo do Elysia:** Elysia basic auth aceita plaintext `user:pass` no `.env` (inseguro). Scrypt garante que mesmo com `.env` vazando, a senha não pode ser recuperada (precisa de brute force).

### Fase 7 — GitHub Action: `.github/workflows/deploy.yml` (2h)

Workflow que dispara em **push de tag `v*`**:

```yaml
name: Deploy to Production
on:
  push:
    tags: ['v*']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Read deploy key
        uses: webfactory/ssh-age-action@v1
        with:
          ssh_key: ${{ secrets.OMA_DEPLOY_KEY }}
          # Decrypts Ed25519 key stored as age-encrypted secret

      - name: Send signed deploy
        run: |
          TAG=${GITHUB_REF#refs/tags/}
          SHA=${GITHUB_SHA}
          ACTOR=${GITHUB_ACTOR}
          TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
          NONCE=$(openssl rand -hex 16)

          PAYLOAD=$(jq -nc \
            --arg tag "$TAG" \
            --arg sha "$SHA" \
            --arg actor "$ACTOR" \
            --arg ts "$TS" \
            --arg nonce "$NONCE" \
            '{tag:$tag, sha:$sha, actor:$actor, timestamp:$ts, nonce:$nonce}')

          # Canonicalizar (ordem alfabética de chaves)
          CANONICAL=$(echo "$PAYLOAD" | jq -S -c .)

          # Assinar com Ed25519
          SIGNATURE=$(echo -n "$CANONICAL" | ssh-keygen -Y sign -f deploy_key -n oma-deploy)

          # Enviar
          RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -H "X-OMA-Signature: $SIGNATURE" \
            -d "$CANONICAL" \
            https://admin.omestreafiliado.com.br/webhook/deploy)

          echo "$RESPONSE"
          # Exit code: 0 se 200, 2 se 503 (rolled back), 1 se outros
```

**Segredos GitHub necessários:**

- `OMA_DEPLOY_KEY` — chave privada Ed25519 (criptografada com `age`)
- `ADMIN_WEBHOOK_URL` — `https://admin.omestreafiliado.com.br/webhook/deploy`

**Critério de aceite:** Push de tag `v0.0.1` dispara workflow → workflow chama webhook → webhook deploya.

### Fase 8 — Backup automático do Postgres (30min)

Cron no VPS:

```bash
ssh vps
cat > /etc/cron.d/oma-pg-backup <<'EOF'
0 3 * * * root /usr/bin/docker exec omestre_postgres pg_dump -U evolution -d omestre_db -n omestre -n evolution_api | gzip > /var/backups/oma-pg/oma-$(date +\%Y\%m\%d).sql.gz
0 4 * * 0 root /usr/bin/find /var/backups/oma-pg -name "oma-*.sql.gz" -mtime +7 -delete
EOF
mkdir -p /var/backups/oma-pg
```

**Critério de aceite:** `ls /var/backups/oma-pg/` mostra arquivo de hoje após 03:00.

### Fase 9 — Monitoramento mínimo viável (1h)

Sem Uptime Kuma (Fase 2). O mínimo é:

1. **Cloudflare Tunnel dashboard** mostra status da conexão (`Zero Trust → Tunnels → omestre-tunnel`).
2. **Email alert do Cloudflare** se tunnel ficar disconnected >5 min.
3. **Healthcheck endpoint** do webhook admin (`/admin/health`) chamado pelo Cloudflare Health Check.
4. **Logs centralizados**: `journalctl -u cloudflared.service -f` + `docker compose logs -f`.

**Critério de aceite:** tunnel mostra `connected`, healthchecks retornam 200.

### Fase 10 — Documentação final (1h)

Criar `docs/specs/deploy-producao.md` (status: ✅ validated após deploy real) com:

- Diagrama de arquitetura (referência ao plano)
- Comandos operacionais (deploy, rollback, logs, backup)
- Procedimento de disaster recovery
- Contatos/links de emergência

---

## Ordem de execução

| Fase                           | Dependência | Tempo estimado |
| ------------------------------ | ----------- | -------------- |
| 1 — Instalar Docker no VPS     | —           | 1h             |
| 2 — Repo + rede                | 1           | 30min          |
| 3 — Secrets (.env)             | 1           | 1h             |
| 3.5 — Separar webhook secret   | 3           | 30min          |
| 4 — Tunnel ingress + Page Rule | 1, 2        | 30min          |
| 5 — `deploy-prod.sh`           | 1, 2, 3     | 2h             |
| 6 — Admin webhook app          | 1, 2, 3, 4  | 5-7h           |
| 7 — GitHub Action              | 6           | 2h             |
| 8 — Backup cron                | 1           | 30min          |
| 9 — Monitoramento              | 1, 4, 6     | 1h             |
| 10 — Docs                      | todos       | 1h             |

**Total:** ~15-17h (~2-3 dias úteis)

**Ordem obrigatória:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (Fase 8/9/10 podem ser feitas em paralelo por outro dev).

---

## Critérios de aceite (este plano está "feito" quando)

- [ ] VPS tem Docker + compose instalado (`docker --version` retorna)
- [ ] Repo clonado em `/root/o-mestre-afiliado` (branch `main`)
- [ ] Rede `omestre-infra-net` criada
- [ ] `.env` de prod gerado com secrets fortes, `chmod 600`, **inclui vars do admin-center** (Ed25519 pubkey, Telegram, R2, admin scrypt hash)
- [ ] App ML registrado com `redirect_uri` de prod
- [ ] Tunnel ingress editado: `app.omestreafiliado.com.br → http://127.0.0.1:5441` + `admin.omestreafiliado.com.br → http://127.0.0.1:9090`
- [ ] Page Rule criada: apex → 301 para app
- [ ] `curl -I https://app.omestreafiliado.com.br` retorna 200 (com compose up)
- [ ] `curl -I https://omestreafiliado.com.br` retorna 301 para `app.omestreafiliado.com.br`
- [ ] `scripts/deploy-prod.sh v0.0.0` roda idempotente, healthchecks passam
- [ ] Webhook admin app escuta em `:9090`, valida Ed25519 inline
- [ ] UI admin em `https://admin.omestreafiliado.com.br` (login scrypt + lista versões + métricas + logs)
- [ ] Push de tag `v0.0.1` dispara GitHub Action → webhook → deploy → Telegram notifica
- [ ] Bucket R2 `oma-deploy-logs` criado, recebe log entries dos deploys
- [ ] Backup cron ativo: arquivo em `/var/backups/oma-pg/` após 03:00
- [ ] Logs centralizados acessíveis (journal + docker logs)
- [ ] Documentação `docs/specs/deploy-producao.md` atualizada

---

## Riscos e mitigações

| Risco                                                  | Probabilidade                   | Impacto | Mitigação                                                                                                                     |
| ------------------------------------------------------ | ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| VPS Contabo ficar offline                              | Baixa                           | Alto    | Backup offsite do Postgres (Fase 2); plano de restore documentado                                                             |
| Sessão WhatsApp banida                                 | Média                           | Alto    | Backup schema `evolution_api` no cron pg_dump; documentar reconexão                                                           |
| Ed25519 chave comprometida                             | Baixa                           | Crítico | Rotação fácil (gera nova + atualiza secret + redeploy); revogar a antiga                                                      |
| Deploy parcial (alguns containers subiram, outros não) | Média                           | Médio   | Healthchecks por service + rollback automático se algum falhar                                                                |
| Disk cheio por logs Docker                             | Média                           | Médio   | logrotate configurado na Fase 1                                                                                               |
| App ML redirect_uri errado                             | Alta (clássico)                 | Médio   | Validar `ML_REDIRECT_URI` em `.env` ANTES do primeiro deploy                                                                  |
| Webhook admin acessível sem auth                       | Baixa (validação Ed25519 forte) | Crítico | Ed25519 é assimétrica — chave privada fica SÓ no GitHub Secrets. Logs de tentativas inválidas.                                |
| DNS CNAME criado em zona errada                        | Baixa                           | Médio   | Tunnel `omestre-tunnel` já criado no VPS — usar `tunnel info` pra pegar UUID, dashboard Cloudflare adiciona CNAME manualmente |

---

## Decisões fechadas (rodada 2, 2026-08-04)

| Pergunta                                       | Decisão                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Domínio do admin webhook**                   | `admin.omestreafiliado.com.br` (novo ingress no tunnel)                                                                                                                        |
| **Notificação de deploy**                      | **Telegram bot** (reusa `sendTelegramNotification` de `packages/worker-common/src/notifier.ts`)                                                                                |
| **Persistência de logs de deploy**             | **R2 (Cloudflare)** — free tier dá 10GB/mês + 10M Class B operations + **egress grátis**, suficiente pra logs de deploy. Sem custo $0/mês pro teu porte (logs são KB, não GB). |
| **Algoritmo de assinatura webhook**            | **Ed25519** (chave assimétrica)                                                                                                                                                |
| **Como o admin-center obtém a pubkey Ed25519** | **Inline via env no container** (sem volume mount). Pubkey vai no `.env` (`OMA_DEPLOY_PUBLIC_KEY=<base64>`) ou docker secret. Mais simples, sem setup extra.                   |

---

## Próximos passos sugeridos (Fase 2 — após produção estável)

- Migrar logs para Cloudflare Logpush → R2 (análise com SQL via R2 Data Catalog)
- Adicionar Uptime Kuma rodando no VPS (`:3001`, atrás de outro tunnel `uptime.omestreafiliado.com.br`)
- Cloudflare Access policy em `admin.omestreafiliado.com.br` (email allowlist)
- Offsite backup: `rclone sync /var/backups/oma-pg r2:oma-backups/` (semanal)
- Métricas reais (CPU/RAM por container) expostas em `/admin/metrics` via Prometheus exporter
- Notificação de deploys via Telegram bot (além de log)

---

## Revision history

| Date       | Version | Change                                                                                                                                                                                                                                                                                                                                                                                                                | Reason                                                                                                |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2026-08-04 | 0.1.0   | Initial draft após investigação SSH do VPS real                                                                                                                                                                                                                                                                                                                                                                       | Primeira escrita — owner pediu estratégia de deploy usando docker-compose + tunnel                    |
| 2026-08-04 | 0.2.0   | Fechadas 5 decisões pendentes: domínio admin, Telegram (reusa notifier-pure.ts), R2 (free tier), Ed25519 inline, basic auth com scrypt. Adicionada Fase 6.6 (R2) e 6.7 (basic auth scrypt). `.env` expandido com 8 vars novas. Critérios de aceite atualizados.                                                                                                                                                       | Owner respondeu às 5 perguntas abertas; plano agora é executável end-to-end                           |
| 2026-08-04 | 0.3.0   | App renomeado de `admin-webhook` → `admin-center` (mais genérico). Framework trocado de Elysia → Hono (portabilidade pra Workers). Login single-user (sem cadastro/recuperação). Adicionada referência de implementação mínima do Hono.                                                                                                                                                                               | Owner pediu nome mais genérico + Hono + single-user                                                   |
| 2026-08-04 | 0.4.0   | **Fase 1 executada no VPS.** Docker 29.1.3 + Compose 2.40.3 instalados via `apt-get install --no-install-recommends` (pitfall documentado: sem a flag, install trava 20+min). Daemon funcional (`docker run hello-world` OK). Logrotate configurado. Disco 185GB livre.                                                                                                                                               | Owner pediu pra começar Fase 1                                                                        |
| 2026-08-04 | 0.5.0   | **Fase 2 executada no VPS.** Chave SSH Ed25519 gerada no VPS (`vps-deploy-oma`), cadastrada manualmente pelo owner no GitHub. Repo clonado em `/root/o-mestre-afiliado` (branch `main` @ `e518177`). Rede Docker `omestre-infra-net` criada (ID `addc195ed9...`). Diretórios `/root/.oma` e `/root/.ssh/deploy` criados (perm 700) pra Fase 6.                                                                        | Owner confirmou cadastro da chave no GitHub                                                           |
| 2026-08-04 | 0.6.0   | **Fase 3 executada no VPS.** `.env` e `.env.infra` gerados com secrets fortes (5 secrets via `openssl rand -hex`). ML OAuth desabilitado no MVP (vars vazias). Diretório `/var/backups/oma-pg` criado (perm 700). **Bug encontrado + corrigido:** `.gitignore` no VPS não tinha `.env.infra` — commit `8b87678` criado pra consertar (push rejeitado por branch protection, owner precisa abrir PR).                  | Owner pediu pra pular ML OAuth no MVP                                                                 |
| 2026-08-04 | 0.7.0   | **Fase 3.5 adicionada e executada no VPS:** separar webhook secret do Evolution auth. Investigação oficial do repo Evolution API v2.3.7 confirmou que `webhook.headers` aceita headers customizados E suporta `jwt_key` (gera JWT auto). Estratégia escolhida: `OMA_WEBHOOK_SECRET` + header `Authorization: Bearer <jwt>`. Env var adicionada ao `.env` (64 chars hex, `chmod 600` preservado).                      | Owner identificou compartilhamento inseguro de secret; pediu investigação antes de decidir estratégia |
| 2026-08-04 | 0.8.0   | **Código da Fase 3.5 implementado no PR #9 (commit `df81cd2`):** `webhook-jwt-pure.ts` (verificação JWT HS256 via Web Crypto, zero dep), 23 testes, `webhook.routes.ts` com validação JWT + fallback legacy, `evolution-pure.ts`/`evolution.ts` injetam `jwt_key`, `config.ts` + `.env.example` atualizados. Verificado: typecheck 11/11, 599 testes API. Ativação em prod depende de reconectar instâncias WhatsApp. | Owner pediu pra incluir `.env.example` + código relacionado na mudança                                |
| 2026-08-04 | 0.9.0   | **Fase 4 executada no VPS.** Ingress do tunnel atualizado: `app.omestreafiliado.com.br → http://127.0.0.1:5441` (substitui placeholder 404). Apex `omestreafiliado.com.br` mantido reservado pra landing page (adendo do owner). `admin.` ingress adiado pra Fase 6. Tunnel reiniciado, 4 conexões QUIC, `app.` responde 502 (app ainda não subiu), `hmd.` segue 302.                                                 | Owner mergeou PR #9 e pediu Fase 4 com adendo: apex reservado pra landing page                        |
