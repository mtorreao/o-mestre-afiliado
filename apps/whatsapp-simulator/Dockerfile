# WhatsApp Simulator — substituto da Evolution API para testes E2E
FROM oven/bun:1.3 AS builder

WORKDIR /app
COPY apps/whatsapp-simulator/package.json ./
RUN bun install
COPY apps/whatsapp-simulator/src ./src
RUN bun build src/index.ts --outdir=dist --target=bun

FROM oven/bun:1.3
WORKDIR /app
COPY --from=builder /app/dist ./dist
EXPOSE 8080
CMD ["bun", "run", "dist/index.js"]
