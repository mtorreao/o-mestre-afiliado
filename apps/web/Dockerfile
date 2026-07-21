# ─── Stage 1: Build Web ───────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/web/ apps/web/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/web && bun run build

# ─── Stage 2: Serve com nginx ─────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template

# Use envsubst para injetar API_UPSTREAM no nginx.conf
ENV API_UPSTREAM=api:5442
EXPOSE 5441
CMD ["/bin/sh", "-c", "envsubst '${API_UPSTREAM}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
