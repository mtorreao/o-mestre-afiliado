# ─── Stage 1: Build admin-web ────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN cd /app && bun install
RUN cd /app/apps/admin-web && bun run build

# ─── Stage 2: Serve via nginx ────────────────────────────────────────────
FROM nginx:1.27-alpine AS admin-web

# Proxy reverso: /api → admin-api (mesma rede docker)
RUN echo 'server {' > /etc/nginx/conf.d/default.conf && \
    echo '  listen 9091;' >> /etc/nginx/conf.d/default.conf && \
    echo '  root /usr/share/nginx/html;' >> /etc/nginx/conf.d/default.conf && \
    echo '  index index.html;' >> /etc/nginx/conf.d/default.conf && \
    echo '  location /api/ {' >> /etc/nginx/conf.d/default.conf && \
    echo '    proxy_pass http://admin-api:9090;' >> /etc/nginx/conf.d/default.conf && \
    echo '    proxy_set_header Host $host;' >> /etc/nginx/conf.d/default.conf && \
    echo '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' >> /etc/nginx/conf.d/default.conf && \
    echo '  }' >> /etc/nginx/conf.d/default.conf && \
    echo '  location / {' >> /etc/nginx/conf.d/default.conf && \
    echo '    try_files $uri $uri/ /index.html;' >> /etc/nginx/conf.d/default.conf && \
    echo '  }' >> /etc/nginx/conf.d/default.conf && \
    echo '}' >> /etc/nginx/conf.d/default.conf

COPY --from=builder /app/apps/admin-web/dist /usr/share/nginx/html

EXPOSE 9091
CMD ["nginx", "-g", "daemon off;"]
