# ─── Stage 1: Build admin-api ────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/admin-api && bun run build

# ─── Stage 2: Run admin-api ──────────────────────────────────────────────
FROM oven/bun:1.3 AS admin-api

WORKDIR /app
COPY --from=builder /app/apps/admin-api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 9090
CMD ["bun", "run", "/app/dist/index.js"]
