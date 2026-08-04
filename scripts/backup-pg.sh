#!/usr/bin/env bash
# =============================================================================
# scripts/backup-pg.sh — Backup automático do Postgres (O Mestre Afiliado)
# =============================================================================
# Executado via cron no VPS (ver /etc/cron.d/oma-pg-backup). Faz pg_dump dos
# schemas omestre + evolution_api (a sessão WhatsApp vive no evolution_api —
# perder o histórico de grupos é irrecuperável).
#
# Uso:
#   bash scripts/backup-pg.sh              # backup agora + retenção
#   bash scripts/backup-pg.sh --list       # lista backups existentes
#   bash scripts/backup-pg.sh --restore <arquivo>  # restaura (avançado, manual)
#
# Exit codes:
#   0 = backup OK (ou container não existe — nada a fazer)
#   1 = erro
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}==>${NC} $1"; }
ok()   { echo -e "${GREEN}✅${NC} $1"; }
warn() { echo -e "${YELLOW}⚠️ $1${NC}"; }
err()  { echo -e "${RED}❌${NC} $1"; }

CONTAINER="omestre_postgres"
DB_USER="evolution"
DB_NAME="omestre_db"
SCHEMAS="omestre evolution_api"
BACKUP_DIR="/var/backups/oma-pg"
RETENTION_DAYS=7
DATE_STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/oma-${DATE_STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# ─── Listar ──────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--list" ]; then
  echo "Backups em ${BACKUP_DIR}:"
  ls -lh "$BACKUP_DIR"/oma-*.sql.gz 2>/dev/null || echo "  (nenhum)"
  exit 0
fi

# ─── Restore (manual, avançado) ─────────────────────────────────────────────
if [ "${1:-}" = "--restore" ]; then
  if [ -z "${2:-}" ]; then err "Uso: bash scripts/backup-pg.sh --restore <arquivo>"; exit 1; fi
  if [ ! -f "$2" ]; then err "Arquivo não encontrado: $2"; exit 1; fi
  warn "Restaurando $2 no container ${CONTAINER} (irá SOBRESCREVER o banco!)"
  read -rp "Confirmar? (digite 'SIM'): " confirm
  if [ "$confirm" != "SIM" ]; then err "Cancelado"; exit 1; fi
  # drop schema cascade + recreate, depois restore
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
    "DROP SCHEMA IF EXISTS omestre CASCADE; DROP SCHEMA IF EXISTS evolution_api CASCADE;" 2>&1 || true
  gunzip -c "$2" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" 2>&1
  ok "Restore concluído (schemas omestre + evolution_api)"
  exit 0
fi

# ─── Guard: container existe? ────────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  warn "Container ${CONTAINER} não está rodando — backup pulado (nada a fazer)."
  exit 0
fi

# ─── Backup ──────────────────────────────────────────────────────────────────
info "Backup do Postgres (${SCHEMAS}) → ${BACKUP_FILE}..."
# -Fc = formato custom (comprimido nativo, restaura com pg_restore)
# schemas: omestre (app) + evolution_api (sessão WhatsApp — crítico)
if docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
    -n omestre -n evolution_api -Fc | gzip > "$BACKUP_FILE"; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  ok "Backup OK: ${BACKUP_FILE} (${SIZE})"
else
  rm -f "$BACKUP_FILE"
  err "Backup falhou — arquivo removido"
  exit 1
fi

# ─── Retenção ────────────────────────────────────────────────────────────────
info "Retenção: removendo backups com mais de ${RETENTION_DAYS} dias..."
DELETED=$(find "$BACKUP_DIR" -name "oma-*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  ok "Removidos ${DELETED} backup(s) antigo(s)"
else
  ok "Nenhum backup antigo para remover"
fi

exit 0
