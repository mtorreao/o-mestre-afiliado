# =============================================================================
# scripts/deploy-local.sh — deploy local o-mestre-afiliado + Cloudflare Tunnel
# =============================================================================
# Uso:
#   bash scripts/deploy-local.sh up        # sobe (assume imagens já construídas)
#   bash scripts/deploy-local.sh rebuild   # build + sobe
#   bash scripts/deploy-local.sh stop      # para tudo
#
# Pré-requisitos:
#   - Docker Desktop rodando
#   - .env.infra na raiz (com EVOLUTION_API_KEY)
#   - Cloudflare Tunnel configurado (tunnel omestre-afiliado)
#   - Porta 5441 livre (web), 5442 (api)
#
# Gates:
#   1. bun run build — compila todos os apps
#   2. bun run test:e2e — testes E2E
#   Se qualquer um falhar, o deploy é abortado.
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ─── Cores ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}==>${NC} $1"; }
ok()    { echo -e "${GREEN}✅${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠️ $1${NC}"; }
err()   { echo -e "${RED}❌${NC} $1"; }

# ─── Help ─────────────────────────────────────────────────────────────────
if [ $# -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  echo "Uso: bash scripts/deploy-local.sh {up|rebuild|stop}"
  exit 0
fi

ACTION="$1"

# ─── Verificar Docker ─────────────────────────────────────────────────────
info "Verificando Docker..."
if ! docker info >/dev/null 2>&1; then
  warn "Docker não está rodando. Iniciando Docker Desktop..."
  powershell.exe -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"
  echo "Aguardando Docker ficar pronto..."
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      ok "Docker pronto"
      break
    fi
    sleep 2
  done
  if ! docker info >/dev/null 2>&1; then
    err "Docker não iniciou após 2 minutos. Abortando."
    exit 1
  fi
fi
ok "Docker rodando"

# ─── .env.infra ───────────────────────────────────────────────────────────
if [ ! -f .env.infra ]; then
  warn ".env.infra não encontrado. Criando template..."
  cat > .env.infra << 'ENVEOF'
# Infra ports override (5443 is held by Docker Desktop)
POSTGRES_PORT=127.0.0.1:5446:5432
EVOLUTION_API_PORT=127.0.0.1:5444:8080
EVOLUTION_MANAGER_PORT=127.0.0.1:5447:80
EVOLUTION_REDIS_PORT=127.0.0.1:5445:6379

# Evolution API authentication
EVOLUTION_API_KEY=<COLOQUE_SUA_KEY_AQUI>
ENVEOF
  err ".env.infra criado como template. Edite com sua EVOLUTION_API_KEY e execute novamente."
  exit 1
fi

# ─── stop ─────────────────────────────────────────────────────────────────
if [ "$ACTION" = "stop" ]; then
  info "Parando tudo..."
  docker compose -f docker-compose.infra.yml --env-file .env.infra down --remove-orphans 2>/dev/null || true
  docker compose down --remove-orphans 2>/dev/null || true
  ok "Tudo parado"
  exit 0
fi

# ─── Gates: build + testes ────────────────────────────────────────────────
if [ "$ACTION" = "rebuild" ]; then
  info "Gate 1/2: Build..."
  if ! bun run build; then
    err "Build falhou. Abortando deploy."
    exit 1
  fi
  ok "Build passou"

  info "Gate 2/2: Testes E2E..."
  if ! bun run test:e2e; then
    err "Testes E2E falharam. Abortando deploy."
    exit 1
  fi
  ok "Testes E2E passaram"

  info "Rebuildando imagens Docker..."
  docker compose build --no-cache api web
fi

# ─── Subir infra ──────────────────────────────────────────────────────────
info "Subindo infra (postgres + redis + evolution)..."
docker compose -f docker-compose.infra.yml --env-file .env.infra up -d postgres redis evolution-api 2>/dev/null || \
  docker compose -f docker-compose.infra.yml --env-file .env.infra up -d postgres redis evolution-api

# ─── Subir app ────────────────────────────────────────────────────────────
info "Subindo app (api + web)..."
docker compose up -d api web

# ─── Aguardar healthchecks ───────────────────────────────────────────────
info "Aguardando healthchecks..."
for i in $(seq 1 30); do
  API_HEALTH=$(docker inspect omestre_api --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
  WEB_OK=$(docker inspect omestre_web --format '{{.State.Status}}' 2>/dev/null || echo "absent")
  echo "  api=$API_HEALTH web=$WEB_OK"
  if [ "$API_HEALTH" = "healthy" ] && [ "$WEB_OK" = "running" ]; then
    break
  fi
  sleep 3
done

# ─── Verificação final ────────────────────────────────────────────────────
API_OK=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5442/health 2>/dev/null || echo "000")
WEB_OK=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5441/ 2>/dev/null || echo "000")

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy concluído!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo "  API health:    http://localhost:5442/health → $API_OK"
echo "  Web:           http://localhost:5441 → $WEB_OK"
echo "  App público:   https://dev.omestreafiliado.com.br"
echo ""
echo "  Infra:"
echo "    PostgreSQL:   localhost:5446"
echo "    Redis:        localhost:5445"
echo "    Evolution:    localhost:5444"
echo ""
echo "  Para parar tudo: bash scripts/deploy-local.sh stop"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
