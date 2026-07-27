# Plano: Feature Flags (admin-only) + Modo Manutenção

> **Objetivo:** sistema simples de feature flags para dar segurança na liberação em produção — com destaque para (1) um **modo manutenção** global e (2) um **kill switch do envio de mensagens via Evolution API**. Gestão exclusiva do **admin do sistema**, via tela dedicada no web app.
>
> **Escopo:** flags **booleanas e globais** (liga/desliga para o sistema inteiro). Sem targeting por usuário, sem porcentagem de rollout, sem A/B — YAGNI. Se um dia precisar, o modelo evolui sem quebrar.
>
> **Métrica de impacto:** cada avaliação de flag (`isFeatureEnabled`) é contabilizada em contador por minuto no **Redis** (cross-process), expondo nas telas de admin **quantas consultas aquela flag recebeu na última hora** — dando visibilidade real de quanto a flag está no caminho quente antes de virar um kill switch (opção A confirmada: contamos toda avaliação de flag).

---

## 1. Estado atual (o que já temos e o que falta)

| O que existe                    | Onde                                            | Observação                                                                                                   |
| ------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Auth JWT `{userId, userEmail}`  | `apps/api/src/middleware/auth.ts`               | **Sem papel/role.** O conceito de admin ainda não existe no código.                                          |
| Plano do admin (`is_admin`)     | `docs/planos/historico-precos.md` §5.5          | Já especifica `is_admin` + `ADMIN_EMAILS` + JWT. **Este plano reusa a mesma fundação** (prerequisito comum). |
| Redis singleton (API)           | `apps/api/src/services/redis.ts`                | `cacheGet`/`cacheSet` com fallback silencioso.                                                               |
| Redis nos workers               | `apps/ingestor`, `apps/dispatcher` (ioredis)    | Dispatcher já tem padrão de cache local 60s (`rate-limiter.ts:20`) — mesmo padrão serve para flags.          |
| Loop do Dispatcher              | `apps/dispatcher/src/index.ts:149` (`mainLoop`) | Ponto ideal do kill switch: pausar ANTES do `XREADGROUP` → mensagens acumulam na Queue B, nada é perdido.    |
| Design system Switch/Card/Badge | `apps/web/src/components/ui/`                   | A tela de flags usa `Switch` — zero componente novo.                                                         |
| Migrations                      | `packages/db/src/migrations/` (última: `0015`)  | ⚠️ Numeração compartilhada com o plano do catálogo (`0016`/`0017`). Ver §9 Coordenação.                      |

---

## 2. Decisões de arquitetura

1. **Fonte da verdade: PostgreSQL** (tabela `omestre.feature_flags`). Redis pode reiniciar sem persistência; flag de manutenção não pode "esquecer" o estado.
2. **Leitura quente: cache em memória com TTL curto (10s)** dentro do client, lendo do banco. Sem PubSub, sem invalidação distribuída — um toggle demora no máximo ~10s para propagar a API e workers. Simplicidade > instantaneidade.
3. **Registry tipado no código** (`FlagKey` union + definições com default/descrição). O banco só guarda o estado (`enabled`); rótulo, descrição e default moram no código. Flag desconhecida no banco é ignorada; flag conhecida sem linha no banco usa o default.
4. **Fail-safe por flag**: se banco/Redis estiverem fora, o client retorna o **default da flag** — `maintenance_mode` default `false` (sistema segue no ar), `evolution_send_enabled` default `true` (envio segue funcionando). Falha de infraestrutura nunca derruba o pipeline por causa de flag.
5. **Package à parte:** `packages/feature-flags` (`@omestre/feature-flags`) com registry + client. O **schema Drizzle e o repository ficam em `packages/db`** (convenção do repo — todo schema mora lá). O package depende de `@omestre/db`.
6. **Kill switch = pausa, não descarte.** Com `evolution_send_enabled=false` o Dispatcher para de consumir a Queue B (sleep + re-check). Ao reativar, tudo que acumulou é enviado (rate limiter continua valendo). Nenhuma mensagem é descartada.

---

## 3. Modelo de dados

### 3.1 Tabela `omestre.feature_flags`

```sql
-- packages/db/src/migrations/00XX_add_feature_flags.sql
CREATE TABLE IF NOT EXISTS omestre.feature_flags (
  key         text PRIMARY KEY,             -- ex: 'maintenance_mode'
  enabled     boolean NOT NULL,
  updated_by  text,                         -- email do admin que alterou
  updated_at  timestamp NOT NULL DEFAULT now()
);
```

Sem `id serial` — a `key` é a chave natural. Linha só existe se a flag já foi alterada alguma vez (ausência ⇒ default do registry).

### 3.2 Schema Drizzle

`packages/db/src/schema/featureFlags.ts`:

```typescript
import { boolean, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';

export const featureFlags = omestre.table('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

Exportar em `packages/db/src/schema/index.ts`.

### 3.3 Repository

`packages/db/src/repository/featureFlags.repository.ts` — `FeatureFlagRepository`:

- `findAll(): Promise<FeatureFlagRow[]>`
- `upsert(key: string, enabled: boolean, updatedBy: string): Promise<FeatureFlagRow>` — `INSERT ... ON CONFLICT (key) DO UPDATE`

---

## 4. Package `@omestre/feature-flags`

```
packages/feature-flags/
├── src/
| `index.ts`        # re-exports: isFeatureEnabled, countFlagChecks, invalidateFlagCache, initFlagInvalidation, publishFlagInvalidation, waitForFlagChange, FLAG_DEFINITIONS, ALL_FLAG_KEYS, isFlagKey |
│   ├── registry.ts     # FlagKey + FLAG_DEFINITIONS
│   ├── redis.ts        # singleton Redis best-effort (métrica cross-process)
│   ├── client.ts       # isFeatureEnabled() + countFlagChecks() + cache TTL 10s
│   └── client.test.ts  # unit tests (bun test)
├── package.json        # @omestre/feature-flags, deps: @omestre/db (workspace:*), ioredis (já em @omestre/db)
└── tsconfig.json
```

### 4.1 Registry (`registry.ts`)

```typescript
export type FlagKey = 'maintenance_mode' | 'evolution_send_enabled';

export interface FlagDefinition {
  key: FlagKey;
  label: string; // PT-BR, exibido na UI
  description: string; // PT-BR, exibido na UI
  defaultValue: boolean; // valor quando não há linha no banco / infra fora
  danger: boolean; // UI pede confirmação antes de alterar
}

export const FLAG_DEFINITIONS: Record<FlagKey, FlagDefinition> = {
  maintenance_mode: {
    key: 'maintenance_mode',
    label: 'Modo manutenção',
    description:
      'Bloqueia o acesso de usuários comuns à plataforma. Admins continuam acessando. ' +
      'O pipeline de espelhamento NÃO é afetado por esta flag.',
    defaultValue: false,
    danger: true,
  },
  evolution_send_enabled: {
    key: 'evolution_send_enabled',
    label: 'Envio de mensagens (Evolution)',
    description:
      'Quando desativado, o Dispatcher pausa o envio de mensagens via Evolution API. ' +
      'As mensagens acumulam na fila e são enviadas quando o envio for reativado.',
    defaultValue: true,
    danger: true,
  },
};

export const ALL_FLAG_KEYS = Object.keys(FLAG_DEFINITIONS) as FlagKey[];
export function isFlagKey(key: string): key is FlagKey {
  return key in FLAG_DEFINITIONS;
}
```

> Novas flags no futuro = adicionar entrada aqui. Nada de migration nem UI nova.

### 4.2 Client (`client.ts`) + métrica de impacto

**Redis singleton** (`redis.ts`) — best-effort, nunca lança (a métrica não pode bloquear a flag). Padrão igual a `apps/api/src/services/redis.ts` / ioredis do `worker-common`:

```typescript
import Redis from 'ioredis';
let client: Redis | null = null;
export function getFlagRedis(): Redis | null {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) return null; // sem Redis → métrica desativada, flag continua funcionando
  client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  client.on('error', () => {}); // swallow — métrica nunca quebra a flag
  return client;
}
```

**Client** (`client.ts`):

```typescript
import { FeatureFlagRepository } from '@omestre/db';
import { FLAG_DEFINITIONS, type FlagKey } from './registry.ts';
import { getFlagRedis } from './redis.ts';

const CACHE_TTL_MS = 10_000;
const STATS_TTL_SEC = 7200; // 2h de buckets de minuto (métrica "última hora" + folga)

let cache: { values: Map<string, boolean>; fetchedAt: number } | null = null;
const repo = new FeatureFlagRepository();

function bucketKey(key: FlagKey, date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ymdhm = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}`;
  return `omestre:flag:stats:${key}:${ymdhm}`;
}

/** Contabiliza 1 consulta na janela de minuto atual (best-effort, nunca lança). */
async function recordFlagCheck(key: FlagKey): Promise<void> {
  try {
    const r = getFlagRedis();
    if (!r) return;
    const k = bucketKey(key);
    await r.incr(k);
    await r.expire(k, STATS_TTL_SEC).catch(() => {});
  } catch {
    /* métrica nunca deve quebrar a flag */
  }
}

/** Retorna o estado da flag + registra a consulta (métrica de impacto). */
export async function isFeatureEnabled(key: FlagKey): Promise<boolean> {
  await recordFlagCheck(key);
  const def = FLAG_DEFINITIONS[key];
  try {
    if (!cache || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
      const rows = await repo.findAll();
      cache = {
        values: new Map(rows.map((r) => [r.key, r.enabled])),
        fetchedAt: Date.now(),
      };
    }
    return cache.values.get(key) ?? def.defaultValue;
  } catch {
    return def.defaultValue;
  }
}

/** Soma os buckets de minuto da janela (default 60 min = última hora). */
export async function countFlagChecks(key: FlagKey, minutes = 60): Promise<number> {
  try {
    const r = getFlagRedis();
    if (!r) return 0;
    const now = Date.now();
    const keys: string[] = [];
    for (let i = 0; i < minutes; i++) {
      keys.push(bucketKey(key, new Date(now - i * 60_000)));
    }
    const vals = await r.mget(...keys);
    return vals.reduce((sum, v) => sum + (v ? Number(v) : 0), 0);
  } catch {
    return 0;
  }
}

/** Invalida o cache local (usado pela API logo após um PATCH). */
export function invalidateFlagCache(): void {
  cache = null;
}
```

**Por que Redis (e não contador em memória no package):**

- Contador em memória seria **por-processo** — a tela mostraria só o da API e esconderia o impacto do dispatcher (que também avalia `evolution_send_enabled`).
- Redis por minuto soma 60 buckets via `MGET` (O(1)) e é **cross-process de graça**: `countFlagChecks` lê o total agregado de TODOS os processos (API + dispatcher). Uma só métrica, fiel.
- `EX 7200` nos buckets garante auto-limpeza (não cresce indefinidamente); a janela "última hora" sempre disponível.

**Opção A (confirmada):** contamos **toda avaliação** de flag. Para `maintenance_mode` ≈ requests dos usuários (ótimo). Para `evolution_send_enabled` reflete iterações do loop do dispatcher (não mensagens individuais) — coerente e centralizado; refinamento "mensagens impactadas" fica fora do escopo.

Padrão idêntico ao cache de config do rate-limiter (`apps/dispatcher/src/rate-limiter.ts`) — já validado no projeto.

**Nota (pitfall conhecido):** `--hot` do Bun não observa `packages/` — mudar o package exige restart manual dos apps em dev.

### 4.3 Propagação imediata (Redis PubSub)

O TTL de 10s do cache (§4.2) é apenas **fallback** (processo que reinicia e perde o aviso, ou Redis fora). Para "atualizar a flag o quanto antes" quando o admin alterna, usamos **invalidação por PubSub** — padrão já usado no repo (API→Worker via Redis).

- **Canal:** `omestre:flag:invalidate`.
- No PATCH (`feature-flags.routes.ts`), após `upsert` + `invalidateFlagCache()` local, a API publica `""` nesse canal.
- Todos os processos (API + dispatcher, via `initFlagInvalidation()` no startup) assinam o canal; ao receber mensagem → `invalidateFlagCache()` **imediato** (próxima avaliação já lê o banco) + acordam esperas pausadas.
- **Efeito:** toggle propaga em **sub-segundo**, sem polling.

`redis.ts` (package) ganha o subscriber + helpers:

```typescript
let sub: Redis | null = null;
let wakeWaiters: Array<() => void> = [];

/** Assina o canal de invalidação. Chamar no startup da API e do dispatcher. */
export function initFlagInvalidation(): void {
  try {
    const url = process.env.REDIS_URL;
    if (!url || sub) return;
    sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    sub.on('error', () => {});
    sub.subscribe('omestre:flag:invalidate').catch(() => {});
    sub.on('message', () => {
      invalidateFlagCache();
      const ws = wakeWaiters;
      wakeWaiters = [];
      ws.forEach((f) => f()); // acorda dispatcher pausado
    });
  } catch {
    /* sem Redis → só o TTL de 10s cobre */
  }
}

/** Publica invalidação (chamado pela API após PATCH). Best-effort. */
export function publishFlagInvalidation(): void {
  try {
    getFlagRedis()
      ?.publish('omestre:flag:invalidate', '')
      .catch(() => {});
  } catch {
    /* best-effort */
  }
}

/** Resolve após timeout OU ao receber invalidação (usado pelo dispatcher pausado). */
export function waitForFlagChange(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    const w = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = () => {
      wakeWaiters = wakeWaiters.filter((x) => x !== w);
    };
    wakeWaiters.push(w);
  });
}
```

- A API chama `initFlagInvalidation()` no startup (multi-réplica safe; numa instância única o `invalidateFlagCache()` local já basta, mas o subscriber cobre toggles de outras instâncias futuras).
- **O dispatcher é quem mais se beneficia**: não tem request para "esperar", então precisa ser acordado — ver §6.

---

## 5. API — módulo admin

### 5.1 Fundação admin (prerequisito compartilhado — ver §9)

Idêntica ao especificado em `docs/planos/historico-precos.md` §5.5.1:

1. Migration `ALTER TABLE omestre.users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;`
2. `packages/db/src/schema/users.ts`: `isAdmin: boolean('is_admin').notNull().default(false)` (+ `toPublic` em `users.repository.ts`).
3. `ADMIN_EMAILS` (env, CSV): no register/login (`auth.routes.ts`), se o email está na lista → garante `is_admin=true` no banco.
4. JWT: `isAdmin` no payload do `jwt.sign`, no schema do `createJwtPlugin` e no `AuthUser` (`middleware/auth.ts`). `/api/auth/me` retorna `isAdmin`.
5. Novo helper em `middleware/auth.ts`:

```typescript
export async function getAdminUser(jwtInstance, headers): Promise<AuthUser | null> {
  const auth = await getAuthUser(jwtInstance, headers);
  return auth?.isAdmin ? auth : null;
}
```

### 5.2 Rotas de flags

Novo módulo `apps/api/src/modules/admin/feature-flags.routes.ts`, montado em `apps/api/src/index.ts`:

| Método | Rota                            | Auth       | Descrição                                                                  |
| ------ | ------------------------------- | ---------- | -------------------------------------------------------------------------- |
| GET    | `/api/admin/feature-flags`      | admin only | Lista todas as flags: definição do registry + estado atual + updated_at/by |
| PATCH  | `/api/admin/feature-flags/:key` | admin only | Body `{ enabled: boolean }` → upsert no banco + `invalidateFlagCache()`    |

- Não autenticado → HTTP 401. Autenticado não-admin → **HTTP 403** `{ success: false, error: 'Acesso restrito ao administrador' }` (mesma convenção do plano do catálogo — gate admin é exceção à regra "sempre 200").
- `:key` inválida (não está no registry) → HTTP 200 `{ success: false, error: 'Flag desconhecida' }` (erro de negócio).
- Resposta do GET (inclui métrica de impacto):

```typescript
{
  success: true,
  flags: [
    {
      key: 'maintenance_mode',
      label: 'Modo manutenção',
      description: '...',
      danger: true,
      enabled: false,          // estado efetivo (banco ?? default)
      isDefault: true,         // true se não há linha no banco
      updatedBy: null,
      updatedAt: null,
      checksLastHour: 1423,    // contador cross-process (Redis) das avaliações na última hora
    },
    ...
  ]
}
```

- `checksLastHour` vem de `countFlagChecks(key, 60)` (agregado de API + dispatcher via Redis). Se o Redis estiver indisponível, vem `0` (métrica degrada graciosamente, não quebra a tela).

- Após o `upsert` + `invalidateFlagCache()` local → `publishFlagInvalidation()` (publica no canal `omestre:flag:invalidate` via PubSub para os demais processos — v. §4.3).
- Todo PATCH gera log estruturado: `{ flag, enabled, updatedBy }` — trilha de auditoria mínima via stdout.

### 5.3 Gate de manutenção na API

Em `apps/api/src/index.ts`, um `onBeforeHandle` global (ou guard nos módulos de negócio):

```typescript
// Pseudo — checar rota e flag
if (await isFeatureEnabled('maintenance_mode')) {
  const isExempt =
    path.startsWith('/webhook') || // Evolution continua entregando eventos
    path.startsWith('/api/auth') || // login precisa funcionar (admin entra)
    path.startsWith('/api/admin') || // admin gerencia flags para SAIR da manutenção
    path === '/health';
  if (!isExempt) {
    const auth = await getAuthUser(jwt, headers);
    if (!auth?.isAdmin) {
      return {
        success: false,
        error: 'Sistema em manutenção. Tente novamente em instantes.',
        maintenance: true,
      };
    }
  }
}
```

Regras:

- **Admin bypassa tudo** — precisa navegar no sistema durante a manutenção.
- **`/webhook/message` nunca é bloqueado** — mensagens continuam entrando no pipeline (manutenção é da UI/API de usuário, não do espelhamento). Para pausar o espelhamento existe a outra flag.
- Resposta HTTP 200 com `maintenance: true` — o frontend usa esse campo para exibir a tela de manutenção.

---

## 6. Dispatcher — kill switch de envio

`apps/dispatcher/src/index.ts`, no topo do `while (true)` do `mainLoop()` (linha ~162), ANTES do `xreadgroup`:

````typescript
import { isFeatureEnabled } from '@omestre/feature-flags';
```typescript
let wasPaused = false;
while (true) {
  if (!(await isFeatureEnabled('evolution_send_enabled'))) {
    if (!wasPaused) {
      log('warn', 'Envio pausado por feature flag (evolution_send_enabled=false)');
      wasPaused = true;
    }
    // Acorda na hora se a flag voltar (PubSub); 5s é só fallback (v. §4.3)
    await waitForFlagChange(5_000);
    continue;
  }
  wasPaused = false;
  // ... xreadgroup existente
}
````

Comportamento:

- Pausa **antes** de ler a fila → nada entra na PEL, nada é perdido, XLEN da Queue B cresce (visível no `/worker-status`).
- O dispatcher chama `initFlagInvalidation()` no startup (assina o canal de invalidação).
- Re-ativar é **imediato** (PubSub acorda o `waitForFlagChange` em sub-segundo); os 5s são só fallback caso o aviso seja perdido. O TTL de 10s do cache cobre processo que reiniciou.
- Log `warn` uma vez por ciclo de pausa — considerar logar só na transição (flag booleano local `wasPaused`) para não poluir stdout.
- `evolution_send_enabled` **não afeta** API nem Ingestor — o pipeline continua convertendo e enfileirando. É exatamente o cenário "Evolution API em manutenção / número em risco de ban: segura o envio, não perde oferta".
- Adicionar `dispatcher_paused_by_flag` como gauge/counter no metrics-server (opcional, ver §10).

> **Ingestor não precisa de flag nesta fase.** Pausar só o envio já cobre o caso de uso; pausar o ingest deixaria a Queue A crescer sem benefício adicional. Se surgir necessidade, é +1 entrada no registry.

---

## 7. Frontend

### 7.1 `useAuth` + AppShell (fundação admin)

- `apps/web/src/hooks/useAuth.ts`: tipo `User` ganha `isAdmin?: boolean` (propagado do `/api/auth/me`).
- `apps/web/src/components/layout/AppShell.tsx`:
  - `NavItem` ganha `'feature-flags'`; item "Feature Flags" (ícone `ToggleLeft` ou `Flag` do lucide) **renderizado só se `user.isAdmin`**.
  - Atualizar `pathToNav()` e `pageTitles` (pitfall das 3 alterações por rota nova, +`App.tsx`).

### 7.2 Página `FeatureFlagsPage` (admin-only)

`apps/web/src/pages/FeatureFlagsPage.tsx`, rota `/feature-flags` em `App.tsx` (dentro do `ProtectedRoute`; a página redireciona para `/` se `!user.isAdmin` — defense in depth, o 403 do backend é a fonte de verdade).

Layout (lista simples — poucas flags, sem master-detail):

```
┌─ Feature Flags ────────────────────────────────────────────┐
│                                                            │
│  ┌─ Card ──────────────────────────────────────────────┐   │
│  │ Modo manutenção                    [Switch: OFF]    │   │
│  │ Bloqueia o acesso de usuários comuns à plataforma…  │   │
│  │ (padrão)                                            │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─ Card ──────────────────────────────────────────────┐   │
│  │ Envio de mensagens (Evolution)      [Switch: ON]    │   │
│  │ Quando desativado, o Dispatcher pausa o envio…      │   │
│  │ Alterado por admin@x.com em 27/07/2026 14:32        │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

- Um `Card` por flag: `label` (título), `description` (texto muted), `Switch` do design system, rodapé com `updatedBy`/`updatedAt` ou "(padrão)".
- **Métrica de impacto** (abaixo da descrição, texto muted): `Consultas na última hora: {checksLastHour}`. Vem do `checksLastHour` do GET (agregado cross-process Redis). Dá ao admin a noção real de quanto a flag está "no caminho quente" antes de virá-la — ex.: `maintenance_mode` ligada mostra a carga de requests dos usuários; `evolution_send_enabled` mostra a atividade do loop do dispatcher.
- Flags com `danger: true` → `window.confirm` (ou `Dialog` do design system) antes do PATCH: "Ativar modo manutenção? Usuários comuns perderão acesso imediatamente."
- Toggle otimista com rollback em erro; badge de estado (`Badge` verde "Ativa" / neutra "Inativa") opcional.
- CSS vars do design system, **nunca cores hardcoded**. PT-BR em todos os labels.

### 7.3 Tela de manutenção para usuário comum

- `apps/web/src/lib/` — o helper de fetch autenticado (ou os pontos de fetch das páginas) detecta `maintenance: true` na resposta e seta estado global (context simples ou estado no `App.tsx`).
- `apps/web/src/pages/MaintenancePage.tsx`: tela full-screen "🔧 Em manutenção — voltamos já" (sem sidebar), exibida para usuário comum quando qualquer chamada retorna `maintenance: true`.
- Admin nunca vê essa tela (backend não retorna `maintenance` para admin).

---

## 8. Testes

### 8.1 Unit (`bun run test:unit`)

- `packages/feature-flags/src/client.test.ts`:
  - default quando não há linha no banco (mock do repository)
  - valor do banco sobrepõe default
  - cache: 2ª chamada dentro do TTL não re-consulta; `invalidateFlagCache()` força re-fetch
  - repo lançando erro → retorna `defaultValue`, não propaga
  - `isFlagKey` rejeita chave desconhecida
  - **métrica**: `countFlagChecks` soma buckets quando Redis mock retorna valores; retorna `0` se Redis nulo/erro; `isFeatureEnabled` chama `recordFlagCheck` (INCR no bucket do minuto atual)
  - **invalidation**: `initFlagInvalidation` registra handler que chama `invalidateFlagCache` + resolve `waitForFlagChange`; `publishFlagInvalidation` publica no canal; handler de `message` acorda waiters (assert que `waitForFlagChange` resolve antes do timeout ao simular mensagem)
- `apps/api/src/modules/__tests__/feature-flags.routes.test.ts` (se houver padrão de teste de rota): 401/403/PATCH ok/flag desconhecida.

### 8.2 E2E (Playwright — `bun run test:e2e`, obrigatório para UI nova)

`e2e/feature-flags.api.spec.ts`:

- GET sem token → 401; com token não-admin → 403; com admin → lista com as 2 flags e defaults corretos
- PATCH `maintenance_mode=true` → GET de rota de negócio com usuário comum retorna `maintenance: true`; admin continua acessando; `/api/auth/*` e `/webhook/message` não bloqueados
- PATCH volta `false` → acesso normal restaurado
- PATCH flag desconhecida → `success: false`
- GET traz `checksLastHour` agregado; após N requests com `maintenance_mode=true`, `checksLastHour >= N`

`e2e/feature-flags.ui.spec.ts`:

- Login admin → item "Feature Flags" na sidebar → página lista flags → toggle persiste após reload
- Login usuário comum → item ausente na sidebar; navegar direto para `/feature-flags` → redirect para `/`
- Usuário comum com `maintenance_mode=true` → vê a MaintenancePage

> Setup E2E: seed do admin via `ADMIN_EMAILS` no compose E2E (`e2e/docker-compose.e2e.yml`, env do `api-e2e`) + registro do usuário admin no helper de auth existente.

### 8.3 Validação manual (stack dev)

```bash
docker compose -f docker-compose.dev.yml up -d --build api dispatcher web
# 1. Desativar envio via UI → injetar mensagem real no grupo de origem
# 2. Verificar XLEN da Queue B crescendo (worker-status) e log 'Envio pausado' no dispatcher
docker logs omestre_dev_dispatcher --tail 20
# 3. Reativar → mensagens acumuladas são enviadas (respeitando rate limit)
```

---

## 9. Coordenação com o plano do catálogo (histórico de preços)

Os dois planos compartilham a **fundação admin** (`is_admin` + `ADMIN_EMAILS` + JWT + `useAuth.isAdmin` + filtro de nav no AppShell). Regras:

1. **Quem implementar primeiro cria a fundação** — a migration de `is_admin` e as mudanças em auth/useAuth/AppShell são idênticas nos dois planos; o segundo plano só consome.
2. **Numeração de migrations:** o plano do catálogo reservou `0016`/`0017`. Este plano usa **o próximo número livre no momento da implementação** (se rodar antes do catálogo: `0016_add_users_is_admin.sql` + `0017_add_feature_flags.sql`; o catálogo renumera). Conferir `ls packages/db/src/migrations/` antes de gerar.
3. Como feature flags é pré-requisito de **produção** e o catálogo é feature de produto, a ordem sugerida é **feature flags primeiro** (leva a fundação admin junto).

---

## 10. Fases de implementação (ordem sugerida)

| Fase | Entrega                                                                                                                                                      | Depende de |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1    | **Fundação admin**: migration `is_admin`, schema/repo users, `ADMIN_EMAILS`, JWT, `/me`, `getAdminUser`                                                      | —          |
| 2    | **DB flags**: migration `feature_flags`, schema Drizzle, `FeatureFlagRepository` (+ export no index)                                                         | —          |
| 3    | **Package**: `packages/feature-flags` (registry + `redis.ts` best-effort + client `isFeatureEnabled`/`countFlagChecks` + unit tests), registrar no workspace | 2          |
| 4    | **API**: rotas `/api/admin/feature-flags` (GET/PATCH) + gate de manutenção `onBeforeHandle`                                                                  | 1, 3       |
| 5    | **Dispatcher**: check `evolution_send_enabled` no mainLoop (+ log de transição)                                                                              | 3          |
| 6    | **Web**: `useAuth.isAdmin`, AppShell (nav condicional), `FeatureFlagsPage`, `MaintenancePage`                                                                | 4          |
| 7    | **E2E**: specs api + ui, seed admin no compose E2E                                                                                                           | 4, 5, 6    |
| 8    | **Docs**: atualizar `AGENTS.md` (nova tabela, package, env `ADMIN_EMAILS`, rota web) e skill do projeto                                                      | tudo       |

Cada fase = commit próprio (conventional commits: `feat(db):`, `feat(api):`, `feat(web):`...). Typecheck 0 warnings + `bun run test:unit` verdes por fase; `bun run test:e2e` na fase 7.

**Arquivos novos:** `packages/db/src/schema/featureFlags.ts`, `packages/db/src/repository/featureFlags.repository.ts`, `packages/db/src/migrations/00XX_*.sql` (x2), `packages/feature-flags/src/{index,registry,redis,client}.ts` + `client.test.ts` + `package.json`/`tsconfig.json`, `apps/api/src/modules/admin/feature-flags.routes.ts`, `apps/web/src/pages/FeatureFlagsPage.tsx`, `apps/web/src/pages/MaintenancePage.tsx`, `e2e/feature-flags.api.spec.ts`, `e2e/feature-flags.ui.spec.ts`.

**Arquivos alterados:** `packages/db/src/schema/{users,index}.ts`, `packages/db/src/repository/users.repository.ts`, `packages/db/src/index.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/modules/auth/auth.routes.ts`, `apps/api/src/index.ts`, `apps/dispatcher/src/index.ts`, `apps/web/src/hooks/useAuth.ts`, `apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/App.tsx`, `.env.example` (+`ADMIN_EMAILS`), `AGENTS.md`.

---

## 11. Riscos e questões abertas

1. **Propagação**: com PubSub (§4.3) o toggle é sub-segundo em todos os processos; o TTL de 10s do cache é apenas fallback (caso o aviso seja perdido ou Redis esteja fora). Se Redis estiver indisponível, pior caso ~10s — aceitável para manutenção/kill switch.
2. **`maintenance_mode` não pausa o webhook nem o pipeline** (decisão deliberada — manutenção é da experiência do usuário). Se a manutenção for do _banco_ (migration pesada), o operador deve ativar as **duas** flags. Documentar isso na descrição da flag? (proposto: sim, já está na description).
3. **Dispatcher pausado por muito tempo** → Queue B cresce (maxlen do stream trunca em cenários extremos) e, ao reativar, rajada de envios limitada pelo rate limiter — comportamento desejado, mas vale monitorar o XLEN no worker-status durante manutenções longas.
4. **Client no dispatcher usa conexão PG** — o dispatcher hoje já depende de `@omestre/db` (resolve mirrorId), então não há dependência nova. Confirmar na implementação que `getDb()` está inicializado no startup do dispatcher.
5. **Auditoria**: por ora, `updated_by/updated_at` (última alteração) + log estruturado no stdout. Histórico completo de alterações (tabela de audit) fica de fora — YAGNI.
