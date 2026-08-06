# Roadmap — O Mestre Afiliado

**Last updated:** 2026-08-04 (Phase 8.5 admin-center feature-flags + worker-status — PR #18 aberto aguardando merge + validação manual em prod)
**Owner:** Matheus Torreão

How to read this file:

- Phases are ordered by **current impact** (Phase 1 = highest), not by creation order. Re-sort whenever business context changes.
- ✅ = validated spec (in `docs/specs/`)
- 🚧 = in progress (worktree / branch / PR)
- 📋 = proposed plan (in `docs/plans/`)
- ⏸️ = paused / blocked
- ❌ = rejected (kept for traceability)

Each phase lists expected output and acceptance criteria. A phase without acceptance criteria is not ready to start.

> Specs in `docs/specs/` are the source of truth for delivered work; plans in `docs/plans/` are the source of truth for not-yet-shipped work. Don't paste their content here — link to them.

---

## ⚠️ Dívida crítica (corrigir antes de novas features)

### ~~D — Bootstrap admin quebrado~~ ✅ FECHADO em 2026-07-31

**Why this was critical:** without `is_admin` in `users` + JWT assignment on login, **no user becomes admin through the normal flow**. The `FeatureFlagsPage` UI is drawn but inaccessible. Blocks catalog (admin-only UI), operational feature flags, and any new kill switch. (Bootstrap via `ADMIN_EMAILS` foi removido em 2026-08-06 — promoção agora é exclusiva via `UPDATE` manual no DB.)

- ✅ Plan: `docs/plans/feature-flags.md` §Fase 1 (fundação admin) — entregue. Plan `docs/plans/historico-precos.md` §5.5 ainda referencia o mesmo desenho.

**Acceptance criteria:**

- [x] `users.is_admin` column exists. (Migration `0019_add_users_is_admin.sql`, aplicada.)
- [x] JWT carries `isAdmin` claim; login/register pass it. (`apps/api/src/modules/auth/auth.routes.ts` — `jwt.sign({ userId, userEmail, isAdmin })`.)
- [x] A real admin can log in and reach `FeatureFlagsPage`. (Validado E2E manual: register `admin@omestreafiliado.com.br` → JWT com `isAdmin=true` → `GET /api/admin/feature-flags` retorna as 2 flags.)
- [x] Toggling `evolution_send_enabled` actually pauses the dispatcher. (Validado E2E manual: PATCH `false` → log `"Envio pausado por feature flag"` no dispatcher em ~5s; PATCH `true` → mainLoop retoma.)

**O que falta:** E2E specs (`e2e/feature-flags.api.spec.ts` + `e2e/feature-flags.ui.spec.ts`) — coberto na Phase 8.

---

## Phase 1: ~~Bootstrap admin + feature flags operacionais~~ ✅ FECHADO em 2026-07-31

**Objective:** any user promoted to admin (via `UPDATE omestre.users SET is_admin = true ...`) can log in, reach the feature-flags UI, and flip operational kill switches end-to-end. Bootstrap via `ADMIN_EMAILS` foi removido em 2026-08-06.

**Why this position:** without admin, **the entire admin UI is cosmetic** (catalog, feature flags, future dashboards). This is the foundation that unblocks the rest of the table.

**Dependencies:** none.

**Expected output:** ✅ entregue — admin login funciona via env; `FeatureFlagsPage` alcançável; `evolution_send_enabled` toggle pausa/retoma o dispatcher; gate de manutenção corrige bug original (agora só admin bypassa).

- 📋 `docs/plans/feature-flags.md` (Fases 1–4 + 5+6 entregues — só Fases 5-ingestor-kill-switch e 7-E2E-dedicado pendentes, em Phase 8)
- 📋 `docs/plans/historico-precos.md` §5.5 (admin foundation entregue e reusada pelo catálogo)

**Acceptance criteria:**

- [x] `users.is_admin` migration applied.
- [x] JWT carries `isAdmin`; backend guards use it.
- [x] Dispatcher reads `evolution_send_enabled` flag in `mainLoop` before XREADGROUP (pause behavior).
- [x] E2E: admin logs in → opens `FeatureFlagsPage` → toggles `evolution_send_enabled` → asserts no message leaves Queue B for the paused window. _(manual E2E validado em 2026-07-31; spec automatizado entra na Phase 8.)_

---

## Phase 2: ~~Magalu real~~ ✅ FECHADO em 2026-07-31

**Objective:** Magalu becomes the **fourth functional marketplace** (afiliado / tenant / conversor / E2E) — out of placeholder, into real product. ✅ Done.

**Why this position:** explicit owner demand; **3rd-largest BR e-commerce was blocked** behind "Marketplace ainda não liberado" UI. Now released.

**Dependencies:** none (parallel to Phase 1).

**Expected output:** ✅ entregue — usuário configura afiliado Magalu (slug do Influenciador Magalu), converte `magazineluiza.com.br/p/{id}` e `maga.lu/{id}` para `magazinevoce.com.br/{slug}/...`, e recebe via pipeline de espelhamento (E2E verde P1–P11 + suite dedicada `magalu.api.spec.ts`).

- 📋 `docs/plans/magalu.md` (plano continua em `plans/` até segunda iteração — feature entregue mas aguardando estabilização antes de mover para `specs/`)
- 📋 `docs/marketplaces/magalu/api-reference.md` (referência de API criada)
- ✅ E2E: `e2e/magalu.api.spec.ts` (cadastro, conversão, profile, test-conversion) + cenário P11 em `mirror-pipeline.api.spec.ts`

**Acceptance criteria:**

- [x] `magalu_affiliates` table + repository (migration `0020_add_magalu_affiliates.sql`, `MagaluAffiliateRepository` com cobertura ≥ 80%).
- [x] `convertMagaluUrl()` retorna `ConversionResult` (nunca lança); helper puro `magalu-pure.ts` 100% cobertura.
- [x] `POST /api/magalu/convert` + CRUD `/api/magalu/affiliate` + validação de slug `^[a-z0-9-]{3,40}$`.
- [x] E2E: cadastro → PUT slug → GET/PUT/DELETE → conversão com `affiliateUrl = magazinevoce.com.br/{slug}/...`.
- [x] Ingestor: `convertMagaluForAffiliate` + `verifyMagaluStoreSlug` + `classifyUnsupportedMarketplace('magalu') === null`.
- [x] UI: aba Magalu em Settings (`MagaluConfigSection`) + dashboard counts + Magalu no breakdown.
- [x] Pipeline: ofertas `magazineluiza.com.br/p/{id}` e `maga.lu/{id}` chegam ao grupo destino com link afiliado (P11 verde).
- [x] Notifier: `magalu_account_not_linked` (cooldown 1h/Redis) — notifica afiliado sem slug configurado via WhatsApp.

---

## Phase 2.5: ~~Foto do grupo + refresh manual + cache de 1 dia~~ ✅ FECHADO em 2026-08-01

**Objective:** o formulário de espelhamento mostra a foto do grupo no
dropdown, deixa o usuário forçar refresh manual e reduz a pressão sobre
a Evolution API com cache de 1 dia. ✅ Done.

**Why this position:** depois de Phase 1 (admin) e Phase 2 (Magalu), a
lista de grupos era o gargalo visual e de UX que o owner usava
diariamente. Foto acelera o reconhecimento, refresh manual cobre
"entrei em um grupo novo e ele não aparece", e o cache de 1 dia reduz
carga na Evolution (que tem rate-limit agressivo).

**Dependencies:** nenhuma. Independente do espelhamento e do Mirroring
CRUD.

**Expected output:** ✅ entregue — cache Redis `whatsapp:groups:v3:{user}`
com TTL 86400s, `pictureUrl` propagado da Evolution API até o
dropdown, `GroupAvatar` com fallback de inicial, botão "Atualizar
grupos" no `PageHeader` de `MirrorFormPage` que dispara `?force=true`
em ambos os autocompletes ao mesmo tempo, JID removido de ambos
os dropdowns mas mantido nas tags de origem (decisão de UX preservada).

- ✅ `docs/specs/grupos-autocomplete.md` (entregue; plano `docs/plans/grupos-autocomplete.md` v0.1.0 foi a fonte do desenho e foi movido/criado como spec 1.0.0 após validação)
- ✅ E2E: `e2e/mirror-form-groups-refresh.ui.spec.ts` (6 cenários)

**Acceptance criteria:**

- [x] `pictureUrl: string | null` propagado por toda a cadeia
      (Evolution API → `normalizeGroupsForInstance` → `fetchGroups` →
      cache Redis → `useWhatsAppGroups` → `GroupAvatar`).
- [x] `GroupAvatar` renderiza `<img>` com `pictureUrl` ou
      fallback para span cinza com inicial (preserva acentos).
- JID removido do item do dropdown de origem, de destino, e das
  tags selecionadas. Tags passam a mostrar `GroupAvatar` (img
  ou inicial) + nome, alinhado com o dropdown.
- [x] Botão "Atualizar grupos" no `PageHeader` dispara
      `?force=true` em ambos os autocompletes; validado no teste
      E2E com `page.route` capturando a URL.
- [x] TTL do cache Redis: 86400s. Chave bumpada para `v3` para
      invalidar caches legados no deploy.
- [x] `bun run typecheck` 0 erros, `bun run test:unit` 100%
      verde (2288 testes), `bun run build` verde, coverage
      agregada 96.38%.

---

## Phase 3: Catálogo de preço (somente admin)

**Objective:** persist product offers + price history + admin-only UI for consultation.

**Why this position:** when Phase 1 (admin bootstrap) exists, the `isAdmin` gate works. Catalog runs on its own Queue C (isolated from Queue A/B) — zero impact on the sending path.

**Dependencies:** Phase 1.

**Expected output:** every product that traverses the ingestor is also recorded in the catalog with price snapshots; admin can browse the catalog and price history; `apps/catalog-worker` runs as a third worker.

- 📋 `docs/plans/historico-precos.md`

**Acceptance criteria:**

- [ ] `apps/catalog-worker` consumes Queue C `omestre:mirror:catalog`.
- [ ] `products`, `variations`, `price_points` tables populated by CatalogWorker.
- [ ] Admin UI: catalog browse + price history chart per variation.
- [ ] E2E: ingestor publishes CatalogJob → catalog-worker writes row → admin can read it.

---

## Phase 4: Hardening Amazon

**Objective:** Amazon end-to-end guaranteed green (E2E 100%, per-marketplace observability, full link verifier).

**Why this position:** marketplace validated, base solid; reuses the template proved by Magalu (Phase 2).

**Dependencies:** Phase 2 (template reuse).

**Expected output:** all Amazon-specific flows covered by E2E; observability dashboards split per marketplace (Amazon / ML / Shopee / Magalu); link verifier walks every Amazon shortlink every N hours.

- 📋 `docs/plans/melhorias-ml.md` (cross-cutting ML patterns to apply to Amazon)

**Acceptance criteria:**

- [ ] All Amazon E2E green (`e2e/amazon.api.spec.ts`, `e2e/amazon.ui.spec.ts`).
- [ ] Per-marketplace counters exposed in `WorkerStatusPage`.
- [ ] Link verifier cron runs against all known Amazon shortlinks.

---

## Phase 5: Tenant + convites de funcionário

**Objective:** `affiliate_accounts`, `affiliate_admin` / `affiliate_user`, invitations, individual permissions.

**Why this position:** unlocks multi-user per account, fixes IDOR gaps. Depends on Magalu being validated (today 1 afiliado = 1 tenant).

**Dependencies:** Phase 2.

**Expected output:** an account owner can invite employees, assign per-marketplace permissions, and revoke access; IDOR gaps in existing endpoints closed.

- 📋 plan TBD (`docs/plans/tenant-and-invites.md`)

**Acceptance criteria:**

- [ ] `affiliate_accounts`, `affiliate_members` tables + repository.
- [ ] Invite flow: owner sends invite email → recipient accepts → account-scoped JWT.
- [ ] Per-member per-marketplace permission matrix enforced at the API layer.
- [ ] All existing endpoints audited for IDOR under multi-tenant model.

---

## Phase 6: Operação ML

**Objective:** polish the ML flow operationally — auto cookie refresh, intelligent fallback, URL batching, descriptive error messages, ML-specific tests.

**Why this position:** low risk / high return; doesn't touch the foundation.

**Dependencies:** none.

**Expected output:** ML affiliate operation is hands-off — cookies auto-renew, errors are actionable, batching reduces API calls.

- 📋 `docs/plans/melhorias-ml.md`

**Acceptance criteria:**

- [ ] `refreshSessionCookies()` actually renews `www.mercadolivre.com.br` cookies on 401/403.
- [ ] `valid: false` from `/api/ml/affiliates/:mlUserId/validate-cookies` surfaces in the affiliates list as "🍪 expirado".
- [ ] Batch convert endpoint accepts N URLs in one request.
- [ ] ML E2E exercises cookie-expiry fallback path.

---

## Phase 7: Templates avançados — Fase 5 (E2E dedicado)

**Objective:** ship the E2E coverage for the template system already in production, remove `MirrorConfigSection` if it became obsolete.

**Why this position:** code is already shipping; only the test loop is open.

**Dependencies:** none.

**Expected output:** E2E that composes a real template (mixed placeholders + conditional + humanized syntax), previews it, saves it, reloads the page, and asserts the template persists and resolves correctly.

- 📋 open follow-up in `docs/specs/template-mensagem.md`

**Acceptance criteria:**

- [ ] E2E spec `e2e/template-editor.ui.spec.ts` green.
- [ ] `MirrorConfigSection` removed if superseded by `TemplateEditor`/`TemplatePreview`.

---

## Phase 8: Feature flags — Fases 5 + 7 restantes

**Objective:** complete the feature-flags system — `ingest_enabled` kill switch on the ingestor + Playwright E2E for the dispatcher kill switch (depends on Phase 1).

**Why this position:** depends on Phase 1 (admin bootstrap); completes operational coverage.

**Dependencies:** Phase 1.

**Expected output:** ingestor can be paused via flag without restarting the process; E2E covers the dispatcher pause path.

- 📋 `docs/plans/feature-flags.md` (Fases 5 + 7)

**Acceptance criteria:**

- [ ] `ingest_enabled` flag honored in `apps/ingestor` `mainLoop`.
- [ ] E2E for dispatcher pause/resume via flag (already covered in Phase 1 acceptance).
- [ ] Flag observability: per-flag per-minute counter exposed in admin UI.

---

## Phase 8.5: Admin-center (feature flags + worker status) 🚧→ ✅ (pending merge + E2E manual em prod)

**Objective:** mover as telas de feature flags e status do worker (hoje em
`apps/web` + `apps/api`) para o painel single-user `apps/admin-api` +
`apps/admin-web` no VPS. Auto-contido: mesmo PostgreSQL e Redis do
`apps/api`, sem proxy entre os 2 apps.

**Why this position:** desacopla operação crítica de deploy do fluxo
multi-user. Em emergência (deploy quebrado, dispatcher travado, fila
lotada) o owner não precisa do `apps/web`/`apps/api` no ar — só do admin.

**Dependencies:** Phase 1 (admin bootstrap entregue — `sessionAuth()` do
admin-api já cobre o single-user).

**Expected output:** `/feature-flags` e `/worker-status` (incluindo DLQ)
acessíveis via `admin.omestreafiliado.com.br` com sessão; `docker-compose.yml`
inclui `admin-api` + `admin-web`; `apps/api` continua com os mesmos endpoints
(`/api/admin/feature-flags`, `/api/worker/*`) para o `apps/web` legado.

- 🚧 `docs/plans/admin-feature-flags-worker-status.md` (em andamento — branch `wt/admin-center`)

**Acceptance criteria:**

- [x] `packages/feature-flags-sdk` publicado com testes verdes. _(25/25 testes passam — `cd packages/feature-flags-sdk && bun test`)_
- [x] `apps/admin-api` com `/api/admin/feature-flags` (GET/PATCH) +
      `/api/admin/worker/{status,dlq,dlq/requeue,dlq/remove,dlq/purge}`.
      _(factory `createFeatureFlagsRoutes` + `createWorkerRoutes` com `sessionAuth()`)_
- [x] `apps/admin-web` com `/feature-flags` + `/worker-status` (porta 1:1 do
      `apps/web`, trocando `useAuth` por `getToken()`).
- [x] `docker-compose.yml` (prod) com serviços `admin-api` + `admin-web`,
      healthcheck e env vars certas (`REDIS_URL`, `METRICS_API_KEY`, etc.).
- [x] PR [#18](https://github.com/mtorreao/o-mestre-afiliado/pull/18) aberto com 4 commits (SDK → admin-api → admin-web → compose+docs).

---

## Phase 9: Extensão Chrome — Fases 2–5

**Objective:** context-menu "Gerar link de afiliado" → offer capture → multi-marketplace → distribution.

**Why this position:** only worth generalising once the ML flow is validated (Phase 6).

**Dependencies:** Phase 6.

**Expected output:** right-click on a product page generates an affiliate link; captured offers persist in extension storage; multi-marketplace routing picks the right converter; distribution to WhatsApp via Evolution optional, behind a confirmation.

- 📋 open follow-up in `docs/specs/extensao-chrome-evolucao.md`

**Acceptance criteria:**

- [ ] Context menu item registered on `magazineluiza.com.br`, `mercadolivre.com.br`, `shopee.com.br`, `amazon.com.br`.
- [ ] Capture flow: page → product metadata → saved offer list.
- [ ] Multi-marketplace routing uses `detectMarketplace()`.
- [ ] Confirm-dialog before any WhatsApp send.

---

## Phase 10: Roadmap re-validado

**Objective:** refresh the roadmap with what real usage has taught us.

**Why this position:** document is alive; rewrite after each wave lands.

**Dependencies:** none.

**Expected output:** this file rewritten with a fresh Last updated: and a new Decision log row reflecting what changed.

**Acceptance criteria:**

- [ ] Phases re-ordered by current impact.
- [ ] Every accepted-criteria checkbox above is checked or moved to a new plan.
- [ ] Decision log has at least one new entry per quarter.

---

## ✅ Entregue (com link para spec)

Specs already validated and merged to `main`. Listed in **delivery order**, not impact order.

| #   | Entrega                                                     | Spec                                                                                                                                | Resumo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Dev stack multi-worktree**                                | [`docs/specs/multi-worktree-dev-stack.md`](./specs/multi-worktree-dev-stack.md)                                                     | `bun run dev` com identidade derivada da branch (slug DNS/Compose, portas determinísticas, lockdir, 3 modos de tunnel). Mergeado em `e53285c`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | **Arquitetura do Worker v2** (2 filas, 2 workers)           | [`docs/specs/arquitetura-worker.md`](./specs/arquitetura-worker.md)                                                                 | `apps/ingestor` + `apps/dispatcher` + `packages/worker-common`. Queues Redis A/B, dedup webhook 30s, send-dedup 1h, send-completed 24h, fan-out 1:N com cache `mirror:source-group:{jid}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | **Testes E2E da arquitetura v2**                            | [`docs/specs/testes-e2e-arquitetura-worker.md`](./specs/testes-e2e-arquitetura-worker.md)                                           | Suíte Playwright `mirror-pipeline.api.spec.ts` (P1–P9) + `worker-status.api.spec.ts` (W1–W7). Cobre pipeline end-to-end via Amazon (sem credenciais secretas), fan-out, dedup, fallback imagem→texto, mirror inativo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4   | **Autenticação + cadastro de afiliado**                     | [`docs/specs/autenticacao-cadastro-afiliado.md`](./specs/autenticacao-cadastro-afiliado.md)                                         | Tabela `users` + `user_credentials` + `user_id` em `ml_affiliates`. JWT via `@elysiajs/jwt`. Hook `useAuth` + Login/Register/Dashboard. `POST /api/affiliate/test-conversion` por usuário.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5   | **Worker Monitoring (tela operacional)**                    | [`docs/specs/worker-monitoring.md`](./specs/worker-monitoring.md)                                                                   | `WorkerStatusPage` com 5 seções (Pipeline / Resumo / Ingestor / Dispatcher / DLQ). Filtros server-side, auto-refresh 30s, copiar JSON, badge pulsante. Endpoints `/api/worker/dlq*` com `total` + `totalFiltered`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6   | **Extensão Chrome — Fases 0 + 1** (segurança + sync)        | [`docs/specs/extensao-chrome-evolucao.md`](./specs/extensao-chrome-evolucao.md)                                                     | Service worker MV3, popup simplificado (greeting + 2 botões), validação da URL da API, sincronização explícita via `validate-cookies`, helpers puros e redaction. Restam Fases 2–5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | **Templates avançados — Fases 1–4**                         | [`docs/specs/template-mensagem.md`](./specs/template-mensagem.md)                                                                   | `TemplateContext` + `buildTemplateContext` + `resolvePlaceholders`. `parseConditionalTemplate` (sintaxe técnica `{?}/{:}/{:/}` + humanizada `{se … senão … fim}`). `POST /api/affiliate/preview-template` + `validate-template`. Frontend integrado em `MirrorFormPage`. **Fase 5 (E2E dedicado) ainda pendente.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 8   | **Amazon — single tracking ID**                             | (refactor sobre `0014_add_amazon_affiliates.sql`)                                                                                   | Migration `0018_simplify_amazon_single_tracking_id.sql` consolida `tracking_ids[]` em 1 tracking ID + flag `active` + `isDefault`. Remove apelido `nickname` legado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 9   | **Bootstrap admin + feature flags Fases 1–6**               | [`docs/plans/feature-flags.md`](./plans/feature-flags.md) (status misto)                                                            | `users.is_admin` (migration `0019`) + promoção via `UPDATE` manual no DB (sem bootstrap por env) + JWT com `isAdmin` + `/api/auth/me` retornando `isAdmin` + bug fix no gate de manutenção (decodifica JWT; só admin bypassa). Dispatcher honra `evolution_send_enabled` em `mainLoop` (kill switch com PubSub + fallback 5s). `FeatureFlagsPage` consumindo `/api/admin/feature-flags` + `MaintenancePage` já existia. `UserPublic` carrega `isAdmin`. Liquida dívida crítica D + Phase 1. Restam Fases 5 (ingestor kill switch) e 7 (E2E dedicado) → Phase 8.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10  | **Magalu — quarto marketplace real** (Influenciador Magalu) | [`docs/plans/magalu.md`](./plans/magalu.md) + [`docs/marketplaces/magalu/api-reference.md`](./marketplaces/magalu/api-reference.md) | Migration `0020_add_magalu_affiliates.sql` + `MagaluAffiliateRepository` + `magalu.ts`/`magalu-pure.ts` (regex slug `^[a-z0-9-]{3,40}$`, shortlink resolution via HEAD/GET, placeholder `produto-{id}/` quando slug ausente). Ingestor: `convertMagaluForAffiliate` + `verifyMagaluStoreSlug` (fail-open sem slug) + `classifyUnsupportedMarketplace('magalu') === null`. API: `/api/magalu/affiliate` (CRUD) + `/convert` + `/validate-slug?slug=X` (HEAD opcional, dev retorna `exists:null`) + bloco `magalu` em `/api/affiliate/profile` + ramo `magalu` em `/api/affiliate/test-conversion`. UI: `MagaluConfigSection` + aba Magalu em Settings + dashboard counts. Notifier: `magalu_account_not_linked` (cooldown 1h/Redis, WhatsApp via Evolution). E2E: `e2e/magalu.api.spec.ts` (cadastro, slug inválido, conversão, profile, test-conversion) + cenário **P11** em `mirror-pipeline.api.spec.ts` (oferta `/p/{id}` espelhada com `affiliateUrl = magazinevoce.com.br/{slug}/.../p/{id}/`). |

**Convenção:** quando uma spec tem phases entregues + phases pendentes, o doc correspondente é atualizado in-loco (status misto). Hoje `extensao-chrome-evolucao.md` (specs/) e `feature-flags.md` (plans/) estão nesse modo.

---

## Princípios de priorização (para uso futuro)

1. **Fundação antes de feature:** toda feature que precisa de admin/kill switch depende da Phase 1 (bootstrap admin). Novas fundações seguem o mesmo padrão: env-defined bootstrap → migration idempotente → package dedicado → rotas API → worker consuming → frontend com gate.
2. **Kill switch antes de release:** qualquer feature nova que toca o pipeline deve ser amarrada a uma flag antes do rollout.
3. **Aproveitar o padrão existente:** Magalu (Phase 2) e Amazon hardening (Phase 4) seguem o template já validado (DB → converter → API → UI → E2E). Reaproveitar reduz risco e tempo.
4. **Magalu antes de Amazon:** owner pediu explicitamente; trabalho isolado, não bloqueia o resto.
5. **Multi-usuário → multi-tenant:** Phase 5 (tenant) só faz sentido depois do catálogo e do hardening Amazon, porque a UI admin vai consumir dados cross-tenant.
6. **Roadmap é vivo:** após cada leva, este documento é reescrito — `docs/roadmap.md` não acumula fases históricas, só o estado atual + próximo horizonte.

---

## Resumo de dependências

```text
Dívida D (bootstrap admin)  ✅ fechado 2026-07-31
Phase 1 (bootstrap admin + feature flags operacionais)  ✅ fechado 2026-07-31
Auth (Entrega 4) entregue
  → destrava catálogo (Phase 3) e qualquer feature admin-only

Phase 2 (Magalu real) → modelo replicável para futuros marketplaces
  → Amazon hardening (Phase 4) reusa template

Phase 3 (Catálogo) → fonte de dados para futuras features de comparativo

Phase 5 (Tenant/convites) → base de qualquer feature multi-usuário daqui em diante

Phase 8 (Feature flags — kill switch ingestor + E2E dedicado)
  → fecha as Fases 5+7 do plano `feature-flags.md`
```

---

## Como usar este documento

- **Novo no projeto?** Leia primeiro `docs/README.md` (arquitetura), depois `docs/roadmap.md` (estado atual + horizonte).
- **Vai implementar um item da tabela "Planejado"?** Abra o plano linkado em `docs/plans/`. Eles têm o detalhamento técnico, critérios de aceite e commits sugeridos.
- **Vai consultar uma entrega?** Abra a spec linkada em `docs/specs/`. Ela é a fonte da verdade do que está no código hoje.
- **Achou algo fora do lugar?** Edite este arquivo e o índice em `docs/README.md` no mesmo PR.

---

## Decision log

When the order or scope of phases changes, leave a one-line audit trail here.

| Date       | Change                                                                                                             | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-04 | Phase 8.5: admin-center feature flags + worker status (PR #18 aberto, CI rodando)                                  | Novo pacote `@omestre/feature-flags-sdk` (infra Redis compartilhada — keys/redis/pubsub/metrics + 25 testes com `ioredis-mock`). `apps/admin-api` ganha `routes/feature-flags.ts` (Hono + `sessionAuth()` + GET/PATCH) + `routes/worker.ts` (5 endpoints: status/dlq/requeue/remove/purge) + `services/worker-metrics-pure.ts` (espelho de `apps/api` com comentário de sincronia) + `services/worker-metrics.ts` (orquestrador). `apps/admin-web` porta `FeatureFlagsPage` (165 LOC) + `WorkerStatusPage` (1.791 LOC) + libs `worker-status.ts` (298 LOC) + `worker-counters.ts` (110 LOC), trocando `useAuth` por `getToken()`. `docker-compose.yml` (prod) ganha `admin-api` (+ `REDIS_URL`, `POSTGRES_URL`, `METRICS_API_KEY`, `WORKER_METRICS_URL`, `DISPATCHER_METRICS_URL`) + `admin-web` (depende de `admin-api: healthy`). 4 commits na branch `wt/admin-center` (`f09beee` SDK → `efa8273` admin-api → `7271763` admin-web → `8041ce4` compose). Restam: merge + validação manual em prod (checklist de E2E manual na spec). Plano `docs/plans/admin-feature-flags-worker-status.md` mantido em `plans/` (aguarda estabilização antes de mover para `specs/`). |
| 2026-08-01 | Phase 2.5 fechada: foto do grupo + refresh manual + cache Redis 1 dia                                              | `pictureUrl` propagado da Evolution API → `normalizeGroupsForInstance` → `fetchGroups` → cache Redis `whatsapp:groups:v3:{user}` (TTL 86400s) → `useWhatsAppGroups` → `GroupAvatar` (com fallback de inicial via `getGroupInitial` + `shouldShowGroupImage`) → `renderGroupOption` (helper puro) → itens do dropdown. Botão "Atualizar grupos" no `PageHeader` de `MirrorFormPage` dispara `?force=true` em ambos os autocompletes via `groupsRefreshSignal`. JID removido de ambos os dropdowns mas mantido nas tags de origem. Plano `docs/plans/grupos-autocomplete.md` v0.1.0 → spec `docs/specs/grupos-autocomplete.md` v1.0.0. E2E `e2e/mirror-form-groups-refresh.ui.spec.ts` (6 cenários). 2288 testes passando, typecheck verde, build verde, coverage 96.38%.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-07-31 | Phase 2 fechada: Magalu real como quarto marketplace funcional (DB + conversor + ingestor + API + UI + E2E + docs) | Migration `0020_add_magalu_affiliates.sql` + `MagaluAffiliateRepository` + `magalu.ts`/`magalu-pure.ts` (slugs `^[a-z0-9-]{3,40}$`) + `convertMagaluForAffiliate` + `verifyMagaluStoreSlug` (fail-open sem slug) + rotas `/api/magalu/*` (CRUD + `/convert` + `/validate-slug`) + aba Magalu em Settings (`MagaluConfigSection`) + notifier `magalu_account_not_linked` (cooldown 1h) + spec E2E `e2e/magalu.api.spec.ts` + cenário P11 em `mirror-pipeline.api.spec.ts` + `docs/marketplaces/magalu/api-reference.md`. Total: 4 kanban tasks filhos (`t_f319d3a6` ingestor, `t_ac661608` API, `t_b9eed8f1` web, `t_5982d0c8` E2E+docs). Plano `docs/plans/magalu.md` mantido em `plans/` (aguarda estabilização antes de mover para `specs/`).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-31 | Fechadas dívida crítica D + Phase 1 (bootstrap admin + kill switch Evolution)                                      | `users.is_admin` (migration `0019`) + JWT com `isAdmin` + bug fix gate manutenção. Validado E2E manual contra stack rodando. Faltam E2E specs (Phase 8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-07-28 | Migrated to spec-driven format (Last updated, Phase N sections, Decision log, Revision history)                    | Bootstrap of `spec-driven` skill; preserved entregues table + dependencies; added Phase 10 self-link                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-28 | Reorganized `docs/`: specs implemented → `docs/specs/`; plans → `docs/plans/`                                      | Eliminated `docs/planos/`; rewrote roadmap with entregues + planejado tables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-07-27 | `8cd4e8a` … `ee0fb6d` (extension)                                                                                  | Fases 0+1 da extensão entregues (service worker, popup simplificado, sync inteligente)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-07-26 | worktree `wt/worker-monitoring-9def26` → main                                                                      | Worker Monitoring entregue (spec `worker-monitoring.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-07-25 | `wt/dev-worktree-isolation-20260725` → main (`e53285c`)                                                            | Dev stack multi-worktree entregue (spec `multi-worktree-dev-stack.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-07-20 | Fundação do monorepo                                                                                               | Auth + cadastro de afiliado entregues (spec `autenticacao-cadastro-afiliado.md`). Arquitetura worker v2 + E2E entregues.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## Revision history

| Date       | Version | Change                                                                                         | Reason                                                                                                                                                              |
| ---------- | ------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-04 | 0.6.0   | Phase 8.5 aberta e quase fechada: admin-center feature flags + worker status (PR #18)          | Novo pacote `@omestre/feature-flags-sdk`; `apps/admin-api` ganha CRUD + worker-status; `apps/admin-web` porta 2 pages. Aguardando merge + validação manual em prod. |
| 2026-08-01 | 0.5.0   | Phase 2.5 fechada: foto do grupo + refresh manual + cache Redis 1 dia                          | Spec `grupos-autocomplete.md` publicada a partir do plano v0.1.0; novo commit history row                                                                           |
| 2026-07-31 | 0.4.0   | Phase 2 fechada (Magalu real); nova entrada #10 na tabela Entregue + linha no Decision log     | Magalu quarto marketplace: migration `0020` + conversor + ingestor + API + UI + E2E (P11) + docs.                                                                   |
| 2026-07-31 | 0.3.0   | Fechadas dívida crítica D + Phase 1; nova entrada #9 na tabela Entregue                        | Bootstrap admin (users.is_admin + JWT isAdmin) + kill switch Evolution; novo commit history row                                                                     |
| 2026-07-28 | 0.2.0   | Migrated to spec-driven format (Phase N sections, Decision log, Revision history, todo phases) | Bootstrap of `spec-driven` skill — preserved semantic content from previous format                                                                                  |
| 2026-07-28 | 0.1.0   | Initial scaffold (Entregue + Planejado tables, dependencies, principles)                       | Project reorganize of `docs/`                                                                                                                                       |
