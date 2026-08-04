#!/usr/bin/env bash
# =============================================================================
# scripts/rollback-prod.sh — Rollback manual do O Mestre Afiliado
# =============================================================================
# Uso:
#   bash scripts/rollback-prod.sh              # rollback p/ última versão active
#   bash scripts/rollback-prod.sh v0.4.1       # rollback p/ tag específica
#
# Lê /var/lib/oma/deployments.json, escolhe a versão ativa anterior
# (ou a tag passada) e re-executa o deploy daquele código.
#
# Exit codes:
#   0 = rollback OK
#   1 = falha de validação (tag não encontrada, sem histórico)
#   2 = rollback falhou (deploy do código antigo falhou)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}==>${NC} $1"; }
ok()   { echo -e "${GREEN}✅${NC} $1"; }
err()  { echo -e "${RED}❌${NC} $1"; }

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOYMENTS_FILE="/var/lib/oma/deployments.json"
TARGET_TAG="${1:-}"

if [ ! -f "$DEPLOYMENTS_FILE" ]; then
  err "Histórico de deploys não encontrado em ${DEPLOYMENTS_FILE}"
  exit 1
fi

# ─── Escolhe a tag alvo ──────────────────────────────────────────────────────
if [ -n "$TARGET_TAG" ]; then
  if ! git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/${TARGET_TAG}" >/dev/null 2>&1; then
    err "Tag '${TARGET_TAG}' não encontrada no repo."
    exit 1
  fi
  ROLLBACK_TAG="$TARGET_TAG"
  info "Rollback manual para tag explícita: ${ROLLBACK_TAG}"
else
  ROLLBACK_TAG=$(jq -r "[.[] | select(.status == \"active\")][-1].tag // empty" "$DEPLOYMENTS_FILE" 2>/dev/null || echo "")
  if [ -z "$ROLLBACK_TAG" ]; then
    err "Nenhuma versão 'active' encontrada no histórico. Use: bash scripts/rollback-prod.sh <tag>"
    exit 1
  fi
  info "Rollback para última versão active: ${ROLLBACK_TAG}"
fi

# ─── Mostra histórico atual ──────────────────────────────────────────────────
echo ""
info "Histórico de deploys (últimas 5):"
jq -r '.[-5:] | reverse | .[] | "  \(.tag)  \(.sha)  \(.deployed_at)  [\(.status)]"' \
  "$DEPLOYMENTS_FILE" 2>/dev/null || cat "$DEPLOYMENTS_FILE"
echo ""

# ─── Deploy do código da tag antiga ─────────────────────────────────────────
# Reusa o deploy-prod.sh (mesmo fluxo idempotente)
info "Executando deploy da tag ${ROLLBACK_TAG}..."
bash "$ROOT_DIR/scripts/deploy-prod.sh" "$ROLLBACK_TAG"
exit $?
