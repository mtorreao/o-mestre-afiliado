FROM oven/bun:1.3-slim AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/worker-common/package.json packages/worker-common/
COPY apps/dispatcher/package.json apps/dispatcher/

RUN bun install --frozen-lockfile

COPY tsconfig.json .
COPY packages/shared/ packages/shared/
COPY packages/db/ packages/db/
COPY packages/worker-common/ packages/worker-common/
COPY apps/dispatcher/ apps/dispatcher/

WORKDIR /app/apps/dispatcher
RUN bun run build

FROM oven/bun:1.3-slim
WORKDIR /app

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/dispatcher/dist /app/dist

ENV METRICS_PORT=9093
EXPOSE 9093

CMD ["bun", "run", "/app/dist/index.js"]