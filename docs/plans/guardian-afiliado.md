# Plano: Guardião do Afiliado (defesa em profundidade contra comissão cruzada)

> **Status:** Não iniciado. Plano completo — aguardando decisão de priorização para entrar em uma fase do `docs/roadmap.md`.
> **Owner:** Matheus Torreão
> **Última atualização:** 2026-07-30 (rev 2: adicionada validação tripla — link + targetGroupJid + mirror ativo — como objetivo explícito do guardião)

### Posicionamento revisado (rev 2, 2026-07-30)

O guardião é o **auditor independente** do pipeline — última palavra antes do envio, independente do ingestor e do cache. Decisão do owner: o guardião **bloqueia** qualquer envio que falhe **qualquer** das três validações:

1. **Link convertido bate com o afiliado do mirror** (coberto pela rev 1 — extração de `melitat`/`matt_word`/`tag` da `convertedUrl` e comparação com as credenciais ativas do `affiliateId`).
2. **`targetGroupJid` no `SendEvent` é o mesmo do `mirror` ativo no momento do envio** (adição rev 2 — re-busca o mirror no banco, compara o `targetGroupJid` atual com o que veio no evento).
3. **Mirror está ativo (`status !== 'inactive'`) no momento do envio** (re-busca, não confia em cache).

> **Por que não confiar no `mirror-config.ts`:** ele já valida `status === 'inactive' → null`, mas a checagem acontece **antes** do guardião. Se um admin desativa o mirror entre a chamada do `getMirrorSendConfig` e a chamada HTTP à Evolution API (janela de ~50-200ms), o `SendEvent` já passou pelo `mirror-config` como ativo e vai sair mesmo com o mirror agora inativo. O guardião **revalida** o `status` e o `targetGroupJid` **imediatamente antes** do envio, fechando essa janela.

### Comportamento de UX (rev 2)

- **Para o usuário comum (logs de espelhamento):** o bloqueio aparece como **erro genérico** `Falha no envio — verifique os logs` (sem expor qual validação reprovou). Detalhe em `apps/web/src/pages/MirrorLogsPage.tsx`.
- **Para o super admin (nova aba Guardião):** log **estruturado completo** com qual das 3 validações reprovou, `expected` vs `observed`, `eventId` e `mirrorId`. Endpoint dedicado `/api/admin/affiliate-audit` (gate admin já existente).

---

## 0. Resumo executivo

O pipeline de espelhamento do **O Mestre Afiliado** processa ofertas de um grupo-fonte e as reenvia para os grupos-destino de **N afiliados** (fan-out 1:N). O sistema já tem três camadas de proteção contra afiliado errado (safety check no ingestor, dedup atômico no dispatcher, `link-verifier-pure` comparando parâmetros), **mas todas as três têm o mesmo modelo de falha: confiam que o `convertedUrl` chegou correto do ingestor**. Se o `convertedUrl` chega contaminado, **nada no pipeline detecta**.

Este plano adiciona uma **quarta camada — o Guardião** — que:

1. **Verifica** o `convertedUrl` **just-in-time antes do envio** (no dispatcher, imediatamente antes de chamar a Evolution API), revalidando match entre credenciais embutidas na URL e o afiliado do `mirrorId` — usando o banco como fonte de verdade (consulta fresca, não cache).
2. **Mantém um registry de credenciais esperadas** por afiliado (`packages/affiliate-guardian/registry.ts`) — fonte canônica de "o que cada afiliado tem direito de enviar".
3. **Audita** cada SendEvent **2x**: no ingestor (pre-publish) e no dispatcher (pre-send), com tabela `affiliate_audit_log` (append-only) para retrospectiva.
4. **Detecta e isola conversor contaminado** (cache de conversões Redis cuja chave hash não bate com o afiliado esperado) — a especificação cobre a forma, mas a limpeza em massa fica como follow-up depois.

### Vetores de risco cobertos

| Vetor de risco | #                                                                                                                                                          | Onde hoje                                                                                           | Como o guardião trata                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1              | Fallback global via `convertUrl()` em `link-converters.ts` (linhas 105, 135, 170, 294) usa credenciais do **`.env`**                                       | `apps/ingestor/src/link-converters.ts`                                                              | Registry torna o vetor 1 um **erro de config** explícito; ingestor bloqueia affiliate sem credenciais próprias (fail-closed)         |
| 2              | Cache Redis de conversão (`omestre:mirror:conversion:{hash}`) é **chave-única** — entradas antigas podem servir afiliado novo                              | `apps/ingestor/src/conversion-cache.ts`                                                             | Verifier no ingestor consulta **banco** (fonte de verdade) — não o cache. Cache **continua válido** se o guardião aprovar            |
| 3              | `link-verifier.ts` no ingestor é **fail-open** em erro de DB (linha 53-58) — outage do banco deixa passar qualquer link                                    | `apps/ingestor/src/link-verifier.ts`                                                                | Mantido fail-open (não bloquear o pipeline por outage do DB), mas o **dispatcher re-verifica** com failover diferente                |
| 4              | `verifyAmazonLink` é **fail-open** quando afiliado não tem tracking IDs (linha 145) — link entra com tag de outro afiliado                                 | `apps/ingestor/src/link-verifier.ts`                                                                | Verifier exige **affiliateId positivo** resolve para credenciais ativas; sem credenciais → `valid: false` (fail-closed)              |
| 5              | Replay de `SendEvent` via `XAUTOCLAIM` (orphan PEL) — mensagem de afiliado A pode ser retransmitida para afiliado B se misc                                | `apps/dispatcher/src/index.ts:reclaimPendingEntries`                                                | Verifier just-before-send no dispatcher é independente do reaproveitamento do PEL — re-valida sempre contra o banco atual            |
| 6 **(rev 2)**  | Admin desativa mirror entre `getMirrorSendConfig` e `sendMediaOrText` (janela ~50-200ms) — SendEvent aprovado pelo mirror-config mas mirror agora inativo  | `apps/dispatcher/src/mirror-config.ts:42` + `dispatcher.ts:85-97`                                   | Tripla validação (rev 2) re-busca mirror no DB **imediatamente antes** do envio — `mirrorActive: false` → bloco                      |
| 7 **(rev 2)**  | Admin edita `targetGroups` do mirror entre `getMirrorSendConfig` e envio — SendEvent aponta para grupo antigo, novo espelhamento já aponta para grupo novo | `apps/dispatcher/src/mirror-config.ts:60-61` + `dispatcher.ts:99-105`                               | Tripla validação (rev 2) compara `event.targetGroupJid` vs `freshMirror.targetGroupJid` — divergência → bloco                        |
| 8 **(rev 2)**  | `convertOfferUrl` no ingestor cai no fallback genérico (env) e ignora o `affiliateId` — link sai com tag do `.env` em vez do afiliado correto              | `packages/converters/src/mercadolivre.ts:convertUrl()` + `apps/ingestor/src/link-converters.ts:294` | Verifier no dispatcher exige `matt_word`/`melitat`/`tag` da URL == credenciais ativas do `affiliateId` do mirror — link de env falha |

> **Princípio fundador:** fluxo multi-afiliado (1 sourceGroup → N destinos) é o **único** caminho que pode produzir comissão cruzada. Toda oferta espelhada **deve** provar que sua `convertedUrl` foi gerada com credenciais do `affiliateId` do `mirrorId`, sem exceção.

---

## 1. Estado atual (o que já temos e o que falta)

### 1.1 Camadas de proteção existentes (a serem preservadas)

| Camada                         | Arquivo                                   | Escopo                                            | Limitação conhecida                                                  |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| **Cache de dedup webhook**     | `apps/ingestor/src/dedup.ts`              | Mesma `messageId` num sourceGroup não duplica     | Não confere afiliado                                                 |
| **Source-group cache**         | `apps/ingestor/src/source-group-cache.ts` | Resolve `sourceGroupJid → [SourceGroupConfig]`    | 1:N pode levar a N afiliados consumindo a mesma oferta               |
| **Link-verifier (ingestor)**   | `apps/ingestor/src/link-verifier.ts`      | Compara `convertedUrl` vs `affiliateId` no banco  | Fail-open em erro de DB; rodado UMA vez antes de publicar na Queue B |
| **Fan-out isolation**          | `apps/ingestor/src/ingestor.ts:304-410`   | Itera por afiliado, captura erro individual       | Cada afiliado gera SendEvent próprio com `mirrorId` próprio          |
| **Dedup atômico (dispatcher)** | `apps/dispatcher/src/dispatcher.ts:69-82` | SET NX EX bloqueia reenvio                        | Não checa conteúdo do `convertedUrl`                                 |
| **Reflected-offers log**       | `apps/dispatcher/src/offer-logger.ts`     | Persiste `originalLink + convertedLink` por envio | Log, não bloqueador                                                  |

### 1.2 Lacunas

- **Verificação no dispatcher** (última milha): não existe. Confiamos que o `SendEvent` chegou íntegro.
- **Registry de credenciais esperadas** (canônico): o `MlAffiliateRepository`, `AmazonAffiliateRepository`, `UserCredentialsRepository` já existem, mas **não há uma função central** que, dado um `affiliateId`, retorne "este afiliado pode mandar links com estas credenciais".
- **Auditoria persistida**: o `reflected_offers` loga o enviado, mas não loga **decisões de verificação** (nem os rejects pré-envio).
- **Detecção de cache contaminado**: hoje não há como dizer "este `convertedUrl` veio de uma conversão que NÃO foi feita para este afiliado".

---

## 2. Decisões de arquitetura

1. **Package novo: `@omestre/affiliate-guardian`**. Lógica compartilhada ingestor+dispatcher. Schema/tabela/migrations continuam em `@omestre/db` (convenção do repo).
2. **Fail-closed por padrão** (reverte o fail-open atual do `link-verifier.ts`): sem credenciais ativas do afiliado, o `convertedUrl` é **inválido**. Exceção: outage do banco no verifier (mantida `fail-open` no ingestor para não derrubar pipeline por infra — mas o dispatcher faz sua própria consulta best-effort).
3. **Verificação no dispatcher é independente** (não reutiliza nem o resultado do ingestor, nem o cache de hash). Query direta ao banco para o `affiliateId` → credenciais ativas. Custo: 1 SELECT por SendEvent (índice em `affiliates.id` já é PK — query é O(1)).
4. **Auditoria append-only em `affiliate_audit_log`** (não tabela `reflected_offers`): separa **decisões de verificação** (decisor) de **logs de envio** (resultado). Permite retrospectiva precisa sem misturar telemetrias.
5. **Sem mudança de contrato do `SendEvent`**: a auditoria fica nos bastidores. `SendEvent` continua carregando `{ id, mirrorId, convertedUrl, originalUrl, marketplace, ... }` — o guardião lê `mirrorId` + `convertedUrl` no dispatcher.
6. **Cache de conversões (`MIRROR_CONVERSION_CACHE_PREFIX`) é mantido**: o guardião **não invalida o cache existente** (Risco §11.1). O guardião **impede o uso futuro** do cache se isso gerar mismatch. Limpeza em massa de cache contaminado é um follow-up separado (não bloqueia entrega).
7. **Adicionar `validation-only` registry** (não invadir `MlAffiliateRepository` / `AmazonAffiliateRepository`): a função `getExpectedAffiliateCredentials(affiliateId, marketplace)` no guardião encapsula a consulta multi-repo, mantendo as consultas existentes. Single-responsibility.
8. **Phasing:** o plano cobre Fases 1–4. As tarefas de limpeza em massa (Fase 5: scan + invalidate cache contaminado) entram como item separado após a proteção estar ativa.

---

## 3. Modelo de dados

### 3.1 Tabela `omestre.affiliate_audit_log` (append-only)

```sql
-- packages/db/src/migrations/00XX_add_affiliate_audit_log.sql
CREATE TABLE IF NOT EXISTS omestre.affiliate_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  event_id     TEXT NOT NULL,                      -- UUID do SendEvent (dedup cross-process)
  mirror_id    INTEGER NOT NULL REFERENCES omestre.mirrors(id),
  affiliate_id INTEGER NOT NULL,                   -- afiliado esperado (do mirrorId)
  marketplace  TEXT NOT NULL,
  stage        TEXT NOT NULL,                      -- 'ingestor' | 'dispatcher'
  decision     TEXT NOT NULL,                      -- 'allow' | 'block'
  reason       TEXT,                               -- texto se decision='block'
  converted_url TEXT,                              -- URL auditada (pode ser truncada p/ tamanho)
  original_url  TEXT,
  payload     JSONB,                               -- contexto extra (verifier result, error stack)
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_event_id      ON omestre.affiliate_audit_log(event_id);
CREATE INDEX idx_audit_affiliate_id  ON omestre.affiliate_audit_log(affiliate_id, created_at DESC);
CREATE INDEX idx_audit_decision      ON omestre.affiliate_audit_log(decision, created_at DESC);
```

- **Sem `id` UUID**: usa `BIGSERIAL` para ordenação temporal barata.
- **Sem RLS** (sistema single-tenant hoje).
- **INSERT-only**: nenhuma rota de UPDATE/DELETE na API (constraint imposta via código + comentário).
- **Retention**: 90 dias (cleanup via cron mensal — fora do escopo deste plano, adicionar a `docs/lessons-learned/` quando virar issue).

### 3.2 Schema Drizzle

`packages/db/src/schema/affiliateAuditLog.ts`:

```typescript
import { bigserial, index, integer, jsonb, pgEnum, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';

export const auditStage = pgEnum('audit_stage', ['ingestor', 'dispatcher']);
export const auditDecision = pgEnum('audit_decision', ['allow', 'block']);

export const affiliateAuditLog = omestre.table(
  'affiliate_audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    eventId: text('event_id').notNull(),
    mirrorId: integer('mirror_id').notNull(),
    affiliateId: integer('affiliate_id').notNull(),
    marketplace: text('marketplace').notNull(),
    stage: auditStage('stage').notNull(),
    decision: auditDecision('decision').notNull(),
    reason: text('reason'),
    convertedUrl: text('converted_url'),
    originalUrl: text('original_url'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    eventIdIdx: index('idx_audit_event_id').on(t.eventId),
    affiliateIdx: index('idx_audit_affiliate_id').on(t.affiliateId, t.createdAt),
    decisionIdx: index('idx_audit_decision').on(t.decision, t.createdAt),
  }),
);
```

Exportar em `packages/db/src/schema/index.ts` (verificar como os outros schemas são re-exportados).

### 3.3 Repository

`packages/db/src/repository/affiliateAuditLog.repository.ts` — `AffiliateAuditLogRepository`:

- `record(entry: AffiliateAuditLogEntry): Promise<void>` — INSERT, fire-and-forget.
- `findByEventId(eventId: string): Promise<AffiliateAuditLogRow[]>` — usado por E2E e debugging.
- `findByAffiliateSince(affiliateId: number, since: Date): Promise<AffiliateAuditLogRow[]>` — endpoint admin.

---

## 4. Package `@omestre/affiliate-guardian`

```
packages/affiliate-guardian/
├── src/
│   ├── index.ts              # re-exports: verifyConvertedUrl, getExpectedAffiliateCredentials, AffiliateVerification, ...
│   ├── registry.ts           # getExpectedAffiliateCredentials(affiliateId, marketplace) → ExpectedCredentials
│   ├── registry-pure.ts      # extractExpectedCredentialsFromSources (síncrono, dados já carregados)
│   ├── verifier.ts           # verifyConvertedUrl(convertedUrl, expected, marketplace) → AffiliateVerification
│   ├── verifier-pure.ts      # compareUrlParams / isContainedIn (sem I/O)
│   ├── audit.ts              # logAuditDecision(entry) → INSERT fire-and-forget
│   └── __tests__/
│       ├── registry-pure.test.ts
│       ├── verifier-pure.test.ts
│       └── verifier.test.ts
├── package.json              # @omestre/affiliate-guardian, deps: @omestre/db (workspace:*), @omestre/shared (workspace:*)
└── tsconfig.json
```

### 4.1 Registry (`registry.ts`)

```typescript
import {
  MlAffiliateRepository,
  AmazonAffiliateRepository,
  UserCredentialsRepository,
} from '@omestre/db';

export interface ExpectedCredentials {
  affiliateId: number;
  marketplace: string;
  /** Tags/codes que devem aparecer no convertedUrl. */
  affiliateTags: string[];
  /** Indica se o afiliado tem credenciais suficientes para o marketplace. */
  isAuthoritative: boolean;
}

/**
 * Resolve as credenciais ativas do afiliado para um marketplace.
 *
 * Retorna `isAuthoritative: false` quando não há credenciais — o guardião
 * bloqueia (fail-closed) mesmo que o pipeline gere um convertedUrl.
 *
 * Cache local 30s por (affiliateId, marketplace) — alinha com a janela
 * de TTL do cache de conversões (1h) e do send-dedup (1h). TTL menor
 * reduz janela de "race" entre update de credenciais e envio.
 */
export async function getExpectedAffiliateCredentials(
  affiliateId: number,
  marketplace: string,
): Promise<ExpectedCredentials> {
  // verifica cache 30s
  // senão, busca em paralelo: MlAffiliateRepository + AmazonAffiliateRepository + UserCredentialsRepository
  // constrói ExpectedCredentials
  // cache.set
}
```

**Por que cache 30s:** reduz carga no DB (1 query por afiliado a cada 30s, não a cada SendEvent), mas permanece fresco o suficiente para refletir mudança em cookies/tracking IDs.

### 4.2 Verifier (`verifier.ts` + `verifier-pure.ts`)

```typescript
// verifier-pure.ts (sem I/O, 100% testável)
export interface AffiliateVerification {
  valid: boolean;
  reason?: string;
  /** Tags que faltaram ou estavam presentes mas ausentes do registro. */
  expected: string[];
  observed: string[];
}

/**
 * Compara os parâmetros de afiliação extraídos da convertedUrl contra
 * as credenciais esperadas do afiliado.
 *
 * Regras fail-closed:
 *  - 'mercadolivre': URL deve conter melitat OU meliid OU matt_word. Cada
 *    um presente → deve estar em affiliateTags. Se affiliateTags está
 *    vazio → REJEITAR (afiliado sem credenciais ML).
 *  - 'amazon': URL deve conter tag. tag deve estar em affiliateTags.
 *    Se affiliateTags está vazio → REJEITAR.
 *  - 'shopee': URL convertido via shopee.com.br GraphQL não tem
 *    params verificáveis → sempre válido (mas cache de origem deve
 *    ter sido gerado por affiliateId — coberto por auditoria do ingestor).
 *  - QUALQUER outro marketplace → rejeitar (lista fechada).
 */
export function compareConvertedUrlToCredentials(
  marketplace: string,
  extracted: ExtractedAffiliateParams,
  expected: ExpectedCredentials,
): AffiliateVerification;
```

```typescript
// verifier.ts (camada fina de I/O)
export async function verifyConvertedUrl(
  convertedUrl: string | null,
  affiliateId: number,
  marketplace: string,
): Promise<AffiliateVerification> {
  if (!convertedUrl) {
    return { valid: false, reason: 'convertedUrl ausente', expected: [], observed: [] };
  }

  const expected = await getExpectedAffiliateCredentials(affiliateId, marketplace);

  if (!expected.isAuthoritative) {
    return {
      valid: false,
      reason: `Afiliado ${affiliateId} sem credenciais ativas para ${marketplace}`,
      expected: [],
      observed: Object.values(extractAffiliateParams(convertedUrl)).filter(Boolean) as string[],
    };
  }

  const extracted = extractAffiliateParams(convertedUrl);
  return compareConvertedUrlToCredentials(marketplace, extracted, expected);
}
```

### 4.3 Audit (`audit.ts`)

```typescript
import { AffiliateAuditLogRepository } from '@omestre/db';

export async function logAuditDecision(entry: {
  eventId: string;
  mirrorId: number;
  affiliateId: number;
  marketplace: string;
  stage: 'ingestor' | 'dispatcher';
  decision: 'allow' | 'block';
  reason?: string;
  convertedUrl?: string;
  originalUrl?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await new AffiliateAuditLogRepository().record(entry);
  } catch {
    // auditoria é best-effort — não pode bloquear o pipeline
  }
}
```

---

## 5. Integração em 2 pontos (ingestor + dispatcher)

### 5.1 Ingestor — antes do `r.xadd` (apps/ingestor/src/ingestor.ts:466)

**Por que aqui e não no ponto atual (linha 359)?** O verifier atual roda logo após `convertOfferUrl` e antes de `buildSendEvent`. Mover para logo antes do `xadd` (depois de montar `templateText` e `imageUrl`) garante que audita o **SendEvent final** — o que vai para a fila é exatamente o que foi auditado.

```typescript
// Dentro do fan-out — após `return sendEvent` ser construído, antes do push em sendEvents:

const verification = await verifyConvertedUrl(
  conversion.convertedUrl,
  config.affiliateId,
  conversion.marketplace,
);

await logAuditDecision({
  eventId: sendEvent.id,
  mirrorId: config.mirrorId,
  affiliateId: config.affiliateId,
  marketplace: conversion.marketplace,
  stage: 'ingestor',
  decision: verification.valid ? 'allow' : 'block',
  reason: verification.reason,
  convertedUrl: conversion.convertedUrl,
  originalUrl,
  payload: { expected: verification.expected, observed: verification.observed },
});

if (!verification.valid) {
  incrementCounter('pipeline_messages_blocked_total', { reason: 'guardian_rejected' });
  logReflectedOffer({
    affiliateId: config.affiliateId,
    sourceGroupJid,
    targetGroupJid: config.targetGroupJid,
    originalLink: resolvedUrl,
    convertedLink: null,
    marketplace: conversion.marketplace,
    messagePreview: `Bloqueado pelo guardião: ${verification.reason ?? 'mismatch'}`,
    status: 'blocked',
    failureReason: 'guardian_rejected',
  }).catch(() => {});
  return null; // skip o push em sendEvents
}
```

**Decisão:** o `verifyAffiliateLink` (existente) **continua** rodando — ele é a primeira linha. O guardião é a segunda. As duas verificações somam cobertura (parâmetros corretos **E** credenciais ativas).

### 5.2 Dispatcher — tripla validação just-before-send (apps/dispatcher/src/dispatcher.ts:150)

**Esse é o ponto mais importante.** O guardião aqui é a **última palavra** — independente do que entrou na fila, do cache, ou do `mirror-config.ts`. A tripla validação:

```typescript
// Em processSendEvent, entre `mirror` resolvido (linha 99) e `sendMediaOrText` (linha 150):

// ── 3.5 GUARDIAN: tripla validação just-before-send ──
const guardianReport = await runGuardianChecks({
  event, // SendEvent com mirrorId, targetGroupJid, convertedUrl, marketplace
  mirror, // MirrorSendConfig resolvido pelo mirror-config.ts (snapshot inicial)
  affiliateId: mirror.affiliateId,
});

// 1. Mirror continua ativo no momento do envio?
if (guardianReport.mirrorActive === false) {
  // re-fetched em guardianReport.freshMirror.status !== 'inactive'
  await blockAndAudit({
    stage: 'dispatcher',
    reason: `mirror_inactive_at_send_time: was=${mirror.status} now=${guardianReport.freshMirror.status}`,
    auditPayload: {
      mirrorId: mirror.id,
      affiliateId: mirror.affiliateId,
      fromCache: mirror.status,
    },
    event,
    mirror,
    genericUserMessage: 'Falha no envio — verifique os logs',
  });
  return true; // ACK — não retentar; mirror desativado é estado legítimo
}

// 2. targetGroupJid do SendEvent == targetGroupJid atual do mirror?
if (guardianReport.targetGroupMatches === false) {
  await blockAndAudit({
    stage: 'dispatcher',
    reason: `target_group_mismatch: event=${event.targetGroupJid} mirror=${guardianReport.freshMirror.targetGroupJid}`,
    auditPayload: {
      mirrorId: mirror.id,
      affiliateId: mirror.affiliateId,
      eventTarget: event.targetGroupJid,
      mirrorTarget: guardianReport.freshMirror.targetGroupJid,
    },
    event,
    mirror,
    genericUserMessage: 'Falha no envio — verifique os logs',
  });
  return true; // ACK — alvo mudou; configuração do mirror foi editada entre resolução e envio
}

// 3. Link convertido bate com credenciais ativas do afiliado?
const guardianCheck = await verifyConvertedUrl(event.convertedUrl, affiliateId, event.marketplace);

await logAuditDecision({
  eventId: event.id,
  mirrorId: mirror.id,
  affiliateId,
  marketplace: event.marketplace,
  stage: 'dispatcher',
  decision: guardianCheck.valid ? 'allow' : 'block',
  reason: guardianCheck.valid ? undefined : guardianCheck.reason,
  convertedUrl: event.convertedUrl,
  originalUrl: event.originalUrl,
  payload: {
    expected: guardianCheck.expected,
    observed: guardianCheck.observed,
    validationsRun: ['link_owner', 'target_group', 'mirror_active'],
  },
});

if (!guardianCheck.valid) {
  await blockAndAudit({
    stage: 'dispatcher',
    reason: `link_owner_mismatch: ${guardianCheck.reason}`,
    auditPayload: {
      mirrorId: mirror.id,
      affiliateId,
      expected: guardianCheck.expected,
      observed: guardianCheck.observed,
    },
    event,
    mirror,
    genericUserMessage: 'Falha no envio — verifique os logs',
    counter: 'sender_failures_total{type="guardian_rejected"}',
  });
  return true; // ACK — retry não conserta; guardião é autoridade
}

// PASS — segue para envio real
const sent = await measureStep(steps.send, () =>
  sendMediaOrText(mirror.instanceName, mirror.targetGroupJid, text, imageUrl),
);

// Helper local (apps/dispatcher/src/guardian-helpers.ts):
async function blockAndAudit(args) {
  // 1. Log estruturado no affiliate_audit_log (super admin vê)
  await logAuditDecision({
    eventId: args.event.id,
    mirrorId: args.mirror.id,
    affiliateId: args.mirror.affiliateId,
    marketplace: args.event.marketplace,
    stage: args.stage,
    decision: 'block',
    reason: args.reason,
    convertedUrl: args.event.convertedUrl,
    originalUrl: args.event.originalUrl,
    payload: args.auditPayload,
  });
  // 2. Log genérico no reflected_offers.blocked (usuário comum vê)
  await logReflectedOffer({
    affiliateId: args.mirror.affiliateId,
    sourceGroupJid: args.event.sourceGroupJid,
    targetGroupJid: args.mirror.targetGroupJid,
    originalLink: args.event.originalUrl,
    convertedLink: args.event.convertedUrl,
    marketplace: args.event.marketplace,
    messagePreview: args.event.text,
    status: 'blocked',
    failureReason: 'guardian_blocked', // genérico — SEM expor qual validação
  });
  // 3. Counter Prometheus
  if (args.counter) incrementCounter(args.counter, { marketplace: args.event.marketplace });
  // 4. Log estruturado interno
  log('error', 'Guardião bloqueou envio', {
    mirrorId: args.mirror.id,
    affiliateId: args.mirror.affiliateId,
    convertedUrl: args.event.convertedUrl,
    reason: args.reason,
    userVisibleMessage: args.genericUserMessage,
  });
}
```

**Decisão "return true (ACK) ou false (retry)?":** `true` (ACK). Se o guardião bloqueou, a URL está errada OU o alvo mudou OU o mirror desativou — retry não conserta. O SendEvent vai para `affiliate_audit_log` (super admin) + `reflected_offers.blocked` (usuário, com motivo genérico `guardian_blocked`) — o super admin investiga pelo painel Guardião.

**`runGuardianChecks`** (helper em `packages/affiliate-guardian/src/dispatcher-checks.ts`):

- Re-fetch fresco do mirror via `getMirrorSendConfig(mirrorId)` (1 SELECT adicional por SendEvent, O(1) por PK).
- Compara `freshMirror.status !== 'inactive'` → `mirrorActive: boolean`.
- Compara `freshMirror.targetGroupJid === mirror.targetGroupJid` → `targetGroupMatches: boolean`.
- Retorna `{ mirrorActive, targetGroupMatches, freshMirror }`.
- **Cache opcional 5s** por `mirrorId` no dispatcher (mitiga custo de 2x SELECTs por SendEvent em rajadas). Decisão: **começar sem cache**, monitorar, adicionar se p99 > 50ms.

### 5.2a Tabela de decisão (UX)

| Validação reprovou                                     | `failureReason` no `reflected_offers` (visível usuário) | `reason` no `affiliate_audit_log` (visível super admin) |
| ------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------- |
| `mirror_inactive_at_send_time`                         | `guardian_blocked`                                      | `mirror_inactive_at_send_time: was={old} now={new}`     |
| `target_group_mismatch`                                | `guardian_blocked`                                      | `target_group_mismatch: event={a} mirror={b}`           |
| `link_owner_mismatch` (qualquer sub-causa do verifier) | `guardian_blocked`                                      | `link_owner_mismatch: {verifier reason}`                |

> **Princípio:** o usuário vê "não funcionou, procure ajuda"; o super admin vê exatamente o que reprovou. Nenhuma informação técnica de comissão cruzada vaza para o usuário comum — isso evita revelar a existência do guardião (vetor de ataque: usuário poderia tentar bypass se souber).

### 5.3 Contadores Prometheus

Adicionar:

- `pipeline_guardian_rejections_total{stage, marketplace, reason}` — contador no ingestor.
- `sender_guardian_rejections_total{marketplace, reason}` — contador no dispatcher.

---

## 6. Helpers de UI (mínimos)

### 6.1 API — consultar log de auditoria

Novo módulo `apps/api/src/modules/admin/affiliate-audit.routes.ts`:

| Método | Rota                                  | Auth       | Descrição                                       |
| ------ | ------------------------------------- | ---------- | ----------------------------------------------- |
| GET    | `/api/admin/affiliate-audit`          | admin only | Lista decisões (paginated, filtros server-side) |
| GET    | `/api/admin/affiliate-audit/:eventId` | admin only | Timeline de um SendEvent (todas as decisões)    |

Parâmetros da lista: `affiliateId`, `decision` (`allow`/`block`), `since` (ISO ou `Nh`), `offset`, `limit`. Resposta paginated igual ao padrão de `/api/worker/dlq`.

**Gate admin:** mesmo helper `getAdminUser` documentado em `docs/plans/feature-flags.md` §5.1. **Pré-requisito:** admin bootstrap funcionando (Phase 1 do roadmap). Se ainda não estiver, este endpoint fica 100% implementado mas retorna 401/403 — sem impacto na proteção do guardião (que é worker-only).

### 6.2 Frontend — aba "Guardião" em Worker Monitor

Adicionar uma 6ª seção em `apps/web/src/pages/WorkerStatusPage.tsx` (atualmente tem 5):

- **Resumo**: `block rate últimas 24h` + top 5 razões de block.
- **Tabela paginada**: `eventId | affiliateId | stage | decision | reason | timestamp`.
- **Detalhe inline**: clica → modal/painel com `expected` vs `observed` (sem expor `convertedUrl` inteiro se for token — mostra primeiros 50 chars + `…`).

Helpers de UI em `apps/web/src/lib/affiliate-audit.ts` (padrão dos outros libs em `apps/web/src/lib/`).

---

## 7. Testes

### 7.1 Unitários (target ≥ 80% no arquivo)

| Arquivo                                                 | Casos obrigatórios                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/affiliate-guardian/src/verifier-pure.test.ts` | ML: melitat match / mismatch / ausente_n_url / ausente_no_afiliado. Amazon: tag match / mismatch / ausente_n_url / nenhuma ativa no afiliado. Shopee: sempre valid. Listar todas as combinações. |
| `packages/affiliate-guardian/src/registry-pure.test.ts` | Extrai credenciais ativas de um blob de repositório. Filtra tracking IDs inativos. Sinaliza `isAuthoritative: false` quando lista vazia.                                                         |
| `packages/affiliate-guardian/src/verifier.test.ts`      | Mock de repositório. Caminho: convertida válida allow, inválida block, afiliado sem cred → block. Outage do DB propaga como erro (não swallowed).                                                |
| `packages/affiliate-guardian/src/audit.test.ts`         | Mock de repository. INSERT gravado. Erro de DB engole silenciosamente. Repetição com mesmo eventId não dedup (append-only).                                                                      |
| `apps/ingestor/src/ingestor.test.ts` (extensão)         | Cenário: `convertOfferUrl` retorna credenciais do afiliado A, mas cache de conversões tem link do afiliado B. Verifier bloqueia. Log de auditoria gravado.                                       |
| `apps/dispatcher/src/dispatcher.test.ts` (extensão)     | Cenário: SendEvent chega com `convertedUrl` de afiliado errado. Verifier bloqueia. Não envia. ACK. `sender_failures_total{type="guardian_rejected"}` incrementado.                               |

### 7.2 E2E (Playwright)

**Arquivo:** `e2e/affiliate-guardian.api.spec.ts`

| Cenário                                                 | Esperado                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1 — proteção cross-afiliado (link)**                 | Seed 2 afiliados (A=ML, B=ML). Ingestor processa link com `convertOfferUrl` mockado para retornar convertedUrl do afiliado A. Verifier bloqueia o B no ingestor. `affiliate_audit_log` tem 1 decisão `block` para B com `stage=ingestor`, `reason=link_owner_mismatch`.                                                                                                                  |
| **G2 — proteção no dispatcher (link)**                  | Bypassa ingestor. Publica `SendEvent` direto na Queue B com `convertedUrl` do afiliado A para mirrorId do afiliado B. Verifier bloqueia no dispatcher. `affiliate_audit_log` stage=dispatcher. `reflected_offers` tem entrada com `status=blocked, failureReason=guardian_blocked` (genérico, não expõe qual validação). `sender_failures_total{type="guardian_rejected"}` incrementado. |
| **G2a (rev 2) — proteção target_group_mismatch**        | Publica SendEvent com `targetGroupJid=A`. Antes de processar, edita o mirror (via `PUT /api/mirrors/:id`) trocando targetGroups para `[B]`. Verifier bloqueia com `reason=target_group_mismatch: event=A mirror=B`. `affiliate_audit_log` stage=dispatcher. `reflected_offers` failureReason=guardian_blocked.                                                                           |
| **G2b (rev 2) — proteção mirror_inactive_at_send_time** | Publica SendEvent válido para mirror ativo. Imediatamente desativa o mirror (`PATCH /api/mirrors/:id { status: 'inactive' }`). Race window: a checagem `getMirrorSendConfig` foi feita antes do PATCH, mas a re-validação do guardião pega o status novo. Verifier bloqueia com `reason=mirror_inactive_at_send_time`.                                                                   |
| **G3 — outage DB do verifier (fail-closed)**            | Mock de DB retorna erro no registry. Verifier **bloqueia** (fail-closed) com reason `db_unavailable_for_guardian`. Counter `guardian_rejections_total{reason="db_unavailable"}` incrementado.                                                                                                                                                                                            |
| **G4 — admin consulta log**                             | (depende do admin bootstrap) Logar como admin, GET `/api/admin/affiliate-audit`, ver pelo menos 1 decisão `block` para G1. UI exibe a tabela.                                                                                                                                                                                                                                            |
| **G5 — Shopee bypass via guardião**                     | Conversor Shopee não tem params verificáveis. Verifier retorna `valid: true` para URL Shopee. Não bloqueia. (Documenta que a confiança vem do conversor + auditoria do ingestor).                                                                                                                                                                                                        |
| **G6 (rev 2) — UX: usuário vê motivo genérico**         | Usuário comum faz `GET /api/mirrors/logs`. Entrada bloqueada pelo guardião aparece com `failureReason=guardian_blocked` (uma string). **NÃO** expõe qual validação reprovou (`mirror_inactive_at_send_time` / `target_group_mismatch` / `link_owner_mismatch`). Super admin via painel Guardião vê o motivo completo.                                                                    |
| **G7 (rev 2) — super admin vê motivo completo**         | Logar como super admin (`isAdmin=true`). Acessar `GET /api/admin/affiliate-audit?decision=block&since=24h`. Resposta inclui `payload.validationsRun=['link_owner', 'target_group', 'mirror_active']` e `reason` específico. UI renderiza todas as 3 colunas de validação com cores distintas.                                                                                            |

### 7.3 Manual sanity check (pós-E2E)

- Painel `Worker Monitor → Guardião` mostra decisões.
- `bun run test:unit` cobre funções puras do guardião 100%.
- `bun run test:coverage` mantém ≥ 80% ajustado.

---

## 8. Critérios de aceite

- [ ] Migration `00XX_add_affiliate_audit_log.sql` aplicada. `bun run db:migrate` ok.
- [ ] `packages/affiliate-guardian` adicionado ao workspace e importado por `apps/ingestor` + `apps/dispatcher`.
- [ ] `verifyConvertedUrl` retorna `valid: true` para paths legítimos (testes E2E P1–P9 continuam verdes).
- [ ] `verifyConvertedUrl` retorna `valid: false` para todos os 5 vetores de risco do §0.
- [ ] Ingestor: falha de DB no registry → `logAuditDecision` swallow + `verifyConvertedUrl` retorna `{ valid: false, reason: 'db_unavailable_for_guardian' }` → oferta bloqueada (fail-closed).
- [ ] Dispatcher: 1 SELECT por SendEvent (com cache 30s no registry). `bun run typecheck` 0 erros.
- [ ] `bun run test:unit` verde. `bun run test:coverage` mantém ≥ 80% ajustado.
- [ ] `bun run test:e2e` verde para `e2e/affiliate-guardian.api.spec.ts` (G1–G5).
- [ ] E2E existentes (`mirror-pipeline.api.spec.ts`, `worker-status.api.spec.ts`) continuam verdes (sem regressão).
- [ ] `bun run build` verde.
- [ ] Documentação: spec movida para `docs/specs/affiliate-guardian.md` (no PR que entrega). `docs/roadmap.md` atualizado com phases entreges. `docs/README.md` índice atualizado.

---

## 9. Commits sugeridos

1. `feat(db): adicionar tabela affiliate_audit_log` — migration + schema Drizzle + repository.
2. `feat(guardian): package @omestre/affiliate-guardian com registry e verifier` — registry.ts + verifier-pure.ts + verifier.ts + audit.ts + tests.
3. `feat(ingestor): integrar guardião no fan-out com auditoria` — apps/ingestor/src/ingestor.ts:466 + counter Prometheus.
4. `feat(dispatcher): integrar guardião just-before-send` — apps/dispatcher/src/dispatcher.ts:150 + counter Prometheus.
5. `feat(api): endpoint admin /api/admin/affiliate-audit` — `apps/api/src/modules/admin/affiliate-audit.routes.ts` + gate admin.
6. `feat(web): aba Guardião em WorkerStatusPage` — 6ª seção + helpers de UI + `lib/affiliate-audit.ts`.
7. `test(e2e): suite affiliate-guardian cobrindo 5 cenarios` — `e2e/affiliate-guardian.api.spec.ts`.
8. `docs: mover spec para docs/specs/affiliate-guardian.md` + atualizar `docs/roadmap.md` + `docs/README.md`.

> **Heurística:** 4 commits para "core" (1–4) cobrem a proteção. 5–8 são observabilidade. Pode-se quebrar em 2 PRs (PR1: commits 1–4 +7; PR2: 5–6).

---

## 10. Riscos e mitigações

| #   | Risco                                                                                                                       | Probabilidade | Impacto | Mitigação                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Cache de conversões Redis já tem entradas `contaminadas` (geradas antes do guardião). Envio legitimo agora seria rejeitado. | Média         | Médio   | Janela de proteção: ingestion ainda **passa** no registry (afiliado tem credenciais próprias) → cache hit é confiável para o MESMO afiliado. Para entradas cross-afiliado: o guardião **bloqueia** (correto). Limpeza em massa fica como Fase 5. |
| 2   | Outage do banco no verifier **bloqueia todas as ofertas** (fail-closed) — feature flag de bypass manual?                    | Baixa         | Alto    | Adicionar `feature_flags.guardian_enabled` (default `true`). Admin pode pausar via tela já existente. Cobertura Phase 1 do roadmap (bootstrap admin). **Não escopo desta fase** — abrir issue.                                                   |
| 3   | Performance: 1 SELECT por SendEvent no dispatcher. Em pico de 100 msg/s = 100 SELECT/s.                                     | Baixa         | Baixo   | Cache 30s no registry. SELECT é PK lookup em `affiliates` (O(1)). Monitorar `p99` no painel — se > 50ms, reduzir TTL.                                                                                                                            |
| 4   | Falsos positivos: conversor ML gera shortlink sem melitat/matt_word se afiliado usou `generateViaUrlParams`                 | Média         | Médio   | Verifier ML aceita o caminho "sem nenhum param ML" como válido (preserva compatibilidade). Mas se o afiliado **tem** credenciais ML ativas, o caminho "URL sem nenhum param" ainda passa — documentar como melhor-esforço.                       |
| 5   | Auditoria cresce indefinidamente (90 dias não cobertos).                                                                    | Alta          | Médio   | Cron de cleanup mensal fora do escopo deste plano. Tabela tem `created_at` indexada para queries com filtro temporal. Acompanhar tamanho da tabela em `Worker Monitor` no follow-up.                                                             |

---

## 11. Fora do escopo (abrir como issue/follow-up)

1. **Limpeza em massa de cache contaminado**: scan + `DEL` em entradas `omestre:mirror:conversion:*` cujo hash decodificado tenha affiliateId diferente do `convertedUrl`. Requer refator de `conversion-cache.ts` para incluir `affiliateId` no payload (hoje é só `{convertedUrl, marketplace, timestamp}`).
2. **`feature_flags.guardian_enabled`**: feature flag para admin pausar o guardião em emergência. Coberto por Phase 1 do roadmap.
3. **Cron de retention da `affiliate_audit_log`**: DELETE > 90 dias. Mensal.
4. **Painel dedicado de "Affiliate Health"** (cross-affiliate, cross-marketplace): usa a `affiliate_audit_log` como fonte. Fora do escopo até ter dados.
5. **Notificação para o afiliado quando seu `convertedUrl` é bloqueado**: hoje o reject vira log + `reflected_offers.blocked` — sem push para o usuário. UX/prioriade.

---

## 12. Apêndice — referências no código

| Arquivo                                   | Linhas                             | Relevância                                                                                                                              |
| ----------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ingestor/src/link-converters.ts`    | 105–107, 135–137, 170–172, 294–296 | Vetor #1: fallback global via `convertUrl()` lendo `.env` (Pitfall #9 do AGENTS.md).                                                    |
| `apps/ingestor/src/link-converters.ts`    | 92–100                             | Cache de conversão (cache hit) — fonte do vetor #2.                                                                                     |
| `apps/ingestor/src/link-verifier.ts`      | 53–58, 145                         | Vetor #3 (fail-open em erro de DB) e #4 (Amazon sem tracking IDs é fail-open).                                                          |
| `apps/ingestor/src/ingestor.ts`           | 304–410                            | Loop do fan-out. Auditoria entra no lugar de `return sendEvent` antes do `xadd`.                                                        |
| `apps/dispatcher/src/dispatcher.ts`       | 99–167                             | `affiliateId` resolvido pelo `mirror-config.ts:24`. Verifier entra em lugar de `sendMediaOrText`.                                       |
| `apps/dispatcher/src/mirror-config.ts`    | 24–78                              | Já retorna `affiliateId` do `mirrorId`. Sem mudança de contrato.                                                                        |
| `packages/shared/src/mirror-message.ts`   | 31–50                              | `SendEvent` carrega `mirrorId`, `convertedUrl`, `originalUrl`, `marketplace`. Suficiente para o guardião.                               |
| `apps/ingestor/src/link-verifier-pure.ts` | 49–134                             | `extractAffiliateParams` + `verifyMlParams` + `verifyAmazonTag` — lógica que o `verifier-pure.ts` do guardião **estende**, não duplica. |

---

## Revision history

| Date       | Version | Change                                                                                                                            | Reason                                                                                                                                                                                                                |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-30 | 0.1.0   | Plano inicial cobrindo guardião completo (verifier + registry + auditoria)                                                        | Defined para entrega de defesa em profundidade contra comissão cruzada                                                                                                                                                |
| 2026-07-30 | 0.2.0   | Adicionada tripla validação just-before-send (link + targetGroup + mirror ativo) + UX dual (user genérico / super admin completo) | Owner exigiu "auditor independente" + "log super admin exclusivo" + "validar targetGroup + mirror ativo". Vetores 6/7/8 adicionados; G2a/G2b/G6/G7 ampliam cobertura E2E; tabela §5.2a padroniza exposição de motivo. |
