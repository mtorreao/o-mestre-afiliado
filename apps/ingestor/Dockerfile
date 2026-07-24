FROM oven/bun:1.3-slim AS builder
WORKDIR /app

# Copia apenas os arquivos de dependência primeiro (cache de layer)
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/converters/package.json packages/converters/
COPY packages/db/package.json packages/db/
COPY packages/worker-common/package.json packages/worker-common/
COPY apps/ingestor/package.json apps/ingestor/

RUN bun install --frozen-lockfile

# Copia o código fonte
COPY tsconfig.json .
COPY packages/shared/ packages/shared/
COPY packages/converters/ packages/converters/
COPY packages/db/ packages/db/
COPY packages/worker-common/ packages/worker-common/
COPY apps/ingestor/ apps/ingestor/

WORKDIR /app/apps/ingestor
RUN bun run build

FROM oven/bun:1.3-slim
WORKDIR /app

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/ingestor/dist /app/dist
COPY --from=builder /app/blacklist.json /app/blacklist.json
COPY --from=builder /app/whitelist.json /app/whitelist.json

ENV METRICS_PORT=9092
EXPOSE 9092

CMD ["bun", "run", "/app/dist/index.js"]