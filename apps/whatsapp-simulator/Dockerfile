# WhatsApp Simulator — substituto da Evolution API para testes E2E
#
# IMPORTANTE: o simulador depende de `elysia` via `catalog:` no package.json.
# Esse catálogo só é resolvido dentro do workspace Bun (root package.json),
# então `bun install` precisa rodar no /app do root, não isolado.
FROM oven/bun:1.3 AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/whatsapp-simulator && bun run build

FROM oven/bun:1.3
WORKDIR /app
COPY --from=builder /app/apps/whatsapp-simulator/dist ./dist
EXPOSE 8080
CMD ["bun", "run", "dist/index.js"]