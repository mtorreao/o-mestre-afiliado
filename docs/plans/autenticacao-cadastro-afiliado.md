# Plano: Autenticação + Cadastro de Afiliado

**Data:** 20/07/2026
**Contexto:** Adicionar sistema de autenticação (email + senha) e cadastro de afiliado com credenciais por marketplace (Shopee, Mercado Livre) e botão de teste.

---

## Visão Geral

Cada usuário da plataforma pode:
1. Criar conta (email + senha)
2. Configurar suas próprias credenciais dos marketplaces
3. Testar a geração de links de afiliado com suas credenciais

---

## 🔷 FASE 1 — Banco de Dados (Drizzle Schema)

### 1. Nova tabela `omestre.users`

```sql
CREATE TABLE omestre.users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

### 2. Nova tabela `omestre.user_credentials`

Uma única linha por usuário com todas as credenciais de marketplace não-OAuth.

```sql
CREATE TABLE omestre.user_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES omestre.users(id),
  -- Shopee
  shopee_app_id TEXT,
  shopee_app_secret TEXT,
  -- Metadados
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(user_id)
);
```

### 3. Adicionar `user_id` FK na tabela `ml_affiliates`

```sql
ALTER TABLE omestre.ml_affiliates ADD COLUMN user_id INTEGER REFERENCES omestre.users(id);
```

Isso vincula um afiliado ML já conectado via OAuth ao usuário da plataforma.

### Arquivos

| Arquivo | Ação |
|---------|------|
| `packages/db/src/schema/users.ts` | Schema da tabela users |
| `packages/db/src/schema/userCredentials.ts` | Schema da tabela user_credentials |
| `packages/db/src/schema/index.ts` | Adicionar `user_id` em `ml_affiliates`, exportar novos schemas |
| `packages/db/src/index.ts` | Exportar novos schemas e repositórios |
| `packages/db/src/repository/users.repository.ts` | CRUD users |
| `packages/db/src/repository/userCredentials.repository.ts` | CRUD credentials |

---

## 🔷 FASE 2 — Autenticação (API)

### Endpoints

| Método | Rota | Descrição | Auth |
|--------|------|-----------|------|
| POST | `/api/auth/register` | Criar conta (email, name, password) | ❌ |
| POST | `/api/auth/login` | Login (email, password) → JWT | ❌ |
| GET | `/api/auth/me` | Dados do usuário logado | ✅ JWT |

### Fluxo

- **Register:** Hash da senha com `Bun.password.hash()`, cria usuário + credentials vazias, retorna JWT
- **Login:** Verifica hash com `Bun.password.verify()`, retorna JWT (payload: `{ userId, email }`)
- **Me:** Lê JWT do header `Authorization: Bearer <token>`, retorna dados do usuário

### Middleware JWT

```
apps/api/src/middleware/auth.ts
```

- Usa `@elysiajs/jwt`
- Popula `ctx.userId` e `ctx.userEmail`
- Bloqueia requisições sem token válido (retorna 401)

### Dependência

```
bun add @elysiajs/jwt
```

### Arquivos

| Arquivo | Ação |
|---------|------|
| `apps/api/src/middleware/auth.ts` | Middleware JWT |
| `apps/api/src/modules/auth/auth.routes.ts` | Rotas de auth |
| `apps/api/src/modules/auth/auth.service.ts` | Lógica (hash, geração JWT) |
| `apps/api/src/index.ts` | Registrar módulo auth |

---

## 🔷 FASE 3 — Perfil do Afiliado (API)

### Endpoints

| Método | Rota | Descrição | Auth |
|--------|------|-----------|------|
| GET | `/api/affiliate/profile` | Retorna credenciais do afiliado (sem secrets) | ✅ |
| PUT | `/api/affiliate/profile` | Atualiza credenciais Shopee | ✅ |
| POST | `/api/affiliate/test-conversion` | Testa geração de link com credenciais do usuário | ✅ |
| POST | `/api/affiliate/ml/connect` | Inicia fluxo OAuth do ML (com userId no state) | ✅ |

### GET /api/affiliate/profile

Retorna:
```json
{
  "success": true,
  "profile": {
    "shopeeConfigured": true,
    "shopeeAppId": "123456",
    "mercadoLivre": {
      "connected": true,
      "nickname": "M.TORREAO",
      "mlUserId": "12345",
      "expired": false,
      "hasSessionCookies": true,
      "meliid": "...",
      "melitat": "mtorreao"
    }
  }
}
```

Dados sensíveis (secrets, tokens) NUNCA expostos.

### PUT /api/affiliate/profile

Body:
```json
{
  "shopeeAppId": "...",
  "shopeeAppSecret": "..."
}
```

Atualiza `user_credentials`. Salva em texto plano (equivalente ao que o .env faz hoje).

### POST /api/affiliate/test-conversion

Body:
```json
{ "url": "https://shopee.com.br/product/123" }
```

Usa as credenciais do usuário autenticado para gerar o link:
- Shopee → usa `shopee_app_id` + `shopee_app_secret` do `user_credentials`
- Mercado Livre → usa o `ml_affiliate` vinculado ao `user_id`

Retorna:
```json
{
  "success": true,
  "originalUrl": "...",
  "affiliateUrl": "https://...",
  "marketplace": "shopee",
  "method": "api"
}
```

### Arquivos

| Arquivo | Ação |
|---------|------|
| `apps/api/src/modules/affiliate/affiliate.routes.ts` | Rotas do perfil afiliado |
| `apps/api/src/modules/affiliate/affiliate.service.ts` | Lógica de negócio |
| `apps/api/src/index.ts` | Registrar módulo affiliate |

---

## 🔷 FASE 4 — Migration

### Migration SQL manual

```sql
-- 001_create_users.sql
CREATE TABLE IF NOT EXISTS omestre.users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 002_create_user_credentials.sql
CREATE TABLE IF NOT EXISTS omestre.user_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES omestre.users(id),
  shopee_app_id TEXT,
  shopee_app_secret TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(user_id)
);

-- 003_add_user_id_to_ml_affiliates.sql
ALTER TABLE omestre.ml_affiliates ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES omestre.users(id);
```

Executar com:
```bash
bun run db:push
```
Ou via drizzle-kit generate + migrate.

---

## 🔷 FASE 5 — Frontend: Login/Registro

### Estado global: Auth hook

```
apps/web/src/hooks/useAuth.ts
```

- Armazena JWT no `localStorage`
- Expõe `{ user, login, register, logout, isLoading }`
- Verifica token na inicialização (`GET /api/auth/me`)

### Tela de Login

```
apps/web/src/components/LoginPage.tsx
```

- Campo: Email
- Campo: Senha
- Botão "Entrar"
- Link "Criar conta" → mostra RegisterPage

### Tela de Registro

```
apps/web/src/components/RegisterPage.tsx
```

- Campo: Nome
- Campo: Email
- Campo: Senha
- Campo: Confirmar Senha
- Botão "Criar conta"

### Fluxo

- **Não autenticado** → mostra LoginPage
- **Autenticado** → mostra Dashboard do Afiliado
- **Logout** → limpa token, volta ao login

### Arquivos

| Arquivo | Ação |
|---------|------|
| `apps/web/src/hooks/useAuth.ts` | Hook de autenticação |
| `apps/web/src/components/LoginPage.tsx` | Tela de login |
| `apps/web/src/components/RegisterPage.tsx` | Tela de registro |
| `apps/web/src/App.tsx` | Condicionar renderização baseada em auth |

---

## 🔷 FASE 6 — Frontend: Dashboard do Afiliado

```
apps/web/src/components/AffiliateDashboard.tsx
```

Layout em cards (mesmo estilo inline atual do projeto):

### Card: Credenciais Shopee

- Campo App ID
- Campo App Secret (type=password)
- Botão "Salvar"
- Indicador: 🟢 Configurado / 🔴 Não configurado

### Card: Mercado Livre

- Se conectado: mostra nickname, status do token, botão "Desconectar"
- Se não conectado: botão "Conectar conta ML"
- Campos extras: meliid (opcional), melitat
- Seção de Cookies de Sessão (textarea)

### Card: Testar Conversão

```
apps/web/src/components/TestConversion.tsx
```

- Input de URL (placeholder: "Cole a URL do produto...")
- Botão "Testar" → chama `POST /api/affiliate/test-conversion`
- Resultado: link gerado + botão "Copiar"

### Arquivos

| Arquivo | Ação |
|---------|------|
| `apps/web/src/components/AffiliateDashboard.tsx` | Painel principal |
| `apps/web/src/components/ShopeeCredentialsForm.tsx` | Formulário Shopee |
| `apps/web/src/components/MLConnectSection.tsx` | Seção Mercado Livre |
| `apps/web/src/components/TestConversion.tsx` | Teste de conversão |

---

## 🔷 FASE 7 — Converter Shopee com Credenciais Explícitas

Modificar o conversor Shopee para aceitar credenciais por parâmetro, similar ao que já existe para ML com `convertMercadoLivreUrlWithToken`.

### Em `packages/converters/src/shopee.ts`

Adicionar:
```typescript
export async function convertShopeeUrlWithCredentials(
  url: string,
  credentials: ShopeeCredentials
): Promise<ConversionResult> {
  // Mesma lógica de convertShopeeUrl mas usando as credenciais passadas
  // em vez de ler do .env
}
```

### Em `apps/api/src/modules/affiliate/affiliate.service.ts`

O test-conversion usa essa função para Shopee, e `convertMercadoLivreUrlWithToken` + `generateViaUrlParams` para ML.

---

## 📦 Resumo de Dependências

| Pacote | Comando | Onde |
|--------|---------|------|
| `@elysiajs/jwt` | `bun add @elysiajs/jwt` | apps/api |

Tudo o resto é nativo (Bun.password para hash, fetch para HTTP, crypto para assinatura).

---

## 📂 Novos Arquivos (17 no total)

### DB (5)
- `packages/db/src/schema/users.ts`
- `packages/db/src/schema/userCredentials.ts`
- `packages/db/src/repository/users.repository.ts`
- `packages/db/src/repository/userCredentials.repository.ts`
- `packages/db/src/migrations/001_create_users.sql` (manual)

### API Middleware (1)
- `apps/api/src/middleware/auth.ts`

### API Modules (4)
- `apps/api/src/modules/auth/auth.routes.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/affiliate/affiliate.routes.ts`
- `apps/api/src/modules/affiliate/affiliate.service.ts`

### Frontend (6)
- `apps/web/src/hooks/useAuth.ts`
- `apps/web/src/components/LoginPage.tsx`
- `apps/web/src/components/RegisterPage.tsx`
- `apps/web/src/components/AffiliateDashboard.tsx`
- `apps/web/src/components/ShopeeCredentialsForm.tsx`
- `apps/web/src/components/MLConnectSection.tsx`
- `apps/web/src/components/TestConversion.tsx`

### Converters (1 modificado)
- `packages/converters/src/shopee.ts` (add `convertShopeeUrlWithCredentials`)

---

## 📄 Arquivos Modificados (4)

| Arquivo | Mudança |
|---------|---------|
| `packages/db/src/schema/index.ts` | Add user_id em ml_affiliates |
| `packages/db/src/index.ts` | Exportar novos módulos |
| `apps/api/src/index.ts` | Registrar módulos auth + affiliate |
| `apps/api/package.json` | Add @elysiajs/jwt |
| `apps/web/src/App.tsx` | Adicionar auth flow + dashboard |

---

## 🎯 Ordem de Implementação

| # | Passo | Descrição |
|---|-------|-----------|
| 1 | Schema DB | Criar tabelas users + user_credentials + user_id em ml_affiliates |
| 2 | Repositories | Criar users.repository + userCredentials.repository |
| 3 | Migration | Gerar/aplicar migration no banco |
| 4 | Auth middleware | JWT middleware com @elysiajs/jwt |
| 5 | Auth routes | POST register, POST login, GET me |
| 6 | Affiliate routes | GET/PUT profile, POST test-conversion |
| 7 | Shopee converter | Add convertShopeeUrlWithCredentials |
| 8 | Frontend auth | Hook + LoginPage + RegisterPage |
| 9 | Frontend dashboard | AffiliateDashboard + componentes |
| 10 | Testar tudo | bun run build + fluxo completo |
