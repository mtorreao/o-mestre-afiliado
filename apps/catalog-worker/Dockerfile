# ─── Stage 1: Build CatalogWorker ────────────────────────────────────
FROM oven/bun:1.3-slim AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/catalog-worker && bun run build

# ─── Stage 2: Run CatalogWorker ──────────────────────────────────────
FROM oven/bun:1.3-slim

WORKDIR /app
COPY --from=builder /app/apps/catalog-worker/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

ENV METRICS_PORT=9094
EXPOSE 9094

CMD ["bun", "run", "/app/dist/index.js"]
