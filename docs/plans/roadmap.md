# Roadmap — O Mestre Afiliado

> **Status:** planejado, não iniciado.
>
> **Objetivo:** unificar e reordenar as fases dos planos de `docs/plans/*`, escolhendo a sequência que entrega mais valor por fase.
> Os planos de origem continuam sendo a fonte de detalhe e critério de aceite; este roadmap é o índice operacional.

## Princípios de priorização

1. **Fundação antes de feature:** a fundação `users` + JWT já existe. O próximo passo mais valioso é completar **autenticação/autorização** (roles, super admin, tenant) porque destrava a área admin, feature flags, catálogo e onboarding de funcionários.
2. **Kill switch antes de release:** feature flags com kill switch do envio vêm antes do catálogo de preço, porque protegem a operação e evitam incidentes.
3. **Fases pequenas, ganho grande:** dividir a fase de auth/roles em duas — fundação `is_admin` + feature flags já gera valor; o tenant e permissões individuais entram em fase seguinte.
4. **Aproveitar a refatora do worker:** a arquitetura 2 filas + 2 workers + worker-common já foi entregue (ver `arquitetura-worker.md` + `testes-e2e-arquitetura-worker.md` + `worker-monitoring.md`). Roadmap considera o que ela desbloqueia, não o que ela custou.
5. **Aproveitar dev stack multi-worktree:** já mergeado, então o roadmap pode assumir `bun run dev` determinístico por branch.
6. **Multi-usuário → multi-tenant:** o plano `autenticacao-cadastro-afiliado` adicionou a fundação `users`; o plano `roles-e-super-admin` transforma isso em tenant + roles + super admin + permissões individuais. O roadmap segue a mesma sequência.
7. **Magalu primeiro, Amazon depois:** a Fase 2 original combinava Amazon + Magalu numa só. Por demanda do owner e por isolamento (Magalu não depende de mudanças Amazon), **Magalu vira Fase 2** (PRIORIDADE ALTA) e Amazon vira Fase 2.5. Detalhes em [`docs/plans/magalu.md`](./magalu.md).

## Resumo das fases

| #   | Fase                               | Entrega de valor                                                                               | Planos que ela mescla                                                                                            |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0   | Fundação admin (pré-requisito)     | `is_admin` + `ADMIN_EMAILS` + JWT + `getAdminUser` + `useAuth.isAdmin` + filtro de nav         | `feature-flags.md` §5.1, `historico-precos.md` §5.5.1, `roles-e-super-admin.md` Fase 3                           |
| 1   | Feature flags e kill switch        | Modo manutenção + kill switch do envio + kill switch do ingestor + tela admin                  | `feature-flags.md` fases 2–7, `testes-e2e-arquitetura-worker.md` §5.2                                            |
| 2   | **Magalu real ⭐ PRIORIDADE ALTA** | Marketplace 4 funcional (afiliado/tenant/conversor/E2E) — sai do placeholder para produto real | novo [`magalu.md`](./magalu.md)                                                                                  |
| 2.5 | Hardening Amazon                   | Garantir Amazon ponta a ponta (afiliado/tenant/conversor/E2E/observabilidade)                  | `historico-precos.md` §1 (estado atual), `roles-e-super-admin.md` (tenant), novo `amazon-hardening.md` (a criar) |
| 3   | Convite de funcionário + tenant    | `affiliate_accounts`, `affiliate_admin`/`affiliate_user`, convites, permissões individuais     | `roles-e-super-admin.md` Fases 1–6, `autenticacao-cadastro-afiliado.md` (extensões)                              |
| 4   | Catálogo de preço (somente admin)  | Persistência de ofertas + histórico de preço + UI admin                                        | `historico-precos.md` fases 1–7                                                                                  |
| 5   | Operação ML                        | Renovação de cookies, fallback inteligente, batch, mensagens claras, testes ML                 | `melhorias-ml.md`                                                                                                |
| 6   | Templates avançados                | Placeholders novos, condicionais, preview, seletor visual                                      | `template-mensagem.md`                                                                                           |
| 7   | Idem: roadmap re-validado          | Refresh do roadmap com base no que ficou pronto e nas novas prioridades                        | este documento                                                                                                   |

A ordem foi escolhida para que cada fase deixe o sistema utilizável e entregável antes da próxima. As fases com 0 ou 1 funcionário ainda assim liberam valor, porque o super admin e o kill switch funcionam desde o início. **A Fase 2 (Magalu) sai da Fase 2 original e é priorizada** porque (a) owner pediu explicitamente, (b) é trabalho bem isolado e paralelo a Amazon, (c) destrava o 3º maior e-commerce do Brasil que hoje está **bloqueado**.

---

## Fase 0 — Fundação admin

**Objetivo:** criar o conceito de admin do sistema, sem ainda ter `affiliate_admin`/`affiliate_user` nem tenant explícito. Isso destrava todas as áreas admin (feature flags, catálogo, debug) sem esperar o trabalho maior de multi-tenant.

**Por que primeiro:** o super admin é único hoje, não depende de tenant. O `is_admin` é a única âncora de autorização que já vai estar pronta e poder ser referenciada pelos planos seguintes. Sem ele, qualquer tela admin depende de `ADMIN_EMAILS` no env, que não escala nem permite gestão.

**Planos que contribuem:**

- `docs/plans/feature-flags.md` §5.1 (fundação admin)
- `docs/plans/historico-precos.md` §5.5.1 (fundação admin)
- `docs/plans/roles-e-super-admin.md` Fase 3 (autenticação: contexto + dupla validação do super admin, sem tenant ainda)

**Entregas:**

1. Migration: `ALTER TABLE omestre.users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;` e enum `user_role` com `super_admin`, `affiliate_admin`, `affiliate_user` (neste momento, só `super_admin`/`affiliate_admin` são usados; `affiliate_user` entra na Fase 2).
2. Schema Drizzle atualizado em `packages/db/src/schema/users.ts`, com `isAdmin` + `role`.
3. `env ADMIN_EMAILS` (CSV) no `.env.example` e `apps/api/src/config.ts`.
4. `UserRepository.create` marca `isAdmin = true` se o email estiver em `ADMIN_EMAILS`.
5. `apps/api/src/middleware/auth.ts` ganha `getAdminUser()` e a função `requireSuperAdmin()` que combina `role === 'super_admin'`, `isAdmin === true` e email normalizado igual a `SUPER_ADMIN_EMAIL` (env) — única âncora autoritativa. JWT carrega `isAdmin` para conveniência, mas não é fonte de verdade.
6. `apps/api/src/modules/auth/auth.routes.ts` propaga `isAdmin` e `role` no `/me` e no payload de token.
7. `apps/web/src/hooks/useAuth.ts` tipa `User` com `isAdmin?` e `role?`. `useAuth` agora expõe `isAdmin` e `isSuperAdmin`.
8. `apps/web/src/components/layout/AppShell.tsx` filtra `navItems` por `user.isAdmin` quando o item for admin-only.
9. Env `SUPER_ADMIN_EMAIL` no `.env.example` e no `apps/api/src/config.ts`. Em produção é obrigatório; em dev tem default igual ao `ADMIN_EMAILS[0]`.

**Critérios de aceite:**

- [ ] `bun run db:generate` gera a migration idempotente.
- [ ] `bun run typecheck` 0 erros.
- [ ] `bun run test:unit` verde.
- [ ] Usuário com email em `SUPER_ADMIN_EMAIL` recebe `role=super_admin`, `isAdmin=true` no `/me`.
- [ ] Usuário com email em `ADMIN_EMAILS` (mas não em `SUPER_ADMIN_EMAIL`) recebe `isAdmin=true`, `role=affiliate_admin` (modo legado).
- [ ] Restante dos emails continua `affiliate_admin`, `isAdmin=false`.
- [ ] `requireSuperAdmin` bloqueia qualquer um que não satisfaça as 3 condições.
- [ ] Nenhuma rota nova exposta ainda; só o fundamento.

**Commits sugeridos (5–6):**

1. `feat(db): add user_role enum + is_admin to users` — migration + schema.
2. `feat(api): bootstrap role and admin context in auth middleware` — envs, helper, signToken.
3. `feat(api): propagate role and isAdmin in /me` — atualizar `UserPublic`, login/register.
4. `feat(web): expose role and isAdmin in useAuth` — hook + tipos.
5. `feat(web): filter AppShell nav by isAdmin` — já preparado para receber flags admin.
6. `test(auth): cover role and isAdmin flow` — unit/E2E básico.

**Saída esperada:**

- A partir desta fase, qualquer feature nova pode ser protegida com `requireSuperAdmin` sem retrabalho.
- A duplicação entre `ADMIN_EMAILS` e `SUPER_ADMIN_EMAIL` é temporária e fica documentada como legado.

---

## Fase 1 — Feature flags e kill switch

**Objetivo:** dar ao super admin controle operacional imediato: modo manutenção para a UI, kill switch do envio de mensagens via Evolution, kill switch do ingestor para diagnóstico, e propagação em sub-segundo para múltiplos processos.

**Por que em segundo:** depende do super admin (Fase 0) para o gate de acesso e para a tela de gestão. É a primeira coisa visível que o admin consegue ligar/desligar.

**Planos que contribuem:**

- `docs/plans/feature-flags.md` fases 2–7 (DB, package, API, dispatcher, web)
- `docs/plans/testes-e2e-arquitetura-worker.md` §5.2 (E2E de status/DLQ)
- `docs/plans/roles-e-super-admin.md` Fase 3 (gate de manutenção como primeiro uso real de `requireSuperAdmin`)

**Entregas (resumo do `feature-flags.md`):**

1. Migration `00XX_add_feature_flags.sql` (PK `key`, `enabled`, `updated_by`, `updated_at`).
2. Schema Drizzle + `FeatureFlagRepository` (`findAll`, `upsert`, `findByKey`).
3. Package `@omestre/feature-flags`:
   - `registry.ts` com `FlagKey` (mínimo: `maintenance_mode`, `evolution_send_enabled`, `ingest_enabled`).
   - `client.ts` com cache em memória TTL 10s, fail-safe, métrica `countFlagChecks` via Redis buckets por minuto.
   - `redis.ts` com `initFlagInvalidation()` + `publishFlagInvalidation()` + `waitForFlagChange()`.
4. API:
   - `GET /api/admin/feature-flags` e `PATCH /api/admin/feature-flags/:key` protegidos por `requireSuperAdmin`.
   - `onBeforeHandle` global para `maintenance_mode` (exceto webhook, auth, admin, health, docs, /).
5. Dispatcher pausa quando `evolution_send_enabled=false` (sleep + re-check no mainLoop).
6. Ingestor pausa quando `ingest_enabled=false` (mesmo padrão).
7. Frontend:
   - `useAuth.isAdmin` filtra nav.
   - `FeatureFlagsPage` admin-only.
   - `MaintenancePage` para usuário comum quando resposta tem `maintenance: true`.
8. E2E: `feature-flags.api.spec.ts` + `feature-flags.ui.spec.ts` (8 testes cada, padrão definido em §5.2 dos planos).

**Critérios de aceite (resumo):**

- [ ] Toggle propaga em < 1s entre API, ingestor e dispatcher.
- [ ] Toggle permanece funcional mesmo com Redis fora (TTL 10s + default fail-safe).
- [ ] Modo manutenção bloqueia usuários comuns; admin continua acessando; webhook e auth não bloqueados.
- [ ] E2E verdes, incluindo `checksLastHour` agregado.

**Commits sugeridos (8):**

1. `feat(db): add feature_flags table and repository` — migration + schema.
2. `feat(flags): add @omestre/feature-flags package` — registry + client + unit tests.
3. `feat(api): feature flags CRUD protected by super admin` — rotas + onBeforeHandle.
4. `feat(dispatcher): honor evolution_send_enabled` — pause no mainLoop.
5. `feat(ingestor): honor ingest_enabled` — pause no mainLoop.
6. `feat(web): feature flags page and maintenance page` — UI admin/usuário comum.
7. `test(flags): add E2E for feature flags and maintenance` — Playwright.
8. `docs(flags): update AGENTS.md and skill` — feature flags, envs e uso.

**Saída esperada:**

- O super admin consegue proteger a operação sem deploy.
- Toda feature futura pode ser amarrada a uma flag sem mudança no contrato.

---

## Fase 2 — Magalu real ⭐ PRIORIDADE ALTA

> **Plano detalhado:** [`docs/plans/magalu.md`](./magalu.md) — inclui pesquisa do NotebookLM, modelo de dados, conversor, integração no ingestor, link-verifier, API, frontend, testes, riscos e commits.

**Objetivo:** implementar **Magalu** (Magazine Luiza) como o **quarto marketplace real** do `O Mestre Afiliado`. Cada tenant configura seu próprio `store_slug` (Influenciador Magalu) no painel, e os links Magalu passam pelo mesmo pipeline de espelhamento que Shopee/ML/Amazon.

**Por que primeiro (antes de Amazon hardening):** demanda direta do owner, trabalho bem isolado (não depende de Amazon nem de tenant multi-usuário), destrava o 3º maior e-commerce do Brasil que hoje está **bloqueado com mensagem "Marketplace ainda não liberado"**.

**Por que não esperar Fase 3 (tenant):** o modelo é **1 usuário = 1 afiliado** (igual Amazon hoje). Quando Fase 3 chegar, basta propagar `affiliate_account_id` na tabela `magalu_affiliates` (mesmo padrão da migration Amazon).

**Planos que contribuem:**

- Novo [`docs/plans/magalu.md`](./magalu.md) (completo, pronto para execução)
- Pesquisa no NotebookLM (notebook `Pesquisa Afiliados Magalu`, 14 fontes validadas)
- Templates reaproveitados de Amazon (multi-tracking ID → aqui é slug único, mas mesma estrutura de repo + routes + frontend)

**Entregas (resumo — ver `magalu.md` para detalhe):**

1. **DB:** migration `0017_add_magalu_affiliates.sql` + `packages/db/src/schema/magaluAffiliates.ts` + `MagaluAffiliateRepository` + testes com mock Drizzle.
2. **Conversor:**
   - `packages/converters/src/magalu-pure.ts` — funções puras (regex, validação de slug, extração de ID), cobertura 100%.
   - `packages/converters/src/magalu.ts` — `convertMagaluUrlWithStoreSlug`, `resolveMagaluShortlink` (maga.lu), `buildMagaluAffiliateLink`.
   - `packages/converters/src/index.ts` — adiciona `magalu` ao `selectConverter` + exporta funções.
   - `packages/converters/src/cli-magalu.ts` — CLI `bun run magalu <url>` usando `.env` fallback.
3. **Ingestor:**
   - Remover `magalu` de `classifyUnsupportedMarketplace` em `link-converters-pure.ts`.
   - Adicionar `convertMagaluForAffiliate` em `link-converters.ts` (espelha Amazon).
   - Adicionar `extractMagaluStoreSlug` + `verifyMagaluStoreSlug` em `link-verifier-pure.ts` + ramo `verifyMagaluLink` em `link-verifier.ts`.
4. **API:**
   - `apps/api/src/modules/magalu/magalu.service.ts` (singleton repo).
   - `apps/api/src/modules/magalu/magalu.routes.ts` (CRUD + `/convert` + opcional `/validate-slug`).
   - `apps/api/src/index.ts` — registrar `magaluRoutes` + atualizar Swagger description.
   - `apps/api/src/modules/affiliate/affiliate.routes.ts` — adicionar bloco `magalu` em `/profile` e ramo em `test-conversion`.
5. **Frontend:**
   - `apps/web/src/pages/sections/MagaluConfigSection.tsx` (input de slug com validação inline).
   - Adicionar aba Magalu em `apps/web/src/pages/SettingsPage.tsx`.
   - Verificar visualmente card Magalu na sidebar e breakdown na DashboardPage.
6. **Config:** `MAGALU_STORE_NAME` em `.env.example` (fallback global apenas para CLI + `/api/convert` legado).
7. **Testes E2E:**
   - `e2e/magalu.api.spec.ts` (CRUD, conversão com/sem slug, slug inválido).
   - Caso P11 (Magalu fan-out) em `e2e/mirror-pipeline.api.spec.ts`.
8. **Docs:**
   - `docs/marketplaces/magalu/api-reference.md` (template Amazon).
   - `AGENTS.md` atualizado (bloco Magalu em Conversores + Env vars + link para plano).

**Critérios de aceite (resumo — ver `magalu.md` §10 para versão completa):**

- [ ] Usuário logado pode cadastrar slug do Magazine Você em `/settings → Magalu`.
- [ ] Slug validado por regex `^[a-z0-9-]{3,40}$`; inválido retorna 400 com mensagem clara.
- [ ] `POST /api/magalu/convert` com `magazineluiza.com.br/p/123` + slug configurado retorna `magazinevoce.com.br/{slug}/.../p/123/`.
- [ ] Shortlinks `maga.lu/abc` resolvidos via HEAD/GET antes da conversão.
- [ ] Espelhamento WhatsApp → grupo destino recebe link afiliado correto.
- [ ] `classifyUnsupportedMarketplace('magalu') === null`.
- [ ] link-verifier confere `store_slug` da URL convertida com o do afiliado; bloqueia se divergir.
- [ ] `bun run typecheck` 0 erros, `test:unit` verde, `test:coverage` mantém ≥ 80% ajustada, `build` 0 erros, `test:e2e` verde.
- [ ] Conversor isolado em `*-pure.ts` com cobertura 100% das funções puras.
- [ ] Verificação visual da aba Magalu no `/settings` e do card na DashboardPage.

**Commits sugeridos (10 — ver `magalu.md` §12):**

1. `feat(db): add magalu_affiliates table`
2. `feat(db): add MagaluAffiliateRepository with tests`
3. `feat(converters): add Magalu pure helpers and slug validation`
4. `feat(converters): add Magalu converter with shortlink resolution`
5. `feat(converters): integrate Magalu into selectConverter and CLI`
6. `feat(ingestor): unblock Magalu in link-converters and add convertMagaluForAffiliate`
7. `feat(ingestor): add Magalu store_slug verification in link-verifier`
8. `feat(api): add Magalu affiliate routes and /profile integration`
9. `feat(web): add Magalu configuration section and dashboard counts`
10. `docs(magalu): add Magalu API reference and update architecture`

**Saída esperada:**

- Magalu sai do placeholder para **produto real** end-to-end.
- Espelhamento no WhatsApp com links Magalu finalmente funciona (antes: bloqueado).
- O time ganha **template replicável** (afiliado + conversor + UI + E2E) para adicionar novos marketplaces no futuro.
- A telemetria por marketplace na DashboardPage agora cobre os 4 marketplaces.

---

## Fase 2.5 — Hardening Amazon

**Objetivo:** garantir Amazon ponta a ponta (afiliado/conversor/E2E) e implementar cobertura completa de observabilidade (breakdown por marketplace no WorkerStatus, falha estruturada do link-verifier, testes de validação por marketplace).

**Por que em segundo:** mesmo com kill switch, feature flags e tenant, ainda não temos o caminho de produto crítico validado em um dos três marketplaces já suportados. O trabalho é majoritariamente de **cobertura de testes e observabilidade**, não de feature nova — depende do padrão Magalu (Fase 2) já estar pronto para servir de modelo.

**Planos que contribuem:**

- `docs/plans/historico-precos.md` §1 (estado atual — Amazon implementado)
- `docs/plans/roles-e-super-admin.md` (tenant e permissões — base de validação)
- `docs/marketplaces/amazon/api-reference.md` (referência da API Amazon)
- Novo `docs/plans/amazon-hardening.md` (a criar nesta fase — espelho do `magalu.md`)

**Entregas — subfase 2A.1 (Amazon coverage):**

1. Cobertura de `e2e/amazon.api.spec.ts` ampliada: casos `region: BR/US/EU` com `tag` específica, sem tag, e erro de "Tracking ID inativo". Garantir 100% verde.
2. Cenário de "fan-out 1:N" com Amazon (2 users no mesmo sourceGroup, cada um com seu tracking ID, ambos devem ser publicados em destinos independentes).
3. Validação explícita no `link-verifier.ts` para `amazon`: link deve conter `?tag=` E o `tag` precisa existir entre os tracking IDs ativos do afiliado; senão bloqueia (já parcialmente implementado — verificar gaps).
4. Frontend (`AmazonConfigSection.tsx`): validação inline (formato + duplicidade), badge de status por tag (válida/pendente/inválida), indicador de região inferida pelo sufixo `-20`/`-21`/`-22` (já implementado).
5. Logging estruturado de falhas Amazon: `tag_inexistente`, `tag_invalida`, `conversao_sem_afiliado` (counter no ingestor + alerta se > N/min).

**Entregas — subfase 2A.2 (observabilidade comum):**

1. Adicionar `pipeline_messages_by_marketplace_total{marketplace=...}` no ingestor (counter Prometheus existente serve). Adicionar tab em `WorkerStatusPage` mostrando envio por marketplace.
2. Falha de validação do `link-verifier` precisa ter log estruturado `field: "safety_check"`, `marketplace: "amazon|magalu"`, `reason: "tag_not_found"`.
3. `apps/api/src/services/__tests__/offerValidator.test.ts` cobre os casos de validação por marketplace.

**Critérios de aceite:**

- [ ] Amazon: `e2e/amazon.api.spec.ts` cobre todos os fluxos, com tenant do E2E e com a stack dev.
- [ ] Amazon: `mirror-pipeline.api.spec.ts` valida fan-out 1:N com 2 tracking IDs diferentes.
- [ ] Amazon: link sem `?tag=` ou com tag inválida é bloqueado com `success: false, reason`.
- [ ] Typecheck, test:unit e test:e2e verdes.

**Commits sugeridos (5):**

1. `test(amazon): cover full tracking ID lifecycle and edge cases`
2. `feat(amazon): tighten safety check in link-verifier`
3. `feat(amazon): structured logging for tag failures`
4. `feat(monitoring): breakdown of sent by marketplace in worker-status`
5. `docs(amazon): add amazon-hardening.md plan and update roadmap`

---

## Fase 3 — Convite de funcionário e tenant

**Objetivo:** transformar o `users` de "1 usuário ≈ 1 afiliado" em "1 conta de afiliado com N usuários". Habilita a `affiliate_user`, os convites, a delegação de permissões e o isolamento entre contas.

**Por que em quarto:** depois de ter o super admin (Fase 0), o kill switch (Fase 1), o Magalu validado (Fase 2) e o Amazon hardening (Fase 2.5), o tenant desbloqueia o caso de uso real de funcionário compartilhando a mesma conta. Também resolve gaps de IDOR em `/api/mirrors/:id` e `/api/affiliate/...`, que são pré-requisito de segurança.

**Planos que contribuem:**

- `docs/plans/roles-e-super-admin.md` Fases 0–6 (modelagem, migration, helpers, account management, convites, UI)
- `docs/plans/autenticacao-cadastro-afiliado.md` (reaproveita o `users` atual e estende o que existe)
- `docs/plans/feature-flags.md` §9 (coordenação entre planos — manter consistência da fundação admin)

**Entregas (resumo do `roles-e-super-admin.md`):**

1. Migration: `affiliate_accounts`, colunas em `users` (`role`, `is_admin` já presente, `affiliate_account_id`, `active`), `user_permissions` (`user_id`, `permission`, `granted_by_user_id`).
2. `affiliate_account_id` em `mirrors`, `user_credentials`, `amazon_affiliates`, `magalu_affiliates` (nova — Fase 2), `user_whatsapp_instances`, `ml_affiliates`, `affiliates` (tabela operacional).
3. Permissões individuais via `user_permissions` + catálogo em `packages/shared/src/permissions.ts`.
4. Backend:
   - `getAuthUser` revisa o usuário no banco a cada request; retorna `role`, `isAdmin`, `affiliateAccountId`, `permissions`.
   - `requireSuperAdmin` (Fase 0) agora duplicado em `requireRole(auth, [...])` e `requirePermission(auth, p)`.
   - Register cria `affiliate_account` + `affiliate_admin` transacionalmente.
   - Endpoints `/api/account/users`, `/api/account/invitations`, `/api/account/invitations/:token/accept`, `PUT /api/account/users/:id/permissions`.
5. Frontend: `AccountUsersPage` (afiliado admin gerencia funcionários e permissões) + `AdminDashboardPage` super admin.
6. Conversão de queries: substituir `userId` por `affiliateAccountId` em todas as rotas; corrigir gaps de IDOR em `mirrors/:id` e afins; propagar `affiliateAccountId` para Redis/ingestor/dispatcher.
7. Revalidação periódica: o JWT é só identidade; permissões/role/status são sempre carregados do banco.

**Critérios de aceite:**

- [ ] Cadastro público cria `affiliate_account` + `affiliate_admin` em uma transação.
- [ ] Convite só para `affiliate_user` dentro da própria conta.
- [ ] `affiliate_user` começa com `account.self.view` + `conversion.use`; demais capacidades via grants.
- [ ] `affiliate_admin` pode delegar somente permissões do catálogo delegável.
- [ ] Revogação de um grant invalida o acesso imediatamente, sem depender de expiração do JWT.
- [ ] Super admin não é tratado como afiliado (tenant NULL).
- [ ] Objetos de uma conta não podem ser lidos ou alterados por usuário de outra conta.
- [ ] Typecheck, test:unit e test:e2e verdes.

**Commits sugeridos (8):**

1. `feat(db): model affiliate accounts, roles, and user permissions`
2. `feat(db): migrate ownership to affiliate_account_id`
3. `feat(api): revalidate user context from database and add requireRole/requirePermission`
4. `fix(api): protect existing routes by role, permission, and tenant`
5. `feat(api): add invitations and account user management`
6. `feat(web): add role and permission guards and admin/account pages`
7. `test(auth): cover roles, permissions, IDOR, invitations, and super admin`
8. `docs(auth): document rollout and operation`

**Saída esperada:**

- O sistema suporta oficialmente multi-usuário por conta.
- A base de autorização é estável para qualquer feature admin/afiliado daqui em diante.

---

## Fase 4 — Catálogo de preço (somente admin)

**Objetivo:** capturar cada oferta encontrada uma única vez, deduplicar e acumular histórico de preço, com UI somente para o super admin. Não mexe no pipeline de envio (Ingestor só publica; CatalogWorker é isolado).

**Por que em quinto:** a fundação admin (Fase 0) garante o gate `isAdmin`; a Fase 1 garante kill switch caso o CatalogWorker cause pressão; a Fase 2 garante que os marketplaces que alimentam o catálogo estão validados; a Fase 2.5 garante que Amazon está hardened; a Fase 3 garante que permissões possam ser ampliadas sem refactor. O catálogo é uma feature de produto, não de infraestrutura, então vem depois das fundações.

**Planos que contribuem:**

- `docs/plans/historico-precos.md` fases 1–7 (schema, publisher, worker isolado, API read-only, UI admin, backfill, infra)
- `docs/plans/feature-flags.md` §9 (coordenação de migrations — feature flags e catálogo compartilham `is_admin`)

**Entregas (resumo do `historico-precos.md`):**

1. Migration `0016_add_product_catalog.sql` (tabelas `products`, `product_variations`, `price_history`, índices únicos, `date_trunc('hour')` bucket).
2. `apps/ingestor/src/catalog-publisher.ts` — resolve `product_key` por parse, publica `CatalogJob` na Queue C, com `void`+try/catch (nunca bloqueia o envio).
3. Novo app `apps/catalog-worker/`:
   - Consome Queue C (`omestre:mirror:catalog`), consumer group próprio.
   - `GET api.mercadolibre.com/items/{id}` para ML; `getProductOffer()` para Shopee; Amazon e Magalu ficam sem preço nesta fase (documentado).
   - Upsert em `products`/`product_variations` + append em `price_history` (com `ON CONFLICT DO NOTHING`).
4. `apps/api/src/modules/catalog/catalog.routes.ts` read-only, gate `requireSuperAdmin` (rotas `/api/catalog/products`, `/api/catalog/products/:id`, `/api/catalog/variations/:id/history`).
5. `apps/web/src/pages/ProductHistoryPage.tsx` admin-only: tabela + drawer com gráfico de linha (SVG inline, sem dependência nova).
6. Backfill: script que varre `reflected_offers` e publica `CatalogJob` para cada link normalizável.
7. Infra: `apps/catalog-worker/Dockerfile`, `docker-compose.yml`/`.dev.yml` (porta `:9094` no host dev), `scripts/dev.ts` start/stop/lock, `deploy-local.sh` gate.

**Critérios de aceite:**

- [ ] `products.product_key` UNIQUE → 1 oferta vista 5x gera 1 linha.
- [ ] `price_history_dedup_idx` UNIQUE → concorrência coberta (fan-out 1:N não duplica).
- [ ] CatalogWorker isolado: latência do ingestor não muda; DLQ própria.
- [ ] UI admin: `ProductHistoryPage` lista, drawer abre série temporal.
- [ ] Backend: `/api/catalog/*` retorna 403 para não-admin.
- [ ] Backfill popula histórico de `reflected_offers` em 1x.

**Commits sugeridos (7):**

1. `feat(db): add product catalog tables`
2. `feat(ingestor): publish catalog jobs without leaving the hot path`
3. `feat(catalog-worker): add isolated worker for price history`
4. `feat(api): admin read-only catalog routes`
5. `feat(web): ProductHistoryPage with time-series drawer`
6. `feat(catalog-worker): backfill script for existing offers`
7. `infra: add catalog-worker to compose and dev script`

**Saída esperada:**

- O super admin tem visibilidade de mercado sem alterar a operação de envio.
- A fundação de catálogo está pronta para o comparativo de preço em fases futuras.

---

## Fase 5 — Operação ML

**Objetivo:** reduzir fricção operacional do Mercado Livre: cookies, fallback, batch, mensagens de erro, testes. Tudo de baixo risco, alto retorno em qualidade de uso.

**Por que em quinto:** é polimento operacional. As fundações de auth/flags/marketplaces/catálogo estão estáveis; mexer em ML não impacta o resto.

**Planos que contribuem:**

- `docs/plans/melhorias-ml.md` (10 itens, priorizados por impacto)

**Entregas (resumo do `melhorias-ml.md`):**

1. Renovação automática de cookies ao detectar 401/403 (`refreshSessionCookies()` com captura de `set-cookie`).
2. Fallback inteligente: erro 111 ("URL não permitida") não cai em URL params silenciosamente — propaga erro para o usuário.
3. Feedback visual de cookies expirados (botão "validar cookies" no frontend, com base no endpoint `validate-cookies`).
4. Batch de URLs (até 25) no frontend e backend, consumindo o batch oficial do ML.
5. Cache de CSRF token por afiliado (válido enquanto os cookies não mudam).
6. Auto-detect de conta na extensão Chrome (cookie `orguseridp`).
7. Refresh periódico na extensão (`chrome.alarms`).
8. Mensagens de erro descritivas (mapa de `error_code` da API ML).
9. Testes automatizados de conversão, validação, fallback.

**Critérios de aceite:**

- [ ] Link curto funciona mesmo após expirar cookies (renovação transparente).
- [ ] UI mostra status de cookies por afiliado em tempo real.
- [ ] Batch de até 25 URLs funciona; respostas parciais são reportadas corretamente.
- [ ] Erro 111 não vira URL params silenciosamente.
- [ ] Testes E2E do ML com credenciais reais (apenas em dev; sem segredo no repo).

**Commits sugeridos (5–7):** um por item, priorizando o que mais reduz atrito.

**Saída esperada:**

- O afiliado passa a confiar mais no sistema para fazer espelhamento em volume.

---

## Fase 5 — Templates avançados

**Objetivo:** placeholders novos, condicionais, preview com dados reais, seletor visual no frontend.

**Por que em sexto:** é UX/template — não é dependência de nenhuma fundação. Pode esperar até o sistema estar maduro de infra. Mas tem alto retorno em conversão (mensagens mais ricas tendem a performar melhor).

**Planos que contribuem:**

- `docs/plans/template-mensagem.md` (5 fases, todas unidas aqui)

**Entregas (resumo do `template-mensagem.md`):**

1. **Fase 1** — `TemplateContext` com todos os campos; `resolvePlaceholders()` em shared.
2. **Fase 2** — `parseConditionalTemplate()` com gramática `{?}/{:}/{:}/{/}`.
3. **Fase 3** — APIs `POST /api/affiliate/preview-template` e `POST /api/affiliate/validate-template`.
4. **Fase 4** — `PlaceholderPicker`, `TemplateEditor`, `TemplatePreview` no frontend; indicadores global vs mirror.
5. **Fase 5** — E2E + remoção de `MirrorConfigSection` se obsoleto.

**Critérios de aceite:**

- [ ] Placeholders novos resolvidos em runtime.
- [ ] Condicionais aninhadas funcionam; erro cai em texto literal (nunca quebra template).
- [ ] Preview reflete URL real e marketplace.
- [ ] Frontend destaca placeholders desconhecidos.
- [ ] Testes E2E do template no Playwright.

**Commits sugeridos (5):** um por fase do plano.

**Saída esperada:**

- Templates com mais qualidade sem risco de regressão (validação + preview).

---

## Fase 6 — Roadmap re-validado

**Objetivo:** depois de 5 fases, o produto está com infra madura, autorização sólida, kill switch, marketplaces validados (4), multi-tenant, catálogo e templates avançados. Esta fase é uma **revisão do roadmap** com base no que ficou pronto, no feedback dos usuários e em novas oportunidades.

**Por que como fase explícita:** o roadmap é um documento vivo. Após 5 fases, ele precisa ser reescrito com base na realidade.

**Entregas:**

- Atualizar este documento.
- Avaliar se há planos não incorporados (ex.: `multi-worktree-dev-stack.md` já está entregue; `worker-monitoring.md` já está entregue; `testes-e2e-arquitetura-worker.md` já está parcialmente entregue e se estende naturalmente para as novas features).
- Repriorizar a próxima leva com base em uso real.

**Critérios de aceite:**

- [ ] Roadmap atualizado e revisado pelo menos uma vez.
- [ ] Status real de cada plano original marcado (entregue, em andamento, descartado).
- [ ] Próximo conjunto de fases proposto e validado.

---

## Resumo de dependências entre fases

```text
Fase 0  →  users.role + users.isAdmin + super admin helpers
              │
              ▼
Fase 1  →  feature flags, kill switch, maintenance, admin UI
              │
              ▼
Fase 2  →  Magalu real ⭐ (Marketplace 4)
              │
              ▼
Fase 2.5  →  Amazon hardening (cobertura E2E + observabilidade)
              │
              ▼
Fase 3  →  affiliate_accounts, tenant, convites, permissões
              │
              ▼
Fase 4  →  catálogo de preço, UI admin, backfill
              │
              ▼
Fase 5  →  operação ML (cookies, batch, fallback)
              │
              ▼
Fase 6  →  templates avançados
              │
              ▼
Fase 7  →  revisão do roadmap
```

Cada fase depende da anterior. As fundações (0, 1, 2) precisam vir antes; as features de produto (3, 4, 5, 6) podem ser priorizadas caso o feedback mude; o roadmap é refeito na Fase 7.

## Riscos e mitigações

| Risco                                                            | Mitigação                                                                                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Fase 0 ficou pesada (auth + role + admin)                        | Dividir a fase em commits curtos; manter `isAdmin` como flag legada até `role` estar validado em prod             |
| Fase 1 ficou bloqueada por Redis fora                            | Fail-safe em `isFeatureEnabled`; TTL 10s cobre o pior caso                                                        |
| Fase 2 (Magalu) depende de validação manual do slug pelo usuário | Frontend mostra tooltip com link para o painel do Influenciador Magalu; validação HEAD opcional, nunca bloqueante |
| Fase 2 (Magalu) falha se Magalu muda formato da URL              | Regex ficam isolados em `magalu-pure.ts`; ajustes = 1 commit                                                      |
| Fase 2.5 explode em complexidade (multi-tenant)                  | Backfill em 1 transação + flag opcional de "modo somente leitura" para rollback                                   |
| Fase 3 degrada latência do ingestor                              | CatalogWorker em app separado; publisher é `XADD` O(1) com `try/catch`                                            |
| Fase 4 depende de credenciais ML reais                           | Testar via ambiente isolado; sem secret no repo                                                                   |
| Fase 5 templates complexos quebram usuário                       | Validação prévia + preview antes de salvar; fallback se template vazio                                            |
| Roadmap fica desatualizado                                       | Fase 6 existe para revalidar                                                                                      |

## Princípios de execução

1. Cada fase = 1 PR (ou 5–8 commits encadeados) com typecheck + test:unit + test:e2e verdes.
2. Cada fase termina com a doc de referência atualizada (skill + AGENTS.md + roadmap).
3. A Fase 2 é a única que precisa de cuidado especial com migração de dados (backfill). As outras podem entrar com dados zerados.
4. A Fase 1 entrega valor operacional já nas primeiras 24h; prioridade alta de execução.
5. **A Fase 2 (Magalu) é a próxima a executar** — owner pediu priorização, plano completo em `docs/plans/magalu.md`.

## Próximo passo concreto

**Worktree dedicada para Fase 2 (Magalu):**

```bash
git worktree add -b wt/magalu-v1-<short-id> ../o-mestre-afiliado-magalu main
cd ../o-mestre-afiliado-magalu
```

Executar os 10 commits do [`docs/plans/magalu.md`](./magalu.md) §12 na ordem:

1. DB (migration + schema + repositório + testes)
2. Conversor (pure + io + CLI + integração)
3. Ingestor (link-converters + link-verifier)
4. API (rotas + /profile + swagger)
5. Web (config section + aba Settings + verificação visual)
6. Docs (api-reference + AGENTS + roadmap)

Reavaliar este roadmap ao final da Fase 2.5.
