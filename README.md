# 🦸 O Mestre Afiliado

Conversor de links de afiliados para **Shopee** e **Mercado Livre**. Gera links curtos (`meli.la`) quando possível, com fallback para URL params.

---

## 📦 Estrutura (Monorepo)

```
o-mestre-afiliado/
├── apps/
│   ├── api/          # Elysia API (:5442) — endpoints REST de conversão
│   ├── worker/       # Background worker — fila de processamento em lote
│   └── web/          # React + Vite (:5441) — interface web
├── packages/
│   ├── shared/       # Tipos e constantes compartilhados
│   ├── converters/   # Lógica de conversão (Shopee, ML link curto + URL params)
│   └── db/           # Schema Drizzle + PostgreSQL
├── extensions/
│   └── chrome-cookie-importer/  # Extensão Chrome p/ importar cookies de sessão ML
├── assets/logos/     # Logos do projeto
├── data/             # Store de afiliados (ml-affiliates.json)
├── docs/             # Documentação das APIs de marketplace
└── scripts/          # Scripts auxiliares (dev.ts)
```

---

## 🚀 Começando

```bash
# Instalar dependências
bun install

# Copiar env vars
cp .env.example .env
# Edite .env com suas credenciais

# Ambiente Docker isolado pela branch atual
bun run dev

# Inspecionar o slug e as portas sem subir containers
bun run scripts/dev.ts --dry-run

# Subir sem Cloudflare Tunnel
SKIP_TUNNEL=1 bun run dev

# DNS automático opcional (token da conta que possui omestreafiliado.com.br)
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... bun run dev
```

---

## 📡 Worker Monitoring

A web app expõe uma **tela de monitoramento de saúde e performance** dos workers
(`/worker-status`): pipeline de espelhamento, resumo de saúde, métricas detalhadas
do Ingestor e do Dispatcher, e a **Dead Letter Queue (DLQ)** em destaque com gestão inline.

### Endpoints de monitoramento (API)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/worker/status` | Status agregado de Ingestor + Dispatcher (uptime, modo, queue size, DLQ count, step durations, erros recentes, counters Prometheus) |
| GET | `/api/worker/dlq` | Lista a DLQ com filtros server-side (ver abaixo) |
| POST | `/api/worker/dlq/requeue?id=ID` | Re-enfileira um item na fila original (Queue A ou B conforme origem) |
| POST | `/api/worker/dlq/remove?id=ID` | Remove um item da DLQ |
| POST | `/api/worker/dlq/purge` | Remove **todos** os itens da DLQ |

#### `GET /api/worker/dlq` — parâmetros de filtro

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `offset` | number | Paginação (default `0`) |
| `limit` | number | Itens por página (default `20`; sobe para `100` quando há filtro ativo) |
| `queue` | `A` \| `B` | Filtra pela fila de origem — `A` = Ingestor (RawMessageEvent), `B` = Dispatcher (SendEvent) |
| `reason` | string | Filtra por `failureReason` exato (ex: `conversion_failed`) |
| `since` | ISO ou relativo | Filtra por data de falha. Aceita ISO (`2026-07-20T00:00:00Z`) ou duração relativa `Nh`/`Nd` (ex: `1h`, `24h`, `7d`) |

**Resposta:**
```json
{
  "success": true,
  "items": [ { "id": "...", "failureReason": "conversion_failed", "failedAt": "...", "event": { ... } } ],
  "total": 800,        // total REAL da DLQ (zcard), usado pelo badge do header
  "totalFiltered": 782, // total APÓS aplicar os filtros acima (igual a total quando sem filtro)
  "offset": 0,
  "limit": 100
}
```

> A tela faz **auto-refresh a cada 30s** (switch "Auto" próprio na seção DLQ,
> independente do auto-refresh global do header). Quando o total cresce entre
> polls, o badge da DLQ pulsa para chamar atenção.

---

## 🔧 Scripts CLI

```bash
# Shopee
bun run shopee <url_do_produto>

# Mercado Livre
bun run ml <url_do_produto>
```

---

## 📡 API Endpoints

### Conversão padrão (usa .env)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Info do serviço |
| GET | `/health` | Health check |
| POST | `/api/convert` | Converte URL (usa credenciais do .env) |
| GET | `/docs` | Swagger UI |

### Mercado Livre — Multi-afiliado

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/ml/auth` | Iniciar fluxo OAuth |
| GET | `/api/ml/callback` | Callback OAuth |
| GET | `/api/ml/affiliates` | Listar afiliados conectados |
| PUT | `/api/ml/affiliates/:mlUserId` | Atualizar config (meliid, melitat, sessionCookies) |
| DELETE | `/api/ml/affiliates/:mlUserId` | Remover afiliado |
| POST | `/api/ml/convert` | Converter link (usa afiliado selecionado) |
| POST | `/api/ml/refresh` | Refresh token OAuth |

### Exemplo de conversão

```bash
# Com cookies de sessão → link curto meli.la
curl -X POST http://localhost:5442/api/ml/convert \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.mercadolivre.com.br/produto/p/MLB123", "mlUserId": "119874802"}'

# Resposta:
# { "success": true, "affiliateUrl": "https://meli.la/2DSBbLg", "method": "api" }
```

---

## 🍪 Extensão Chrome — Cookie Importer

Para gerar **links curtos** (`meli.la`), o backend precisa de cookies de sessão do ML
(incluindo HttpOnly). A extensão lê esses cookies com `chrome.cookies.getAll()`.

### Instalação

1. Abra `chrome://extensions/`
2. Ative **"Modo do desenvolvedor"**
3. Clique em **"Carregar sem compactação"**
4. Selecione `extensions/chrome-cookie-importer/`

### Uso

1. Faça login no `mercadolivre.com.br`
2. Clique no ícone 🍪 da extensão
3. Selecione o afiliado e clique em **"Importar Cookies"**
4. Agora o protótipo gera links curtos pra essa conta

---

## 🧱 Store de Afiliados

`data/ml-affiliates.json` — cada afiliado conectado via OAuth tem seus dados:

```json
{
  "119874802": {
    "nickname": "M.TORREAO",
    "accessToken": "APP_USR-...",
    "melitat": "mtorreao",
    "sessionCookies": "ml_affiliates_hub_visit_count=2; _csrf=...",
    "...": "..."
  }
}
```

### Formatos de link

| Formato | Quando | Exemplo |
|---------|--------|---------|
| Link curto | Cookies de sessão configurados | `https://meli.la/2DSBbLg` |
| Novo formato | Só melitat configurado | `...?matt_word=mtorreao&matt_tool=71835809` |
| Formato antigo | meliid + melitat configurados | `...?meliid=...&melitat=om895584` |

---

## 🛠️ Stack

- **Runtime:** [Bun](https://bun.sh) 1.3+
- **Monorepo:** Bun workspaces
- **API:** [Elysia](https://elysiajs.com/)
- **Web:** React 19 + Vite 6
- **Worker:** Bun runtime (processamento background)
- **Database:** PostgreSQL 17 + Drizzle ORM
- **Cache:** Redis 7
- **WhatsApp:** Evolution API (Baileys)
- **Extensão:** Chrome Manifest V3
- **Language:** TypeScript 5 (strict mode)
