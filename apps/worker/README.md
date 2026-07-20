# ⚙️ Worker — `@omestre/worker`

> Processo background para conversão de links de afiliados em lote, com suporte a fila em memória, retry e modos de operação.

---

## 🧠 Visão Geral

O Worker mantém uma **fila em memória** de URLs para processar. Cada item da fila contém:

```typescript
interface QueueItem {
  id: string;            // UUID único
  url: string;           // URL do produto
  marketplace?: Marketplace; // Shopee | Mercado Livre | unknown
  retries: number;       // Tentativas já realizadas
  status: 'pending' | 'processing' | 'done' | 'failed';
  result?: ConversionResult; // Resultado da conversão
  error?: string;        // Mensagem de erro (se falhou)
  createdAt: string;     // Timestamp ISO
}
```

---

## 🎮 Modos de Operação

### 1. Polling (default)

O worker fica rodando continuamente, checando a fila a cada `WORKER_POLL_INTERVAL` ms.

```bash
bun run dev:worker
```

Comportamento:
- A cada ciclo, pega itens `pending` que não estão sendo processados
- Processa até `WORKER_CONCURRENCY` itens em paralelo
- Itens com falha são retentados até `WORKER_MAX_RETRIES` vezes
- Logs em JSON são emitidos para stdout

### 2. Batch

Processa URLs passadas como argumentos e encerra.

```bash
bun run --cwd apps/worker dev --batch "https://shopee.com.br/prod/1" "https://mercadolivre.com.br/prod/2"
```

Útil para:
- Processamento programado (cron jobs)
- Pipelines CI/CD
- Scripts shell

### 3. Once

Executa **um único ciclo** de polling e encerra.

```bash
bun run --cwd apps/worker dev --once
```

Útil para:
- Testes
- Integração com agendadores externos (systemd timers, cron)

---

## 🔧 Configuração

| Variável | Default | Descrição |
|----------|---------|-----------|
| `WORKER_POLL_INTERVAL` | `30000` (30s) | Intervalo entre ciclos de polling (ms) |
| `WORKER_MAX_RETRIES` | `3` | Máximo de tentativas por URL |
| `WORKER_CONCURRENCY` | `5` | URLs processadas simultaneamente |

### Exemplo `.env`

```env
WORKER_POLL_INTERVAL=60000
WORKER_MAX_RETRIES=5
WORKER_CONCURRENCY=10
```

---

## 📤 API Pública

O worker exporta funções para uso programático:

```typescript
import { enqueue, getQueueStatus } from '@omestre/worker';

// Adicionar URL à fila
const id = enqueue('https://shopee.com.br/prod/123');

// Ver status da fila
const status = getQueueStatus();
console.log(status);
// [{ id: 'uuid', url: '...', status: 'done', result: {...}, ... }]
```

---

## 📋 Logs

Todos os logs são emitidos em **formato JSON** para stdout, facilitando integração com sistemas de logging estruturado (Datadog, ELK, CloudWatch):

```json
{"timestamp":"2026-07-20T16:55:00.000Z","level":"info","service":"worker","message":"URL enfileirada","data":{"id":"abc-123","url":"https://shopee.com.br/prod/1"}}
{"timestamp":"2026-07-20T16:55:01.000Z","level":"info","service":"worker","message":"URL convertida com sucesso","data":{"id":"abc-123","affiliateUrl":"https://shortlink..."}}
{"timestamp":"2026-07-20T16:55:02.000Z","level":"error","service":"worker","message":"URL falhou após todas as tentativas","data":{"id":"abc-124","error":"Credenciais não encontradas"}}
```

Níveis: `info`, `warn`, `error`.

---

## 🛑 Graceful Shutdown

O worker escuta `SIGINT` e `SIGTERM` para desligamento gracioso:

```
worker desligando...
```

Isso permite que workers em Docker/Kubernetes finalizem o processamento corrente antes de sair.

---

## 🧪 Uso com a API

O Worker pode ser combinado com a API para processamento assíncrono:

```
API (POST /api/convert)  →  retorna síncrono
Worker (polling)          →  processa URLs em fila (assíncrono)
```

Ambos compartilham o mesmo pacote `@omestre/converters`.

---

## 📦 Build para Produção

```bash
bun run build:worker
# ou
cd apps/worker && bun build src/index.ts --outdir=dist --target=bun

# Executar
bun run dist/index.js
```

---

## 🔁 Fluxo de Retry

```
URL enfileirada (status: pending)
    │
    ├── processItem() — sucesso → status: done ✓
    │
    └── processItem() — erro
        ├── retries < MAX_RETRIES
        │   └── status: pending (volta pra fila) ↻
        └── retries >= MAX_RETRIES
            └── status: failed ✗
```
