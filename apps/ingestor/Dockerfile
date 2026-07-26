# ─── Stage 1: Build Ingestor ────────────────────────────────────────────
FROM oven/bun:1.3-slim AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/ingestor && bun run build

# ─── Stage 2: Run Ingestor ──────────────────────────────────────────────
FROM oven/bun:1.3-slim

WORKDIR /app
COPY --from=builder /app/apps/ingestor/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Chromium para resolução de /social/ do ML (headless browser)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV METRICS_PORT=9092
EXPOSE 9092

CMD ["bun", "run", "/app/dist/index.js"]