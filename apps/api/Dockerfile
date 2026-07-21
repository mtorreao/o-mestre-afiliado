# ─── Stage 1: Build API ────────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/api && bun run build

# ─── Stage 2: Run API ──────────────────────────────────────────────────
FROM oven/bun:1.3 AS api

RUN apt-get update -qq && apt-get install -y -qq postgresql-client 2>/dev/null && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/packages/db/src/migrations ./migrations
COPY --from=builder /app/node_modules ./node_modules

# Script de entrypoint: aplica migrations via psql + inicia API
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'echo "⏳ Aplicando migrations..."' >> /entrypoint.sh && \
    echo 'MIGRATIONS_DIR=/app/migrations' >> /entrypoint.sh && \
    echo 'PG_URL="${POSTGRES_URL:-}"' >> /entrypoint.sh && \
    echo 'if [ -z "$PG_URL" ]; then' >> /entrypoint.sh && \
    echo '  PG_HOST="${POSTGRES_HOST:-postgres}"' >> /entrypoint.sh && \
    echo '  PG_PORT="${POSTGRES_PORT:-5432}"' >> /entrypoint.sh && \
    echo '  PG_USER="${POSTGRES_USERNAME:-evolution}"' >> /entrypoint.sh && \
    echo '  PG_PASS="${POSTGRES_PASSWORD:-evolution_pass}"' >> /entrypoint.sh && \
    echo '  PG_DB="${POSTGRES_DATABASE:-omestre_db}"' >> /entrypoint.sh && \
    echo 'else' >> /entrypoint.sh && \
    echo '  PG_HOST=$(echo "$PG_URL" | sed "s/.*@//" | sed "s/:.*//")' >> /entrypoint.sh && \
    echo '  PG_PORT=$(echo "$PG_URL" | sed "s/.*://" | sed "s/\\\\/.*//")' >> /entrypoint.sh && \
    echo '  PG_USER=$(echo "$PG_URL" | sed "s/.*\\/\\///" | sed "s/:.*//")' >> /entrypoint.sh && \
    echo '  PG_PASS=$(echo "$PG_URL" | sed "s/.*:/\//" | sed "s/@.*//")' >> /entrypoint.sh && \
    echo '  PG_DB=$(echo "$PG_URL" | sed "s/.*\\///" | sed "s/\\?.*//")' >> /entrypoint.sh && \
    echo 'fi' >> /entrypoint.sh && \
    echo 'PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "CREATE SCHEMA IF NOT EXISTS ${POSTGRES_SCHEMA:-omestre}" 2>/dev/null || true' >> /entrypoint.sh && \
    echo 'for f in $(ls $MIGRATIONS_DIR/*.sql 2>/dev/null | sort); do' >> /entrypoint.sh && \
    echo '  echo "  Running $(basename $f)..."' >> /entrypoint.sh && \
    echo '  PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -f "$f" 2>&1 | grep -v "NOTICE\\\\|CREATE\\\\|ALTER\\\\|INSERT 0" || true' >> /entrypoint.sh && \
    echo 'done' >> /entrypoint.sh && \
    echo 'echo "✅ Migrations concluídas"' >> /entrypoint.sh && \
    echo 'echo "🚀 Iniciando API..."' >> /entrypoint.sh && \
    echo 'exec bun run /app/dist/index.js' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

EXPOSE 5442
CMD ["/entrypoint.sh"]
