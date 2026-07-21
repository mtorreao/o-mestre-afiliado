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
    echo 'PG_URL=$(echo "$POSTGRES_URL" | sed "s/.*evolution:\(.*\)@.*/\1/" | cut -d@ -f1)' >> /entrypoint.sh && \
    echo 'PG_HOST=$(echo "$POSTGRES_URL" | sed "s/.*@//" | sed "s/:.*//")' >> /entrypoint.sh && \
    echo 'PG_PORT=$(echo "$POSTGRES_URL" | sed "s/.*://" | sed "s/\\/.*//")' >> /entrypoint.sh && \
    echo 'for f in $(ls $MIGRATIONS_DIR/*.sql | sort); do' >> /entrypoint.sh && \
    echo '  echo "  Running $(basename $f)..."' >> /entrypoint.sh && \
    echo '  cat "$f" | PGPASSWORD=evolution_pass psql -h postgres-e2e -p 5432 -U evolution -d omestre_db -f - 2>&1 | grep -v "NOTICE\\|CREATE\\|ALTER\\|INSERT 0" || true' >> /entrypoint.sh && \
    echo 'done' >> /entrypoint.sh && \
    echo 'echo "✅ Migrations concluídas"' >> /entrypoint.sh && \
    echo 'echo "🚀 Iniciando API..."' >> /entrypoint.sh && \
    echo 'exec bun run /app/dist/index.js' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

EXPOSE 5442
CMD ["/entrypoint.sh"]
