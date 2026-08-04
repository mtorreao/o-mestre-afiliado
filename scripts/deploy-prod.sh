#!/usr/bin/env bash
# =============================================================================
# scripts/deploy-prod.sh — Deploy de produção do O Mestre Afiliado (VPS Contabo)
# =============================================================================
# Uso:
#   bash scripts/deploy-prod.sh <tag>          # deploy de uma tag git (ex: v0.4.2)
#   bash scripts/deploy-prod.sh                # deploy da branch atual (main)
#
# O que faz (idempotente — rodar 2x = mesmo estado):
#   1. Valida pré-requisitos (docker, compose, .env)
#   2. git fetch + checkout da tag/branch alvo
#   3. Valida secrets obrigatórios no .env
#   4. docker compose config -q (valida YAML)
#   5. Build das imagens (api, web, ingestor, dispatcher, catalog-worker)
#   6. Registra versão em /var/lib/oma/deployments.json (ANTES do deploy)
#   7. Restart zero-downtime: sobe containers com --no-deps --wait
#   8. Healthchecks pós-deploy (com timeout e retry)
#   9. Rollback automático se healthcheck falhar (checkout da tag anterior)
#
# Exit codes:
#   0 = deploy OK
#   1 = falha de validação/uso (não deployou)
#   2 = deploy falhou E rollback foi acionado
#   3 = deploy falhou E rollback também falhou (REVISAR MANUALMENTE)
#
# Deps: docker, docker compose v2, jq (opcional — usa grep/cut se ausente), curl
# =============================================================================
set -euo pipefail

# ─── Cores ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}==>${NC} $1"; }
ok()    { echo -e "${GREEN}✅${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠️ $1${NC}"; }
err()   { echo -e "${RED}❌${NC} $1"; }

# ─── Config ──────────────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

DEPLOYMENTS_FILE="/var/lib/oma/deployments.json"
MAX_DEPLOYS_KEPT=20
HEALTHCHECK_TIMEOUT=90          # segundos total para healthchecks
HEALTHCHECK_RETRY_INTERVAL=5    # segundos entre tentativas
COMPOSE_FILE="docker-compose.yml"
TARGET="${1:-}"

# Serviços do app (ordem de startup: dependências primeiro)
APP_SERVICES=(api web ingestor dispatcher catalog-worker)
# Serviços de infra (sobem antes do app; mesmo compose — decisão do owner 2026-08-04)
INFRA_SERVICES=(postgres redis evolution-api)

# ─── Help ────────────────────────────────────────────────────────────────────
if [ "$TARGET" = "-h" ] || [ "$TARGET" = "--help" ]; then
  echo "Uso: bash scripts/deploy-prod.sh [tag]"
  echo "  tag   tag git a deployar (ex: v0.4.2). Sem arg = branch atual."
  exit 0
fi

# ─── Pré-requisitos ──────────────────────────────────────────────────────────
info "Verificando pré-requisitos..."
command -v docker >/dev/null 2>&1 || { err "docker não instalado"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "docker compose v2 não instalado"; exit 1; }
command -v curl >/dev/null 2>&1 || { err "curl não instalado"; exit 1; }

if [ ! -f "$ROOT_DIR/.env" ]; then
  err ".env não encontrado em $ROOT_DIR/.env — configure antes de deployar"
  exit 1
fi
ok "Pré-requisitos OK"

# ─── Secrets obrigatórios ────────────────────────────────────────────────────
info "Validando secrets obrigatórios no .env..."
validate_secret() {
  local key="$1" min_len="${2:-32}"
  local val
  val=$(grep -E "^${key}=" "$ROOT_DIR/.env" | head -1 | cut -d= -f2- | tr -d '[:space:]')
  if [ -z "$val" ]; then
    err "${key} está vazio no .env"
    return 1
  fi
  if [ ${#val} -lt "$min_len" ]; then
    err "${key} tem ${#val} chars (mínimo ${min_len}) — gere com openssl rand -hex"
    return 1
  fi
  ok "${key} presente (${#val} chars)"
}
validate_secret "JWT_SECRET" 32
validate_secret "ENCRYPTION_KEY" 32
validate_secret "POSTGRES_PASSWORD" 16
validate_secret "EVOLUTION_API_KEY" 16
validate_secret "METRICS_API_KEY" 16

if grep -q "^NODE_ENV=production" "$ROOT_DIR/.env" 2>/dev/null; then
  ok "NODE_ENV=production"
else
  warn "NODE_ENV não é production no .env — deploy continua (mas revise)"
fi

# ─── Git: fetch + checkout ───────────────────────────────────────────────────
# GUARD: aborta se houver arquivos TRACKED modificados localmente (evita
# o git checkout/pull sobrescrever mudanças não commitadas, ex: docker-compose.yml).
# .env/.env.infra são gitignored e não contam.
DIRTY_TRACKED=$(git status --porcelain | grep -vE '^\?\?' | grep -vE '\.env' | head -5 || true)
if [ -n "$DIRTY_TRACKED" ]; then
  err "Working tree tem arquivos tracked modificados não commitados — abortando:"
  echo "$DIRTY_TRACKED" | while read -r line; do echo "  $line"; done
  err "Commit ou stash antes de deployar (ex: bash scripts/deploy-prod.sh <tag> já commitado)."
  exit 1
fi

info "Preparando checkout..."
git fetch origin --tags 2>/dev/null || { err "git fetch falhou"; exit 1; }

CURRENT_SHA=$(git rev-parse --short HEAD)
CURRENT_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo 'untagged')"

if [ -n "$TARGET" ]; then
  # Valida que a tag existe antes de tentar checkout
  if ! git rev-parse -q --verify "refs/tags/${TARGET}" >/dev/null 2>&1; then
    err "Tag '${TARGET}' não encontrada. Tags disponíveis:"
    git tag --sort=-creatordate | head -10
    exit 1
  fi
  info "Checkout da tag ${TARGET}..."
  git checkout "$TARGET" 2>&1 | tail -2 || { err "checkout falhou"; exit 1; }
  DEPLOY_TAG="$TARGET"
else
  info "Sem tag especificada — deployando branch atual (${CURRENT_TAG:-untagged})..."
  git checkout main 2>&1 | tail -2 || true
  git pull --ff-only 2>/dev/null || warn "git pull falhou (segue com local)"
  DEPLOY_TAG="$CURRENT_TAG"
fi

NEW_SHA=$(git rev-parse --short HEAD)
info "Deploy: tag=${DEPLOY_TAG} sha=${NEW_SHA} (anterior: ${CURRENT_TAG}@${CURRENT_SHA})"

# ─── Valida compose ──────────────────────────────────────────────────────────
info "Validando docker compose (config -q)..."
docker compose -f "$COMPOSE_FILE" --env-file .env config -q || { err "compose config inválido"; exit 1; }
ok "compose config válido"

# ─── Infra (mesmo compose; idempotente — só sobe se não estiver rodando) ────
info "Verificando infra (postgres, redis, evolution)..."
if ! docker network ls --format '{{.Name}}' | grep -qx 'omestre-infra-net'; then
  docker network create --driver bridge omestre-infra-net
  ok "Rede omestre-infra-net criada"
fi

# Verifica se infra já está rodando (evita restart desnecessário)
if ! docker ps --format '{{.Names}}' | grep -qE 'omestre_(postgres|redis|evolution)'; then
  info "Subindo infra (postgres, redis, evolution)..."
  docker compose -f "$COMPOSE_FILE" --env-file .env up -d --wait "${INFRA_SERVICES[@]}" \
    || { err "Falha ao subir infra"; exit 1; }
  ok "Infra subiu"
else
  ok "Infra já está rodando"
fi

# ─── Build das imagens ───────────────────────────────────────────────────────
info "Build das imagens (api, web, ingestor, dispatcher, catalog-worker)..."
docker compose -f "$COMPOSE_FILE" --env-file .env build api web ingestor dispatcher catalog-worker \
  || { err "Build falhou"; exit 1; }
ok "Imagens buildadas"

# ─── Registrar versão (ANTES do deploy — para rollback) ──────────────────────
mkdir -p "$(dirname "$DEPLOYMENTS_FILE")"
register_deployment() {
  local tag="$1" sha="$2" status="$3" ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Remove entrada existente com mesma tag (idempotência)
  local tmp
  tmp=$(mktemp)
  if [ -f "$DEPLOYMENTS_FILE" ]; then
    jq -c "map(select(.tag != \"$tag\")) | . + [{tag: \"$tag\", sha: \"$sha\", deployed_at: \"$ts\", status: \"$status\"}] | .[-20:]" \
      "$DEPLOYMENTS_FILE" > "$tmp" 2>/dev/null \
      || jq -c "map(select(.tag != \"$tag\")) | . + [{tag: \"$tag\", sha: \"$sha\", deployed_at: \"$ts\", status: \"$status\"}] | .[-20:]" \
      <<< "[]" > "$tmp"
  else
    jq -c --arg t "$tag" --arg s "$sha" --arg ts "$ts" --arg st "$status" \
      "[{tag: \$t, sha: \$s, deployed_at: \$ts, status: \$st}]" > "$tmp"
  fi
  mv "$tmp" "$DEPLOYMENTS_FILE"
  chmod 600 "$DEPLOYMENTS_FILE"
}
register_deployment "$DEPLOY_TAG" "$NEW_SHA" "deploying"

# ─── Deploy zero-downtime ────────────────────────────────────────────────────
deploy_services() {
  info "Subindo serviços (zero-downtime)..."
  for svc in "${APP_SERVICES[@]}"; do
    info "  → ${svc}"
    docker compose -f "$COMPOSE_FILE" --env-file .env up -d --no-deps --wait "$svc" \
      || { err "Falha ao subir ${svc}"; return 1; }
    ok "  ${svc} healthy"
  done
  return 0
}

# ─── Healthchecks ────────────────────────────────────────────────────────────
wait_healthy() {
  local deadline=$((SECONDS + HEALTHCHECK_TIMEOUT))
  while [ $SECONDS -lt $deadline ]; do
    # Healthcheck 1: API local
    local api_ok=1
    curl -sf http://localhost:5442/health >/dev/null 2>&1 && api_ok=0 || true

    # Healthcheck 2: Web (nginx) local
    local web_ok=1
    curl -sf http://localhost:5441/ >/dev/null 2>&1 && web_ok=0 || true

    # Healthcheck 3: Webhook endpoint (evita 404)
    local wh_ok=1
    local wh_code
    wh_code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5442/webhook/message -X POST \
      -H 'Content-Type: application/json' -d '{}' 2>/dev/null || echo "000")
    # 200 (sem auth configurada) ou 401/503 (auth ativa) = endpoint respondendo
    if [ "$wh_code" != "000" ]; then wh_ok=0; fi

    if [ $api_ok -eq 0 ] && [ $web_ok -eq 0 ] && [ $wh_ok -eq 0 ]; then
      return 0
    fi

    # Progresso
    if [ $((SECONDS % 20)) -lt $HEALTHCHECK_RETRY_INTERVAL ]; then
      echo -n "." 
    fi
    sleep $HEALTHCHECK_RETRY_INTERVAL
  done
  echo ""
  return 1
}

# ─── Rollback ────────────────────────────────────────────────────────────────
rollback() {
  local failed_sha="$1"
  err "Deploy falhou — acionando rollback..."

  # Busca última versão com status diferente de deploying/active para esta sha
  local prev_tag prev_sha
  if [ -f "$DEPLOYMENTS_FILE" ]; then
    prev_tag=$(jq -r "[.[] | select(.status == \"active\")][-1].tag // empty" "$DEPLOYMENTS_FILE" 2>/dev/null || echo "")
    prev_sha=$(jq -r "[.[] | select(.status == \"active\")][-1].sha // empty" "$DEPLOYMENTS_FILE" 2>/dev/null || echo "")
  fi

  if [ -n "$prev_tag" ] && git rev-parse -q --verify "refs/tags/${prev_tag}" >/dev/null 2>&1; then
    info "Rollback para ${prev_tag}@${prev_sha}..."
    git checkout "$prev_tag" 2>&1 | tail -2 || true
    docker compose -f "$COMPOSE_FILE" --env-file .env build api web ingestor dispatcher catalog-worker \
      || { err "Rollback: build falhou"; return 3; }
    for svc in "${APP_SERVICES[@]}"; do
      docker compose -f "$COMPOSE_FILE" --env-file .env up -d --no-deps --wait "$svc" \
        || { err "Rollback: falha ao subir ${svc}"; return 3; }
    done
    if wait_healthy; then
      register_deployment "$prev_tag" "$prev_sha" "active"
      warn "Rollback concluído para ${prev_tag} (sha ${prev_sha})"
      return 2
    fi
    err "Rollback: healthcheck também falhou — REVISAR MANUALMENTE"
    return 3
  fi

  warn "Nenhuma versão anterior ativa encontrada — app pode estar fora do ar. REVISAR MANUALMENTE."
  return 3
}

# ─── Execução principal ──────────────────────────────────────────────────────
if deploy_services; then
  info "Aguardando healthchecks (timeout ${HEALTHCHECK_TIMEOUT}s)..."
  if wait_healthy; then
    echo ""
    register_deployment "$DEPLOY_TAG" "$NEW_SHA" "active"
    ok "══════════════════════════════════════════════════"
    ok "Deploy concluído: ${DEPLOY_TAG}@${NEW_SHA}"
    ok "══════════════════════════════════════════════════"
    echo "  API health:  http://localhost:5442/health"
    echo "  Web:         http://localhost:5441"
    echo "  Público:     https://app.omestreafiliado.com.br"
    echo "  Histórico:   ${DEPLOYMENTS_FILE}"
    exit 0
  else
    echo ""
    rollback "$NEW_SHA"
    exit $?
  fi
else
  err "deploy_services falhou"
  rollback "$NEW_SHA"
  exit $?
fi
