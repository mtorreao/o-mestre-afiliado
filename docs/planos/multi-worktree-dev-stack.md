# ✅ Executado/mergeado: dev stack multi-worktree

> **Status:** mergeado em `main` no commit `e53285c` (feature `7ddc681`).
> **Branch de origem:** `wt/dev-worktree-isolation-20260725`.
> **Worktree de origem:** `.worktrees/dev-worktree-isolation` (removido após o merge).

## Problema

O `scripts/dev.ts` antigo usava `bun --watch`/`vite --port` para subir API/Worker/Web no host, e o único tunnel `omestre-afiliado` (`f1437a45…`) cobria `dev.omestreafiliado.com.br`. Quando dois agentes LLM abriam worktrees em paralelo, ambos sobrescreviam containers Docker nomeados e o único CNAME do tunnel — não havia isolamento entre ambientes.

## Solução entregue

`bun run dev` agora orquestra `docker compose -f docker-compose.dev.yml` com:

- **Identidade derivada da branch atual** (`git branch --show-current`), slug para DNS/Compose (≤ 35 chars, kebab-case). Dois worktrees da mesma branch disputam o lockdir — segurança contra duas instâncias paralelas do mesmo branch.
- **Compose project exclusivo** (`omestre-dev-<slug>`), containers, network, volumes nomeados por branch.
- **Bloco de 7 portas determinístico** (web/api/postgres/evolution/redis/ingestor/dispatcher). `DEV_PORT_BASE` força o bloco; default 5450/5440/5740 conforme `identityHash`. Varre até 80 blocos livres antes de falhar.
- **Lockfile em `tmp/dev-<slug>.lockdir/`** com `pid`, `branch` e `ports`; remove automaticamente locks cujo PID morreu.
- **Persisted state** em `tmp/dev-<slug>.json` reutiliza a stack se ainda estiver rodando (idempotente em reinicializações).
- **Tunnel Cloudflare por branch** com 3 modos:
  - `DEV_TUNNEL_MODE=named` (default em worktree principal) — usa o `~/.cloudflared/omestre-afiliado*.yml`, gera o config do branch e sobe o container `tunnel` do Compose.
  - `DEV_TUNNEL_MODE=quick` (default em worktree) — sobe `cloudflared --url http://127.0.0.1:$WEB_PORT` no host e imprime a URL `*.trycloudflare.com` com moldura no terminal.
  - `SKIP_TUNNEL=1` — só a stack local.
- **Cloudflare API** opcional: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` da conta que possui a zona (`Zone / DNS / Edit`) para criar/atualizar o CNAME da branch via `POST /zones/{id}/dns_records`. Não usar `cloudflared tunnel route dns` quando o `cert.pem` local pertence a outra conta — o registro é criado sob a zona errada.
- **`.env` fallback**: se o worktree não tem `.env`, herda do worktree `main` (sem copiar secrets).
- **Cleanup**: Ctrl+C derruba só o Compose project da branch (`docker compose down --remove-orphans`); quick tunnel é morto; lockdir e `cloudflared/<slug>.yml` removidos (exceto com `KEEP_INFRA=1`); `NUKE_DATA=1` remove também os volumes.
- **Banner destacado** com slug, Compose project, modo, porta local e URL pública do quick tunnel quando aplicável.

## Variáveis de ambiente relevantes

| Variável                                      | Default                            | Efeito                             |
| --------------------------------------------- | ---------------------------------- | ---------------------------------- |
| `DEV_TUNNEL_MODE`                             | `named`/`quick` por branch         | força o modo                       |
| `DEV_PORT_BASE`                               | auto (determinístico)              | fixa o bloco de portas             |
| `DEV_BIND_HOST`                               | `127.0.0.1`                        | host das portas                    |
| `DEV_BUILD`                                   | `1`                                | `0` reusa imagens Docker           |
| `DEV_APP_ENV_FILE`                            | `<worktree>/.env` ou `<main>/.env` | `.env` para os containers          |
| `KEEP_INFRA`                                  | `0`                                | preserva containers/config ao sair |
| `NUKE_DATA`                                   | `0`                                | remove volumes no shutdown         |
| `SKIP_LOCK`                                   | `0`                                | desabilita lockdir (debug)         |
| `SKIP_TUNNEL`                                 | `0`                                | não sobe tunnel                    |
| `CLOUDFLARE_API_TOKEN`                        | unset                              | automatiza CNAME via API           |
| `CLOUDFLARE_ZONE_ID`                          | unset                              | zona para o CNAME                  |
| `TUNNEL_CONFIG` / `TUNNEL_ID` / `TUNNEL_NAME` | heurística                         | override do tunnel nomeado         |

## Pitfalls documentados durante o trabalho

1. **`tasklist` lista PID zumbi no Windows**: lockdir antigo pode parecer ativo mesmo após `taskkill`. O script confia apenas na presença do PID em `tasklist`; se ausente, lock é stale.
2. **DNS do cloudflared local**: o `cert.pem` em `~/.cloudflared/` pertence à conta `coderfirst.dev`, não à `omestreafiliado.com.br`. `cloudflared tunnel route dns <tunnel> dev-branch.omestreafiliado.com.br` cria literalmente `dev-branch.omestreafiliado.com.br.coderfirst.dev`. Para DNS na zona correta, usar a API Cloudflare com token da zona certa.
3. **curl localhost vs 127.0.0.1** no Windows: dual-stack pode falhar com `::1`; preferir `127.0.0.1` para smoke tests.
4. **Quick tunnel zumbi**: ao matar o `bun run dev` sem orquestrar, o `cloudflared` continua rodando; a URL antiga fica órfã. Matar `cloudflared.exe` antes de relançar a stack.
5. **Diretório de worktree residual**: no Windows, `git worktree remove --force` pode deixar o diretório órfão com handles abertos (documentado em skill `omestre-afiliado` §7). Requer reboot ou `del /F` para limpar.

## Verificações de aceitação

```bash
# Identidade determinística
bun run scripts/dev.ts --dry-run
# → Branch, slug, Compose project, modo, portas, env

# Modo quick em worktree (GIT_WORKTREE setada)
GIT_WORKTREE=. bun run dev
# →  URL pública (quick tunnel): https://*.trycloudflare.com
# →  URL local:                 http://localhost:5741

# Bloqueio de porta explícito
DEV_PORT_BASE=5740 bun run dev

# Smoke test via tunnel
curl -sS https://<quick-url>/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://<quick-url>/login
curl -sS -X POST https://<quick-url>/api/auth/login -H 'Content-Type: application/json' --data '{"email":"...","password":"..."}'

# Typecheck do script
bun --check scripts/dev.ts
./node_modules/.bin/tsc --noEmit -p <worktree>/tsconfig.json  # exit 0
```

## Comandos úteis

```bash
# Limpar tudo (containers + lockdir + state + tunnel config)
docker compose --project-name omestre-dev-<slug> -f docker-compose.dev.yml down --remove-orphans
rm -rf tmp/dev-<slug>.lockdir tmp/dev-<slug>.json tmp/cloudflared

# Remover tunnel nomeado da branch na Cloudflare
cloudflared tunnel delete -f omestre-afiliado-<slug>

# Forçar modo quick mesmo no worktree principal
DEV_TUNNEL_MODE=quick bun run dev
```

## Arquivos alterados no commit `7ddc681`

- `scripts/dev.ts` — reescrito
- `docker-compose.dev.yml` — parametrizado
- `README.md`, `AGENTS.md`, `docs/README.md` — atualizados
- Skill `project/omestre-afiliado` (Hermes) — atualizada
