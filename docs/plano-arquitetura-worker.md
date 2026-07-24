# Plano: Nova Arquitetura do Worker — 2 Filas, 2 Processadores

## Problema

O worker atual centraliza tudo num único processo: recebe a mensagem do Redis Stream, executa o pipeline pesado (extração, validação, conversão, template) e envia para a Evolution API — tudo no mesmo lugar. Isso impede:

- Processar mensagens para múltiplos afiliados que monitoram o mesmo grupo fonte
- Separar a preocupação de rate limiting do pipeline pesado
- Ter visibilidade granular de onde o tempo é gasto em cada etapa
- Paralelizar de forma segura respeitando instâncias WhatsApp

---

## Arquitetura Proposta

```
Evolution API webhook (messages.upsert)
  │
  │ API publica RawMessageEvent na Queue A
  ▼
┌──────────────────────────────────────────────────────┐
│  QUEUE A — omestre:mirror:raw                        │
│  Consumer Group: mirror-raw                          │
│  Mensagens CRUAS dos grupos fonte                    │
└──────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────┐
│  INGESTOR — ingestor.ts             │
│                                                        │
│  1. Dedup (messageId + sourceGroupJid)                │
│  2. Extract URL marketplace                           │
│  3. Blacklist / Whitelist global                      │
│  4. Dedup 24h (original URL no banco)                 │
│  5. Resolve redirect (Promozone)                      │
│  6. Fetch product image (obrigatório)                 │
│  7. Busca afiliados do sourceGroup (cache 1:N)        │
│  8. Para CADA afiliado (fan-out):                     │
│     ├─ Converte link com credenciais do afiliado      │
│     ├─ Verifica link (safety)                         │
│     ├─ Monta template                                 │
│     └─ Publica SendEvent na Queue B                   │
│  9. ACK na Queue A                                    │
└──────────────────────────────────────────────────────┘
  │
  │ SendEvent: { instanceName, targetGroupJid, text, imageUrl, ... }
  ▼
┌──────────────────────────────────────────────────────┐
│  QUEUE B — omestre:mirror:send                       │
│  Consumer Group: mirror-send                         │
│  Mensagens PRONTAS para enviar                        │
└──────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────┐
│  DISPATCHER — dispatcher.ts                           │
│                                                        │
│  Única responsabilidade:                              │
│  1. Busca SendEvent da Queue B                        │
│  2. Rate limit (instância + sub-rate grupo)           │
│  3. Envia via Evolution API (sendMedia ou sendText)   │
│  4. Registra em reflected_offers                      │
│  5. Retry 3x / DLQ se falhar                          │
│  6. ACK na Queue B                                    │
└──────────────────────────────────────────────────────┘
```

---

## 1. Redis Streams — 2 Filas

### Queue A — Raw Messages

| Propriedade | Valor |
|---|---|
| Nome do stream | `omestre:mirror:raw` |
| Consumer group | `mirror-raw` |
| Payload | `RawMessageEvent` (sem afiliado resolvido) |
| COUNT | 10 |
| BLOCK | 5000ms |

```typescript
interface RawMessageEvent {
  /** ID único da mensagem no WhatsApp */
  messageId: string;
  /** Nome da instância Evolution que recebeu (ex: "user-1") */
  instanceName: string;
  /** JID do grupo de origem */
  sourceGroupJid: string;
  /** Nome do grupo de origem */
  sourceGroupName: string;
  /** Texto extraído da mensagem */
  text: string;
  /** Timestamp da mensagem original (unix seconds) */
  timestamp: number;
}
```

**Mudança na API (webhook):** o webhook não precisa mais saber de `affiliateId` ou `mirrorId`. Ele só identifica o `sourceGroupJid` e publica o evento cru.

### Queue B — Send Events

| Propriedade | Valor |
|---|---|
| Nome do stream | `omestre:mirror:send` |
| Consumer group | `mirror-send` |
| Payload | `SendEvent` (já processado, link convertido, template montado) |
| COUNT | 10 |
| BLOCK | 5000ms |

```typescript
interface SendEvent {
  /** UUID do evento de envio */
  id: string;
  /** messageId original da mensagem fonte */
  sourceMessageId: string;
  /** sourceGroupJid original */
  sourceGroupJid: string;
  /** ID do mirror (entidade que contém targetGroup, instanceName, etc.) */
  mirrorId: number;
  /** Template de mensagem já resolvido */
  text: string;
  /** URL da imagem de capa do produto */
  imageUrl: string;
  /** Marketplace detectado */
  marketplace: string;
  /** URL original extraída */
  originalUrl: string;
  /** Link convertido para afiliado */
  convertedUrl: string;

  // instanceName, targetGroupJid, targetGroupName, affiliateId
  // são resolvidos pelo Dispatcher a partir do mirrorId
}
```

---

## 2. Cache Redis — SourceGroup 1:N

**Antes:** 1 sourceGroup → 1 afiliado

```
mirror:source-group:{jid} → { affiliateId: 1, mirrorId: 5, groupName: "Ofertas" }
```

**Agora:** 1 sourceGroup → N afiliados (instâncias diferentes)

```
mirror:source-group:{jid} → [
  { affiliateId: 1, mirrorId: 5, instanceName: "user-1", groupName: "Ofertas" },
  { affiliateId: 2, mirrorId: 8, instanceName: "user-2", groupName: "Ofertas" }
]
```

### Dedup de webhooks (API)

**Problema:** duas ou mais instâncias WhatsApp podem estar no **mesmo grupo fonte**. Quando uma mensagem chega, cada instância dispara um webhook. Sem dedup, o Ingestor receberia 2 `RawMessageEvent` idênticos (mesmo `messageId` + `sourceGroupJid`). Mas se deduplicar por `messageId` + `sourceGroupJid` no Ingestor, o segundo webhook é descartado e **perdemos o fan-out para o segundo afiliado**.

**Solução:** deduplicar na **API** (webhook), antes de publicar na Queue A. A chave é global (não por instância):

```
Chave:   mirror:webhook-dedup:{sourceGroupJid}:{messageId}
Valor:   "1"
TTL:     30 segundos
```

**Fluxo no webhook:**

```typescript
// apps/api/src/modules/webhook/webhook.routes.ts
async function handleMessageWebhook(req, res) {
  const { messageId, sourceGroupJid, text, instanceName } = extractMessage(req);

  // Dedup: verifica se já recebemos esta mensagem neste grupo
  const dedupKey = `mirror:webhook-dedup:${sourceGroupJid}:${messageId}`;
  const alreadySeen = await redis.get(dedupKey);

  if (alreadySeen) {
    // Já está na fila — descarta duplicata de outra instância
    log('info', 'Webhook duplicado ignorado (já publicado na Queue A)', {
      messageId, sourceGroupJid, instanceName,
    });
    return res.json({ success: true, deduplicated: true });
  }

  // Marca como processado (expira em 30s — tempo suficiente para
  // todas as instâncias entregarem o webhook)
  await redis.setex(dedupKey, 30, '1');

  // Publica na Queue A
  const event: RawMessageEvent = { messageId, instanceName, sourceGroupJid, sourceGroupName, text, timestamp };
  await redis.xadd(MIRROR_RAW_STREAM, '*', 'payload', JSON.stringify(event));

  res.json({ success: true });
}
```

**Efeito:** só 1 `RawMessageEvent` vai para a Queue A. O Ingestor processa **uma vez** e descobre todos os mirrors que monitoram aquele grupo via cache `mirror:source-group:{jid}` — fazendo o fan-out corretamente para todos os afiliados.

### Send-dedup (Ingestor)

**Problema:** se o Ingestor crashar após processar o fan-out parcialmente (alguns SendEvents já foram publicados na Queue B, outros não), quando reiniciar o dedup de 30s já expirou. O mesmo `RawMessageEvent` será reprocessado, gerando SendEvents duplicados para os mirrors que já haviam sido publicados.

**Solução:** verificar se já publicamos um SendEvent para aquele par `{mirrorId, sourceMessageId}`:

```
Chave:   mirror:send-dedup:{mirrorId}:{sourceMessageId}
TTL:     1 hora
```

```typescript
// Ingestor — antes de publicar cada SendEvent
for (const config of sourceConfigs) {
  const sendDedupKey = `mirror:send-dedup:${config.mirrorId}:${messageId}`;
  const alreadySent = await redis.get(sendDedupKey);
  if (alreadySent) {
    log('info', 'SendEvent já publicado — pulando (crash recovery)', {
      mirrorId: config.mirrorId, messageId,
    });
    continue;
  }

  // ... monta template, gera SendEvent ...

  // Publica na Queue B
  await redis.xadd(MIRROR_SEND_STREAM, '*', 'payload', JSON.stringify(sendEvent));

  // Marca como publicado
  await redis.setex(sendDedupKey, 3600, '1');
}
```

### Summary de chaves Redis

| Chave | Onde | TTL | Finalidade |
|---|---|---|---|---|
| `mirror:source-group:{jid}` | API + Ingestor | Renovado no acesso | Resolve 1 grupo → N mirrors |
| `mirror:webhook-dedup:{sourceJid}:{msgId}` | API (webhook) | 30s | Só 1 RawMessageEvent por mensagem |
| `mirror:send-dedup:{mirrorId}:{msgId}` | Ingestor | 1h | Evita republicar SendEvent em crash recovery |
| `mirror:send-completed:{mirrorId}:{msgId}` | Dispatcher | 24h | Evita reenvio duplicado ao grupo destino |
| `mirror:msg-dedup:{sourceJid}:{msgId}` | *(removida)* | — | Substituída pelo dedup na API (webhook-dedup) |

---

## 3. Ingestor

### Localização: `apps/worker/src/ingestor.ts`

### Fluxo detalhado

```typescript
async function processRawMessage(event: RawMessageEvent): Promise<void> {
  const { messageId, instanceName, sourceGroupJid, sourceGroupName, text } = event;

  // ── 1. Dedup rápido (messageId + sourceGroupJid) ──
  const dedupKey = `mirror:msg-dedup:${sourceGroupJid}:${messageId}`;
  const alreadyProcessed = await redis.get(dedupKey);
  if (alreadyProcessed) { /* ACK e skip */ return; }
  await redis.setex(dedupKey, 300, '1');

  // ── 2. Extrai URL ── (mesma lógica atual)
  const originalUrl = extractMarketplaceUrl(text);
  if (!originalUrl) { /* blocked: no_url */ return; }

  // ── 3. Blacklist / Whitelist ── (mesma lógica atual)
  // ...

  // ── 4. Dedup 24h (URL original) ── (mesma lógica atual)
  const marketplace = detectMarketplace(originalUrl);
  // ...

  // ── 5. Resolve redirect ── (mesma lógica)
  const resolvedUrl = await resolveRedirectUrl(originalUrl);

  // ── 6. Busca imagem de capa ── (NOVO)
  const imageUrl = await fetchProductImage(marketplace, resolvedUrl);
  if (!imageUrl) { /* blocked: no_product_image */ return; }

  // ── 7. Busca TODOS os afiliados que monitoram este sourceGroup ──
  const sourceConfigs = await getSourceGroupConfigs(sourceGroupJid);
  // sourceConfigs: [{ affiliateId, mirrorId, instanceName, targetGroupJid, targetGroupName, messageTemplate }]

  if (sourceConfigs.length === 0) { /* nenhum afiliado configurado */ return; }

  // ── 8. Para cada afiliado (fan-out) ──
  const sendEvents: SendEvent[] = [];

  for (const config of sourceConfigs) {
    // Converte link com as credenciais DESTE afiliado
    const conversion = await convertOfferUrl(resolvedUrl, config.affiliateId, config.instanceName);
    if (!conversion.success) {
      // blocked: conversion_failed (já notifica o usuário via notifier)
      continue;
    }

    // Verifica safety
    const linkCheck = await verifyAffiliateLink(conversion.convertedUrl, config.affiliateId, marketplace);
    if (!linkCheck.valid) {
      // blocked: affiliate_link_mismatch
      continue;
    }

    // Monta template (1 mirror = 1 targetGroup)
    const ctx: TemplateContext = {
      originalText: text,
      originalUrl, convertedUrl: conversion.convertedUrl,
      marketplace, sourceGroupName, targetGroupName: config.targetGroupName,
      timestamp: new Date(), imageUrl,
    };
    const templateText = buildTemplateMessage(ctx, config.messageTemplate);

    sendEvents.push({
      id: crypto.randomUUID(),
      sourceMessageId: messageId,
      sourceGroupJid,
      mirrorId: config.mirrorId,  // ← Dispatcher resolve instanceName, targetGroup, affiliateId
      text: templateText,
      imageUrl,
      marketplace,
      originalUrl,
      convertedUrl: conversion.convertedUrl,
    });
  }

  // ── 9. Publica na Queue B ──
  // Envia em lote (atômico) com pipeline Redis
  const pipeline = redis.pipeline();
  for (const evt of sendEvents) {
    pipeline.xadd(MIRROR_SEND_STREAM, '*', 'payload', JSON.stringify(evt));
  }
  await pipeline.exec();

  // ACK na Queue A
  // Se sendEvents estiver vazio (todos bloqueados), ainda sim ACK — a msg foi
  // processada, só não gerou envios válidos
}
```

### Fan-out de afiliados: paralelismo

Cada afiliado no loop do passo 8 tem **instanceName diferente** (é uma condição — se dois afiliados compartilhassem a mesma instância, seria o mesmo afiliado). Portanto, as conversões podem rodar **em paralelo** via `Promise.allSettled`:

```typescript
const results = await Promise.allSettled(
  sourceConfigs.map(async (config) => {
    const conversion = await convertOfferUrl(resolvedUrl, config.affiliateId, config.instanceName);
    // ... verificação, template, geração de SendEvent ...
  }),
);
```

Isso é seguro porque cada conversão usa credenciais e APIs diferentes (Shopee GraphQL, ML API, Amazon).

### Cache de sourceGroup → configs

**Chave:** `mirror:source-group:{jid}`
**Valor:** `SourceGroupConfig[]`
**TTL:** Renovado a cada acesso (touch), nunca expira em uso ativo.
**População:** Feita no startup do Ingestor (lê do banco `mirrors`), e também via API no save de mirrors.

```typescript
interface SourceGroupConfig {
  affiliateId: number;
  mirrorId: number;
  instanceName: string;
  targetGroupJid: string;
  targetGroupName: string;
  messageTemplate: string | null;
  subRateMaxMsgs: number;
  subRateWindowSec: number;
}
```

---

## 4. Dispatcher

### Localização: `apps/worker/src/dispatcher.ts`

### Resolução do mirror config

O `SendEvent` carrega apenas `mirrorId`. O Dispatcher busca a configuração completa do mirror no Redis cache (fallback banco) para obter `instanceName`, `targetGroupJid`, `targetGroupName`, `affiliateId` e configurações de rate limit.

Isso garante que:
- O grupo de destino é SEMPRE o atual (se foi alterado no painel, o Dispatcher pega o novo)
- Se o mirror foi desativado, `getMirrorConfig` retorna `null` e a mensagem é descartada
- O SendEvent fica mais enxuto na fila

```typescript
interface MirrorSendConfig {
  instanceName: string;
  targetGroupJid: string;
  targetGroupName: string;
  affiliateId: number;
  status: string;
  subRateMaxMsgs: number;
  subRateWindowSec: number;
}

async function getMirrorSendConfig(mirrorId: number): Promise<MirrorSendConfig | null> {
  const config = await getMirrorConfig(mirrorId);
  if (!config) return null; // mirror inativo ou não existe
  return {
    instanceName: config.instanceName,    // resolvido do mirror
    targetGroupJid: config.targetGroupJid,
    targetGroupName: config.targetGroupName,
    affiliateId: config.affiliateId,
    status: config.status,
    subRateMaxMsgs: config.subRateMaxMsgs,
    subRateWindowSec: config.subRateWindowSec,
  };
}
```

> Nota: `getMirrorConfig()` é uma função existente em `mirror-pipeline.ts` que será adaptada: em vez de `targetGroups: []`, passará a retornar `targetGroupJid` e `targetGroupName` (1 mirror = 1 target group). Continua retornando `null` se `status === 'inactive'`.

### Dedup: evitar mensagens duplicadas no grupo destino

**Problema:** o Dispatcher pode crashar imediatamente após enviar com sucesso para a Evolution API, mas **antes de fazer o ACK no Redis Stream**. O consumer group reentrega o mesmo `SendEvent` — e a Evolution API recebe o mesmo texto + imagem duas vezes.

**Solução:** chave Redis com TTL de 24h que marca o par `{mirrorId, sourceMessageId}` como já processado. Como `sourceMessageId` é o ID único da mensagem no WhatsApp (único por grupo), a combinação identifica unicamente uma oferta espelhada.

```
Chave:   mirror:send-completed:{mirrorId}:{sourceMessageId}
Valor:   "1"
TTL:     86400 segundos (24h — mesma janela do dedup em reflected_offers)
```

**Regra:** a chave só é setada **após** o envio bem-sucedido. Se a Evolution API falhar, a chave não é criada e o retry/reentrega funciona normalmente.

### Fluxo completo

```typescript
async function processSendEvent(event: SendEvent): Promise<boolean> {
  const { mirrorId, sourceMessageId, text, imageUrl } = event;

  // ── 0. Dedup: já enviamos esta mensagem para este mirror? ──
  // Impede duplicação mesmo com reentrega do Redis Stream
  const dedupKey = `mirror:send-completed:${mirrorId}:${sourceMessageId}`;
  const alreadyCompleted = await redis.get(dedupKey);
  if (alreadyCompleted) {
    log('info', 'SendEvent já processado — pulando (reentrega do stream)', {
      mirrorId, sourceMessageId, eventId: event.id,
    });
    incrementCounter('sender_messages_skipped_total', { reason: 'deduplicated' });
    return true; // ACK na fila e segue
  }

  // ── 1. Busca config do mirror (valida se ativo + resolve dados) ──
  const mirror = await getMirrorSendConfig(mirrorId);
  if (!mirror) {
    log('info', 'Mirror desativado ou não encontrado — mensagem descartada', { mirrorId });
    incrementCounter('sender_messages_skipped_total', { reason: 'mirror_inactive' });
    return false; // ACK na fila (não reenvia)
  }

  const { instanceName, targetGroupJid, targetGroupName, affiliateId,
          subRateMaxMsgs, subRateWindowSec } = mirror;

  // ── 2. Rate limit (instância) ──
  const { acquired } = await tryAcquireSlot(instanceName);
  if (!acquired) {
    const gotSlot = await waitForSlot(instanceName);
    if (!gotSlot) { /* falha */ return false; }
  }

  // ── 3. Sub-rate limit (grupo destino) ──
  if (subRateMaxMsgs > 0) {
    // ... tryAcquireGroupSlot / waitForGroupSlot ...
  }

  // ── 4. Envia via Evolution API ──
  const sent = await sendMediaOrText(instanceName, targetGroupJid, text, imageUrl);

  // ── 5. Marca como concluído (só após envio bem-sucedido) ──
  // Se o envio falhar, a chave NÃO é criada — retry funciona normalmente
  if (sent) {
    await redis.setex(dedupKey, 86400, '1');
  }

  // ── 6. Log no banco ──
  await logReflectedOffer({
    affiliateId,
    sourceGroupJid: event.sourceGroupJid,
    targetGroupJid,
    originalLink: event.originalUrl,
    convertedLink: event.convertedUrl,
    marketplace: event.marketplace,
    messagePreview: text,
    status: sent ? 'sent' : 'failed',
  });

  return sent;
}
```

### Função sendMediaOrText

```typescript
async function sendMediaOrText(
  instanceName: string,
  groupJid: string,
  text: string,
  imageUrl: string,
): Promise<boolean> {
  const endpoint = imageUrl
    ? `${EVOLUTION_API_URL}/message/sendMedia/${instanceName}`
    : `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;

  const body = imageUrl
    ? { number: groupJid, media: imageUrl, caption: text, delay: 2000 }
    : { number: groupJid, text, delay: 2000, linkPreview: true };

  // Retry: 3 tentativas, backoff 2s/4s/8s
  // ... mesma lógica do sendToGroup atual ...
}
```

### Rate limit (mesmo do código atual)

Reaproveita `rate-limiter.ts` como está: `tryAcquireSlot`, `waitForSlot`, `tryAcquireGroupSlot`, `waitForGroupSlot`.

### Paralelismo no Sender

**Regra:** paralelizar **apenas entre instâncias diferentes**, nunca dentro da mesma instância.

```
Queue B (XREADGROUP COUNT=10)
  → agrupa mensagens por instanceName
  → processa instâncias diferentes em paralelo
  → dentro da mesma instância, processa em série
```

---

## 5. Imagem de Capa — `product-image.ts`

### Localização: `apps/worker/src/product-image.ts`

### Função principal

```typescript
export async function fetchProductImage(
  marketplace: string,
  productUrl: string,
): Promise<string | null>
```

### Estratégia: código específico por marketplace

Cada marketplace tem sua própria implementação, facilitando manutenção e ajustes independentes.

```typescript
async function fetchShopeeImage(productUrl: string): Promise<string | null>
async function fetchMercadoLivreImage(productUrl: string): Promise<string | null>
async function fetchAmazonImage(productUrl: string): Promise<string | null>
```

| Marketplace | Estratégia |
|---|---|
| **Shopee** | Extrair `item_id` da URL (`/product/{shop_id}/{item_id}/`). Fetch na página + extrair `og:image`. Alternativa: API GraphQL já usada nos converters. |
| **Mercado Livre** | Extrair `item_id` (padrão `MLB-XXXXXXXXXX`). Fetch na página + `og:image`. Alternativa: API pública `GET /items/{item_id}` → `pictures[0].url`. |
| **Amazon** | Extrair ASIN (`/dp/ASIN` ou `/gp/product/ASIN`). Fetch + `og:image`. Amazon pode bloquear bots → usar `User-Agent` de browser + timeout 8s. |

### Cache Redis

```
Chave:   product-image:{sha256(url)}
Valor:   { imageUrl: string | null, fetchedAt: string }
TTL:     1 hora (configurável via env WORKER_IMAGE_CACHE_TTL)
```

Reaproveita o padrão de conexão Redis de `conversion-cache.ts`.

### Regra de Segurança

**Imagem é obrigatória.** Se não for encontrada ou o fetch falhar, a mensagem é bloqueada:

```typescript
const imageUrl = await fetchProductImage(marketplace, resolvedUrl);
if (!imageUrl) {
  // blocked: no_product_image
  await logReflectedOffer({ /* ... */ status: 'blocked', failureReason: 'no_product_image' });
  incrementCounter('mirror_messages_blocked_total', { reason: 'no_product_image' });
  return;
}
```

| Situação | Comportamento |
|---|---|
| Imagem não encontrada | **Bloqueada** (`no_product_image`) |
| Fetch timeout (8s) | **Bloqueada** |
| Amazon 403 | **Bloqueada** |
| `og:image` URL quebrada | Evolution API pode falhar ao baixar → retry → se persistir, bloqueada |

---

## 6. Métricas e Monitoramento

### Dois servidores de métricas

Cada processador expõe seu próprio endpoint `/status`:

| Processador | Porta | Prefixo das métricas |
|---|---|---|
| Ingestor | 9092 | `pipeline_*` |
| Sender | 9093 | `sender_*` |

### Métricas do Ingestor (Ingestor)

| Nome | Tipo | Labels | O que mede |
|---|---|---|---|
| `pipeline_messages_received_total` | Contador | — | Mensagens que chegaram da Queue A |
| `pipeline_messages_blocked_total` | Contador | `reason` (no_url, blacklist, whitelist, dedup, no_product_image, conversion_failed, affiliate_mismatch) | Bloqueios |
| `pipeline_affiliates_per_message` | Histograma | — | Quantos afiliados cada mensagem gerou fan-out |
| `pipeline_step_duration_seconds` | Histograma | `step` (dedup, extract, blacklist, whitelist, image_fetch, resolve_redirect, fan_out) | Duração por etapa |
| `pipeline_total_duration_seconds` | Histograma | `status` (processed/blocked) | Duração total |
| `pipeline_concurrent_count` | Gauge | — | Mensagens sendo processadas simultaneamente |
| `pipeline_image_fetch_total` | Contador | `marketplace, result` (found/not_found/error) | Resultado da busca de imagem |
| `pipeline_image_fetch_duration_seconds` | Histograma | `marketplace` | Tempo de fetch da imagem |
| `pipeline_conversion_per_affiliate` | Histograma | `marketplace` | Tempo de conversão por afiliado |
| `pipeline_send_events_published_total` | Contador | — | Eventos publicados na Queue B |

### Métricas do Dispatcher (Dispatcher)

| Nome | Tipo | Labels | O que mede |
|---|---|---|---|
| `sender_events_received_total` | Contador | — | SendEvents recebidos da Queue B |
| `sender_messages_sent_total` | Contador | `marketplace` | Mensagens enviadas com sucesso |
| `sender_messages_sent_with_image_total` | Contador | — | Mensagens enviadas com imagem |
| `sender_messages_skipped_total` | Contador | `reason` (mirror_inactive) | Mensagens descartadas sem enviar (mirror desativado, target removido) |
| `sender_failures_total` | Contador | `type` (rate_limited, send_failed, timeout) | Falhas |
| `sender_rate_limit_wait_duration_seconds` | Histograma | `level` (instance/group) | Tempo esperando rate limit |
| `sender_send_duration_seconds` | Histograma | `marketplace` | Tempo de envio para Evolution API |
| `sender_concurrent_count` | Gauge | — | Envios simultâneos |
| `sender_dlq_count` | Gauge | — | Itens na Dead Letter Queue |

### Endpoint /status enriquecido

Cada processador expõe `/status` com:

```json
{
  "service": "pipeline-orchestrator",
  "status": "healthy",
  "uptime": "2d 3h 15m",
  "stepDurations": {
    "dedup": { "avg": 0.01, "p50": 0.005, "p99": 0.05, "count": 1000 },
    "image_fetch": { "avg": 0.8, "p50": 0.5, "p99": 3.0, "count": 1000 },
    "fan_out": { "avg": 1.5, "p50": 1.0, "p99": 5.0, "count": 1000 }
  },
  "concurrentCount": 3,
  "imageStats": {
    "found": 450,
    "notFound": 12,
    "errors": 5,
    "totalAttempts": 467
  },
  "pipelineDuration": { "avg": 2.8, "p50": 2.0, "p99": 8.0, "count": 1000 },
  "affiliatesPerMessage": { "avg": 2.1, "p50": 2, "p99": 5, "count": 1000 }
}
```

### StepTracker (ring buffer)

```typescript
class StepTracker {
  private buffer: number[] = [];
  private maxSize: number;

  constructor(maxSize = 1000) { this.maxSize = maxSize; }

  observe(durationMs: number): void {
    this.buffer.push(durationMs);
    if (this.buffer.length > this.maxSize) this.buffer.shift();
  }

  snapshot(): { avg: number; p50: number; p99: number; count: number } {
    if (this.buffer.length === 0) return { avg: 0, p50: 0, p99: 0, count: 0 };
    const sorted = [...this.buffer].sort((a, b) => a - b);
    const n = sorted.length;
    return {
      avg: sorted.reduce((a, b) => a + b, 0) / n,
      p50: sorted[Math.floor(n * 0.5)] ?? 0,
      p99: sorted[Math.floor(n * 0.99)] ?? sorted[n - 1] ?? 0,
      count: n,
    };
  }
}
```

### Tela de monitoramento

A interface web que já consome `/status` do worker (porta 9092) será atualizada para consumir **ambos** os endpoints (9092 e 9093), exibindo duas abas: "Pipeline" e "Sender".

Os contadores Prometheus em `/metrics` são mantidos para scrape futuro.

---

## 7. Regras de Paralelismo

| Oportunidade | Processador | Paraleliza? |
|---|---|---|
| Mensagens de instâncias **diferentes** na Queue A | Ingestor | ✅ Sim — cada afiliado tem instância diferente |
| Mensagens da **mesma** instância na Queue A | Ingestor | ❌ Não (não se aplica — Queue A não tem instanceName como chave de rate limit) |
| Fan-out de afiliados de um **mesmo** sourceGroup | Ingestor | ✅ Sim — cada conversão usa API de marketplace diferente |
| Envio para o targetGroup do mirror | Dispatcher | ❌ Não — sequencial por mirror |
| SendEvents de instâncias **diferentes** na Queue B | Dispatcher | ✅ Sim — rate limits independentes |
| SendEvents da **mesma** instância na Queue B | Dispatcher | ❌ Não — sequencial por instanceName |

**Estratégia no Dispatcher (sender):**

```typescript
// Agrupa por instanceName
const byInstance = new Map<string, SendEvent[]>();
for (const event of sendEvents) {
  const list = byInstance.get(event.instanceName) ?? [];
  list.push(event);
  byInstance.set(event.instanceName, list);
}

// Processa instâncias em paralelo, eventos da mesma instância em série
await Promise.allSettled(
  Array.from(byInstance.entries()).map(async ([instanceName, events]) => {
    for (const event of events) {
      await processSendEvent(event);
    }
  }),
);
```

---

## 8. Provedor de Métricas Compartilhado — `worker-common`

Ambos os processadores compartilham `metrics.ts`, `dead-letter-queue.ts` e `notifier.ts` através do novo pacote `packages/worker-common/`. Cada app importa o que precisa:

```typescript
// apps/ingestor/src/ingestor.ts
import { StepTracker } from '@omestre/worker-common';

// apps/dispatcher/src/dispatcher.ts
import { StepTracker } from '@omestre/worker-common';
```

### worker-common/src/metrics.ts

// Cada processador cria suas próprias instâncias:
export const ingestorSteps = {
  dedup: new StepTracker(),
  extract: new StepTracker(),
  imageFetch: new StepTracker(),
  fanOut: new StepTracker(),
  total: new StepTracker(),
};

export const dispatcherSteps = {
  rateLimitWait: new StepTracker(),
  send: new StepTracker(),
  total: new StepTracker(),
};
```

---

## 9. Estrutura de Arquivos Final

```
o-mestre-afiliado/
├── apps/
│   ├── api/                      # Elysia REST API (inalterado)
│   ├── web/                      # React + Vite (inalterado)
│   │
│   ├── ingestor/                 # NOVO — Ingestor (Queue A → Queue B)
│   │   ├── src/
│   │   │   ├── index.ts          # Entrypoint --mode=ingestor
│   │   │   ├── ingestor.ts       # Pipeline principal
│   │   │   ├── product-image.ts  # Fetch de imagem de capa
│   │   │   ├── resolve-redirect.ts
│   │   │   ├── conversion-cache.ts
│   │   │   └── __tests__/
│   │   ├── Dockerfile
│   │   └── package.json          # deps: shared, db, converters, worker-common, ioredis
│   │
│   └── dispatcher/               # NOVO — Dispatcher (Queue B → Evolution API)
│       ├── src/
│       │   ├── index.ts          # Entrypoint --mode=dispatcher
│       │   ├── dispatcher.ts     # Rate limit + envio
│       │   ├── rate-limiter.ts
│       │   └── __tests__/
│       ├── Dockerfile
│       └── package.json          # deps: shared, db, worker-common, ioredis (só)
│
├── packages/
│   ├── shared/                   # Tipos RawMessageEvent, SendEvent, constantes
│   ├── db/                       # Schema + MirrorRepository
│   ├── converters/               # Shopee, ML, Amazon (só o ingestor precisa)
│   │
│   └── worker-common/            # NOVO — código compartilhado entre apps
│       ├── src/
│       │   ├── metrics.ts        # StepTracker, servidor HTTP /status
│       │   ├── dead-letter-queue.ts
│       │   └── notifier.ts
│       ├── package.json          # deps: shared, db
│       └── tsconfig.json
```

### Dependências entre apps

```
ingestor  → shared, db, converters, worker-common
dispatcher → shared, db, worker-common
worker-common → shared, db
```

O **dispatcher fica enxuto** — sem `converters`, sem `product-image`, sem `resolve-redirect`. Menos dependências = menos superfície de bug, build mais rápido, container menor.

### apps/worker (antigo)

O diretório `apps/worker/` existente pode ser mantido temporariamente como referência durante a migração e removido quando todo o código for extraído para os novos apps.

---

## 9b. Plano de Migração: apps/worker → ingestor + dispatcher + worker-common

### Estrutura atual (`apps/worker/`)

```
apps/worker/
├── Dockerfile                          # build da imagem
├── package.json                        # @omestre/worker — deps: converters, shared, db, ioredis
├── tsconfig.json
├── README.md
├── dist/                               # build output (pode remover)
├── node_modules/
└── src/
    ├── index.ts                        # entrypoint: modo mirror, revalidate, batch
    ├── mirror-pipeline.ts              # 1390 linhas — pipeline COMPLETO (extrair, converter, enviar)
    ├── metrics.ts                      # servidor HTTP /metrics + /status
    ├── rate-limiter.ts                 # rate limit Redis (instância + sub-rate grupo)
    ├── dead-letter-queue.ts            # DLQ
    ├── notifier.ts                     # notificações ao usuário
    ├── conversion-cache.ts             # cache de URLs convertidas
    ├── resolve-redirect.ts             # resolução de redirect Promozone
    ├── conversion-cache.test.ts
    └── __tests__/
        ├── dead-letter-queue.test.ts
        ├── metrics.test.ts
        ├── notifier.test.ts
        ├── rate-limiter.test.ts
        ├── redis-stream.test.ts
        └── ttl-cache.test.ts
```

### Destino de cada arquivo

| Arquivo atual | Vai para | Destino |
|---|---|---|
| `apps/worker/src/index.ts` | **REMOVIDO** | Substituído pelos entrypoints de `apps/ingestor/` e `apps/dispatcher/` |
| `apps/worker/src/mirror-pipeline.ts` | **REMOVIDO** após extração | Lógica splitada entre `ingestor/ingestor.ts` (pipeline, conversão) e `dispatcher/dispatcher.ts` (envio) |
| `apps/worker/src/metrics.ts` | `packages/worker-common/src/metrics.ts` | Passa a ser `@omestre/worker-common`. StepTracker, servidor HTTP, /status. Cada app cria suas instâncias separadas. |
| `apps/worker/src/dead-letter-queue.ts` | `packages/worker-common/src/dead-letter-queue.ts` | DLQ compartilhada entre ingestor + dispatcher + API (reuso da conexão Redis) |
| `apps/worker/src/notifier.ts` | `packages/worker-common/src/notifier.ts` | Notificações ao usuário (cooldown Redis) |
| `apps/worker/src/rate-limiter.ts` | `apps/dispatcher/src/rate-limiter.ts` | Só o Dispatcher precisa de rate limiting (o Ingestor não envia nada) |
| `apps/worker/src/conversion-cache.ts` | `apps/ingestor/src/conversion-cache.ts` | Cache de URLs convertidas (só o Ingestor converte) |
| `apps/worker/src/resolve-redirect.ts` | `apps/ingestor/src/resolve-redirect.ts` | Resolução de Promozone (só o Ingestor precisa) |
| `apps/worker/src/conversion-cache.test.ts` | `apps/ingestor/src/__tests__/conversion-cache.test.ts` | Acompanha o código |
| `apps/worker/src/__tests__/rate-limiter.test.ts` | `apps/dispatcher/src/__tests__/rate-limiter.test.ts` | Acompanha o código |
| `apps/worker/src/__tests__/dead-letter-queue.test.ts` | `packages/worker-common/src/__tests__/dead-letter-queue.test.ts` | Acompanha o código |
| `apps/worker/src/__tests__/metrics.test.ts` | `packages/worker-common/src/__tests__/metrics.test.ts` | Acompanha o código |
| `apps/worker/src/__tests__/notifier.test.ts` | `packages/worker-common/src/__tests__/notifier.test.ts` | Acompanha o código |
| `apps/worker/src/__tests__/redis-stream.test.ts` | **REMOVIDO** | Testava integração PubSub do stream — substituído pelos consumer groups das novas filas |
| `apps/worker/src/__tests__/ttl-cache.test.ts` | **REMOVIDO** | Testava cache com TTL genérico — não usado no novo desenho |
| `apps/worker/Dockerfile` | **REMOVIDO** | Substituído por `apps/ingestor/Dockerfile` e `apps/dispatcher/Dockerfile` |
| `apps/worker/package.json` | **REMOVIDO** | Substituído por `apps/ingestor/package.json` e `apps/dispatcher/package.json` |
| `apps/worker/tsconfig.json` | **REMOVIDO** | Herda da raiz |
| `apps/worker/README.md` | **REMOVIDO** | Documentação obsoleta |
| `apps/worker/dist/` | **REMOVIDO** | Build output — limpo com `rm -rf apps/worker/dist` |

### O que é CRIADO do zero

| Arquivo | Conteúdo |
|---|---|
| `apps/ingestor/src/ingestor.ts` | Pipeline principal: recebe RawMessageEvent, processa (extract, blacklist, redirect, image, fan-out), publica SendEvents |
| `apps/ingestor/src/product-image.ts` | `fetchProductImage()` — busca imagem de capa por marketplace |
| `apps/ingestor/src/index.ts` | Entrypoint: conecta Redis, cria consumer group, loop XREADGROUP |
| `apps/ingestor/package.json` | `@omestre/ingestor` — deps: shared, converters, db, worker-common, ioredis |
| `apps/ingestor/Dockerfile` | Build da imagem do Ingestor |
| `apps/dispatcher/src/dispatcher.ts` | Pipeline de envio: recebe SendEvent, busca mirror config, rate limit, sendMedia/sendText, log |
| `apps/dispatcher/src/index.ts` | Entrypoint: conecta Redis, cria consumer group, loop XREADGROUP |
| `apps/dispatcher/package.json` | `@omestre/dispatcher` — deps: shared, db, worker-common, ioredis |
| `apps/dispatcher/Dockerfile` | Build da imagem do Dispatcher |
| `packages/worker-common/src/metrics.ts` | StepTracker, servidor HTTP, getStatusResponse (extraído de apps/worker) |
| `packages/worker-common/src/dead-letter-queue.ts` | DLQ (extraído de apps/worker) |
| `packages/worker-common/src/notifier.ts` | Notificações (extraído de apps/worker) |
| `packages/worker-common/package.json` | `@omestre/worker-common` — deps: shared, db |
| `packages/worker-common/tsconfig.json` | Herda da raiz |

### Mapa de extração do `mirror-pipeline.ts` (1390 linhas)

A função `processMirrorMessage()` atual será desmembrada:

```
mirror-pipeline.ts                          → ingestor.ts + dispatcher.ts
├── extractMarketplaceUrl()                 → ingestor.ts (inalterada)
├── loadBlacklist() / loadWhitelist()       → ingestor.ts (inalterada)
├── isDuplicate()                           → ingestor.ts (inalterada)
├── convertOfferUrl()                       → ingestor.ts (inalterada)
├── convertShopeeForAffiliate()             → ingestor.ts (inalterada)
├── convertMlForAffiliate()                 → ingestor.ts (inalterada)
├── convertAmazonForAffiliate()             → ingestor.ts (inalterada)
├── buildTemplateMessage()                  → ingestor.ts (inalterada)
├── verifyAffiliateLink()                   → ingestor.ts (inalterada)
├── verifyMercadoLivreLink()                → ingestor.ts (inalterada)
├── verifyAmazonLink()                      → ingestor.ts (inalterada)
├── getMirrorConfig()                       → worker-common (usado pelo dispatcher p/ buscar config do mirror)
├── getMirrorTargetGroups()                 → REMOVIDO (mirror tem 1 targetGroup só)
├── getMirrorMessageTemplate()              → ingestor.ts (reduzido — sem fallback de affiliate)
├── getMirrorSubRateLimit()                 → REMOVIDO (sub-rate agora no dispatcher)
├── sendToGroup()                           → dispatcher.ts (transformado em sendMediaOrText)
├── logReflectedOffer()                     → dispatcher.ts (inalterada)
├── processMirrorMessage()                  → REMOVIDO (split entre ingestor.ts e dispatcher.ts)
```

### Etapas da migração

```
1. CRIAR packages/worker-common/
   └── Extrair metrics.ts, dead-letter-queue.ts, notifier.ts
   └── Adaptar imports: @omestre/worker-common

2. CRIAR apps/ingestor/
   └── Extrair todo o pipeline de mirror-pipeline.ts
   └── Criar product-image.ts do zero
   └── Remover targetGroups loop (1 mirror = 1 targetGroup)
   └── Remover sendToGroup (vai pro dispatcher)
   └── Adicionar fan-out de afiliados + send-dedup

3. CRIAR apps/dispatcher/
   └── Extrair sendToGroup de mirror-pipeline.ts
   └── Adicionar sendMediaOrText
   └── Adicionar validação mirror ativo (getMirrorConfig)
   └── Adicionar dedup send-completed

4. ATUALIZAR apps/api/webhook.routes.ts
   └── Publicar na Queue A com webhook-dedup

5. ATUALIZAR docker-compose.dev.yml
   └── worker → ingestor + dispatcher

6. REMOVER apps/worker/ (após validar que tudo funciona)
   └── git rm -r apps/worker/
```

---

## 10. Docker Compose

```yaml
services:
  ingestor:
    build: ./apps/ingestor
    environment:
      - REDIS_URL=redis://redis:6379
      - METRICS_PORT=9092
      - EVOLUTION_API_URL=http://evolution_api:5444
      - EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
    env_file:
      - .env
    depends_on:
      redis:
        condition: service_started
    restart: unless-stopped

  dispatcher:
    build: ./apps/dispatcher
    environment:
      - REDIS_URL=redis://redis:6379
      - METRICS_PORT=9093
      - EVOLUTION_API_URL=http://evolution_api:5444
      - EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
    env_file:
      - .env
    depends_on:
      redis:
        condition: service_started
    restart: unless-stopped
    # Escalável: docker compose up -d --scale dispatcher=2
```

---

## 11. Ordem de Implementação

```
Fase 1 — Infraestrutura de filas + worker-common
  ├── Criar packages/worker-common/ (metrics, DLQ, notifier)
  ├── Criar RawMessageEvent e SendEvent tipos em @omestre/shared
  ├── Adicionar constantes MIRROR_RAW_STREAM, MIRROR_SEND_STREAM
  ├── Cache sourceGroup 1:N (migrar de 1:1)
  └── ~120 linhas

Fase 2 — apps/ingestor (pipeline pesado)
  ├── Criar apps/ingestor/ (package.json + Dockerfile + src/)
  ├── ingestor.ts: extrair lógica do processMirrorMessage atual
  ├── Fan-out de afiliados com Promise.allSettled
  ├── Publicar SendEvents na Queue B
  ├── product-image.ts com implementações específicas
  ├── Cache Redis com sha256
  ├── Safety check: bloquear se imagem não encontrada
  └── ~350 linhas (herdando ~200 do código atual)

Fase 3 — apps/dispatcher (rate limit + envio)
  ├── Criar apps/dispatcher/ (package.json + Dockerfile + src/)
  ├── dispatcher.ts: extrair sendToGroup + rate limit + log
  ├── sendMediaOrText (sendMedia com imagem, sendText sem)
  ├── Dedup (send-completed Redis) + validação mirror ativo
  ├── Endpoint /status próprio (porta 9093)
  └── ~150 linhas (herdando ~100 do código atual)

Fase 4 — Atualizar webhook (API)
  ├── Publicar RawMessageEvent na Queue A em vez de PubSub
  ├── Remover affiliateId/mirrorId do evento (agora resolvido no Ingestor)
  └── ~30 linhas

Fase 5 — Docker Compose + limpeza
  ├── Atualizar docker-compose.dev.yml com ingestor + dispatcher
  ├── Remover apps/worker/ antigo
  └── ~30 linhas
```

---

## 12. Arquivos Modificados / Criados

| Arquivo | Ação |
|---|---|
| `packages/worker-common/` (src + package.json + tsconfig) | **NOVO** — código compartilhado (metrics, DLQ, notifier) |
| `packages/shared/src/mirror-message.ts` | Modificar: adicionar `RawMessageEvent`, `SendEvent`; manter `MirrorMessageEvent` para retrocompat |
| `packages/shared/src/index.ts` | Modificar: adicionar constantes dos novos streams |
| `apps/ingestor/` (src + package.json + Dockerfile) | **NOVO** — app Ingestor completo |
| `apps/dispatcher/` (src + package.json + Dockerfile) | **NOVO** — app Dispatcher completo |
| `apps/api/src/modules/webhook/webhook.routes.ts` | Modificar: publicar na Queue A em vez de PubSub |
| `apps/api/src/services/group-cache.ts` | Modificar: cache 1:N |
| `docker-compose.dev.yml` | Modificar: substituir `worker` por `ingestor` + `dispatcher` |
| `apps/worker/` (antigo) | Manter como referência durante migração, remover no final |

---

## 13. Benefícios da Arquitetura

| Aspecto | Antes | Depois |
|---|---|---|
| Afiliados por sourceGroup | 1:1 (um afiliado por grupo) | 1:N (N afiliados, N instâncias) |
| Responsabilidade | Worker monolítico | Pipeline separado do Sender |
| Imagem | Não existia | Obrigatória, buscada do marketplace |
| Métricas | Só contadores simples no worker | StepTracker por etapa + /status enriquecido em ambos processadores |
| Paralelismo | Sequencial (1 mensagem por vez) | Instâncias diferentes em paralelo, fan-out de afiliados em paralelo |
| Rate limit | Misturado com pipeline | Isolado no Sender |
| Dead Letter Queue | Compartilhada | Compartilhada |
| Observabilidade | Uma porta (9092) | Duas portas (9092 pipeline, 9093 sender) — UI unificada |
