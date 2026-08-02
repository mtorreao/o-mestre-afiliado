# Plano — Rotação de Tokens JWT (access curto + refresh rotativo)

## 1. Contexto e objetivo

### Problema

Hoje o usuário é derrubado do app **a cada 7 dias, mesmo estando ativo**
(`JWT_EXPIRATION_SECONDS = 604800` em `apps/api/src/middleware/jwt-expiry-pure.ts`).
Não existe rotação/refresh: `useAuth` guarda um único JWT em `localStorage`, valida
no boot via `/api/auth/me` e, ao expirar, desloga o usuário.

### Objetivo mensurável

- Usuário ativo **não** é deslogado; a sessão renova silenciosamente.
- `accessToken` de **1h** + `refreshToken` de **30d** com rotação.
- Reuso de refresh token (roubo) invalida a **família**.

### Critério de sucesso

- [ ] `bun run typecheck` → 0 erros.
- [ ] `bun run test:unit` → verde (novos testes incluídos).
- [ ] `bun run build` → verde (api + web).
- [ ] `POST /api/auth/refresh` existe e gira refresh + retorna novo access.
- [ ] `POST /api/auth/logout` revoga o refresh token.
- [ ] Interceptor frontend renova proativamente e recupera de 401.
- [ ] Cobertura de lógica nova ≥ 80% (isolada em `*-pure.ts`).

---

## 2. Estado atual (código existente)

| Caminho                                      | Papel                                                       |
| -------------------------------------------- | ----------------------------------------------------------- |
| `apps/api/src/middleware/auth.ts`            | `createJwtPlugin()` + `getAuthUser()`/`getSuperAdminUser()` |
| `apps/api/src/middleware/jwt-expiry-pure.ts` | `JWT_EXPIRATION_SECONDS=604800` (7d), `buildJwtExpiry()`    |
| `apps/api/src/modules/auth/auth.routes.ts`   | login/register (assinam c/ `exp`), `GET /me`                |
| `apps/api/src/config.ts`                     | env vars (`JWT_SECRET`, `ADMIN_EMAILS`)                     |
| `apps/web/src/hooks/useAuth.ts`              | token em localStorage (`omestre_auth_token`)                |
| `apps/web/src/lib/api-client.ts`             | `fetchApi<T>()` wrapper typed                               |
| `apps/web/src/App.tsx`                       | `ProtectedRoute`/`GuestRoute`                               |
| `packages/db/src/schema/`                    | tabelas Drizzle (schema `omestre`)                          |
| `packages/db/src/repository/`                | repos Drizzle                                               |
| `packages/db/src/migrations/`                | `.sql` + `meta/_journal.json` (próximo idx livre = 0022)    |

### O que falta

- Tabela de refresh tokens c/ hash + família + revogação.
- Rota `/api/auth/refresh` com rotação + detecção de replay.
- Rota `/api/auth/logout`.
- Env: `ACCESS_TOKEN_EXPIRATION_SECONDS` (1h), `REFRESH_TOKEN_EXPIRATION_SECONDS` (30d).
- Frontend: store de sessão + interceptor proativo + refresh no 401.

---

## 3. Modelo de dados

Nova tabela `omestre.auth_refresh_tokens`:

```sql
-- 0022_add_auth_refresh_tokens.sql
CREATE SCHEMA IF NOT EXISTS omestre;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS omestre.auth_refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES omestre.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  revoked_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_refresh_tokens_user_id ON omestre.auth_refresh_tokens (user_id);
--> statement-breakpoint
CREATE INDEX idx_refresh_tokens_family_id ON omestre.auth_refresh_tokens (family_id);
```

Drizzle (`packages/db/src/schema/authRefreshTokens.ts`):

```ts
import { serial, text, integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

export const authRefreshTokens = omestre.table('auth_refresh_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  familyId: uuid('family_id').notNull(),
  revokedAt: timestamp('revoked_at'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

> Decisão: guardar **hash** do token, nunca o token opaco cru. O refresh token enviado ao
> cliente é opaco (64 hex chars) e só o hash fica no banco.

---

## 4. Contratos de API

### POST /api/auth/login (alterado — resposta ganha refreshToken)

Request: `{ email, password }`. Resposta 200:

```json
{ "success": true, "token": "<access 1h>", "refreshToken": "<opaque>", "user": {...} }
```

### POST /api/auth/register (alterado — resposta ganha refreshToken)

Igual antes, adiciona `refreshToken`.

### POST /api/auth/refresh (NOVA)

Request: `{ refreshToken: string }`. Resposta 200:

```json
{ "success": true, "token": "<access 1h>", "refreshToken": "<novo opaque>" }
```

Erros:

- inválido/expirado/revogado -> 401 `{ success:false, error:"Refresh token inválido" }`
- **replay** -> revoga família inteira -> 401 `{ success:false, error:"Sessão revogada, faça login novamente" }`

### POST /api/auth/logout (NOVA)

Request: `{ refreshToken?: string }`. Resposta 200 `{ success:true }` (idempotente).

---

## 5. Fluxo de dados

```
login  -> valida credenciais -> access JWT (1h) + opaque refresh + hash + family_id
       -> INSERT auth_refresh_tokens -> { token, refreshToken, user }

refresh-> hash(body.refreshToken) -> SELECT by token_hash
       -> nao existe -> 401
       -> revogado: replay(nao expirou) revoga família -> 401 "Sessão revogada"
                    expirado -> 401 "Refresh token inválido"
       -> vivo: REVOKE antigo (rotação) + INSERT novo (mesmo family) + novo access -> { token, refreshToken }

logout -> hash(refreshToken) -> UPDATE revoked_at=now WHERE token_hash -> { success:true }
```

---

## 6. Lógica pura isolada

`apps/api/src/middleware/token-pure.ts`:

```ts
export const ACCESS_TOKEN_SECONDS = 60 * 60; // 1h
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60; // 30d
export function buildAccessTokenExpiry(now = Date.now()): number;
export function buildRefreshTokenExpiry(now = Date.now()): number;
export function generateRefreshToken(): string; // 64 hex chars opaco
export function hashRefreshToken(token: string): string;
export function newFamilyId(): string;
```

`apps/web/src/lib/token-http-pure.ts`:

```ts
export function decodeJwtPayload<T>(token): T | null;
export function accessTokenExpiresAtMs(accessToken): number;
export function shouldRefreshNow(accessToken, nowMs, marginMs?): boolean;
export function shouldAttemptRefresh(status): boolean; // === 401
```

---

## 7. Pontos de integração

### Backend

- **novo** `packages/db/src/schema/authRefreshTokens.ts`
- **novo** `packages/db/src/repository/authRefreshTokens.repository.ts` (+ .test.ts)
- **novo** `packages/db/src/migrations/0022_add_auth_refresh_tokens.sql` + journal + snapshot
- **mod** `packages/db/src/schema/index.ts` -> export
- **mod** `packages/db/src/index.ts` -> export repo
- **mod** `apps/api/src/config.ts` -> ACCESS/REFRESH_TOKEN_EXPIRATION_SECONDS
- **mod** `apps/api/src/modules/auth/auth.routes.ts` -> login/register emitem refresh; + /refresh /logout
- **novo** `apps/api/src/middleware/token-pure.ts`

### Frontend

- **novo** `apps/web/src/lib/session.ts`
- **novo** `apps/web/src/lib/auth-refresh.ts`
- **mod** `apps/web/src/hooks/useAuth.ts`
- **mod** `apps/web/src/lib/api-client.ts`
- **mod** `apps/web/src/App.tsx`

---

## 8. Testes

### apps/api

- `token-pure.test.ts`: expirys (1h/30d), generate (64 hex), hash (determinístico, difere p/ tokens), uuid.
- `auth.routes.refresh.test.ts`: login -> 200+refresh; refresh válido -> novos tokens + antigo revogado;
  desconhecido -> 401; replay -> 401 + família revogada; logout revoga e refresh seguinte 401.

### packages/db

- `authRefreshTokens.repository.test.ts`: create, findByHash, revokeById, revokeFamilyByFamilyId.

### web (puro)

- `token-http-pure.test.ts`: decodeJwtPayload, shouldRefreshNow, shouldAttemptRefresh.

---

## 9. Critérios de aceite

- [ ] typecheck branch = 0 erros
- [ ] `bun run test:unit` verde
- [ ] `bun run build` verde
- [ ] login retorna refreshToken
- [ ] /refresh emite novos tokens (rotação)
- [ ] replay -> família revogada
- [ ] logout revoga sessão
- [ ] interceptor renova proativamente + recupera 401
- [ ] usuário ativo não é deslogado; queda só após 30d sem uso
- [ ] cobertura nova >= 80%

---

## 10. Commits sugeridos

1. `feat(db): tabela auth_refresh_tokens + repo + migration 0022`
2. `feat(api): rotas refresh e logout com rotação`
3. `feat(api): emitir refreshToken no login/register e access exp 1h`
4. `feat(web): store de sessão + interceptor proativo`
5. `test(api): rotas de refresh/rotação`
6. `test(db): repo auth_refresh_tokens`
7. `test(web): session + interceptor`

---

## 11. Riscos e mitigações

- Migração quebra chain (drizzle generate destrutivo): usar Path B manual + CREATE IF NOT EXISTS idempotente.
- Múltiplos requests simultâneos disparam N refreshes: lock de concorrência (1 promise).
- Token opaco em localStorage (XSS): já é assim hoje; ideal HttpOnly cookie, documentado como mitigação parcial.
- Deslogar ativo na janela: margem proativa de 120s + fallback no 401; só desloga se refresh falhar.
