# ─── Stage 1: Build Dispatcher ──────────────────────────────────────────
FROM oven/bun:1.3-slim AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/dispatcher && bun run build

# ─── Stage 2: Run Dispatcher ────────────────────────────────────────────
FROM oven/bun:1.3-slim

WORKDIR /app
COPY --from=builder /app/apps/dispatcher/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

ENV METRICS_PORT=9093
EXPOSE 9093

CMD ["bun", "run", "/app/dist/index.js"]