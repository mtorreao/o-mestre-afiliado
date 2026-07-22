# ─── Stage 1: Build Worker ─────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/worker && bun run build

# ─── Stage 2: Run Worker ──────────────────────────────────────────────
FROM oven/bun:1.3

WORKDIR /app
COPY --from=builder /app/apps/worker/dist ./dist

# Porta de métricas e healthcheck (configurável via METRICS_PORT)
EXPOSE 9092
CMD ["bun", "run", "dist/index.js"]
