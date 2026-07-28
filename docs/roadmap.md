# Roadmap — O Mestre Afiliado

**Last updated:** 2026-07-28
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

### D — Bootstrap admin quebrado

**Why this is critical:** without `is_admin` in `users` + `ADMIN_EMAILS` in config + JWT assignment on login, **no user becomes admin through the normal flow**. The `FeatureFlagsPage` UI is drawn but inaccessible. Blocks catalog (admin-only UI), operational feature flags, and any new kill switch.

- 📋 Plan: `docs/plans/feature-flags.md` §Fases 1+ (foundation); admin bootstrap prerequisite documented in `docs/plans/historico-precos.md` §5.5.

**Acceptance criteria:**
- [ ] `users.is_admin` column exists; admin bootstrap via `ADMIN_EMAILS` env works.
- [ ] JWT carries `isAdmin` claim; login/register pass it.
- [ ] A real admin can log in and reach `FeatureFlagsPage`.
- [ ] Toggling `evolution_send_enabled` actually pauses the dispatcher.

---

## Phase 1: Bootstrap admin + feature flags operacionais

**Objective:** any user in `ADMIN_EMAILS` can log in as admin, reach the feature-flags UI, and flip operational kill switches end-to-end.

**Why this position:** without admin, **the entire admin UI is cosmetic** (catalog, feature flags, future dashboards). This is the foundation that unblocks the rest of the table.

**Dependencies:** none.

**Expected output:** admin login works via env-defined emails; `FeatureFlagsPage` reachable; `evolution_send_enabled` toggle actually pauses/resumes the dispatcher; E2E test that drives the full toggle.

- 📋 `docs/plans/feature-flags.md` (Fases 1+ foundation + dispatcher kill switch + E2E)
- 📋 `docs/plans/historico-precos.md` §5.5 (admin foundation reuses the same `is_admin` + `ADMIN_EMAILS` design)

**Acceptance criteria:**
- [ ] `users.is_admin` migration applied; `ADMIN_EMAILS` env documented in `.env.example`.
- [ ] JWT carries `isAdmin`; backend guards use it.
- [ ] Dispatcher reads `evolution_send_enabled` flag in `mainLoop` before XREADGROUP (pause behavior).
- [ ] E2E: admin logs in → opens `FeatureFlagsPage` → toggles `evolution_send_enabled` → asserts no message leaves Queue B for the paused window.

---

## Phase 2: Magalu real ⭐ PRIORIDADE ALTA

**Objective:** Magalu becomes the **fourth functional marketplace** (afiliado / tenant / conversor / E2E) — out of placeholder, into real product.

**Why this position:** explicit owner demand; **3rd-largest BR e-commerce is currently blocked** behind "Marketplace ainda não liberado" UI. Converter already exists (`magalu.ts` + `magalu-pure.ts`); missing DB/API/UI/ingestor.

**Dependencies:** none (parallel to Phase 1).

**Expected output:** end-user can configure a Magalu affiliate (Influenciador Magalu), generate short links for any `magazinevoce.com.br/p/{id}` URL, and receive those links via the existing mirror pipeline (E2E green). New tenants onboarded via the same flow as Shopee/ML/Amazon.

- 📋 `docs/plans/magalu.md`

**Acceptance criteria:**
- [ ] `magalu_affiliates` table (per `ml_affiliates` shape) + repository.
- [ ] `convertMagaluUrl()` returns a `ConversionResult` (pure function) — never throws.
- [ ] `POST /api/magalu/convert` endpoint following the same pattern as `/api/ml/convert`.
- [ ] E2E: register Magalu affiliate → convert a real URL → preview returns resolved affiliate URL.
- [ ] Ingestor routes `magazinevoce.com.br` links into the Magalu converter (matches existing pattern for Shopee/ML).
- [ ] UI: marketplace picker shows Magalu enabled (gated on `magalu_affiliates` row).

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

| #   | Entrega                                                 | Spec                                                                                                   | Resumo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Dev stack multi-worktree**                            | [`docs/specs/multi-worktree-dev-stack.md`](./specs/multi-worktree-dev-stack.md)                        | `bun run dev` com identidade derivada da branch (slug DNS/Compose, portas determinísticas, lockdir, 3 modos de tunnel). Mergeado em `e53285c`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | **Arquitetura do Worker v2** (2 filas, 2 workers)       | [`docs/specs/arquitetura-worker.md`](./specs/arquitetura-worker.md)                                    | `apps/ingestor` + `apps/dispatcher` + `packages/worker-common`. Queues Redis A/B, dedup webhook 30s, send-dedup 1h, send-completed 24h, fan-out 1:N com cache `mirror:source-group:{jid}`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | **Testes E2E da arquitetura v2**                        | [`docs/specs/testes-e2e-arquitetura-worker.md`](./specs/testes-e2e-arquitetura-worker.md)              | Suíte Playwright `mirror-pipeline.api.spec.ts` (P1–P9) + `worker-status.api.spec.ts` (W1–W7). Cobre pipeline end-to-end via Amazon (sem credenciais secretas), fan-out, dedup, fallback imagem→texto, mirror inativo.                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4   | **Autenticação + cadastro de afiliado**                 | [`docs/specs/autenticacao-cadastro-afiliado.md`](./specs/autenticacao-cadastro-afiliado.md)            | Tabela `users` + `user_credentials` + `user_id` em `ml_affiliates`. JWT via `@elysiajs/jwt`. Hook `useAuth` + Login/Register/Dashboard. `POST /api/affiliate/test-conversion` por usuário.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | **Worker Monitoring (tela operacional)**                | [`docs/specs/worker-monitoring.md`](./specs/worker-monitoring.md)                                      | `WorkerStatusPage` com 5 seções (Pipeline / Resumo / Ingestor / Dispatcher / DLQ). Filtros server-side, auto-refresh 30s, copiar JSON, badge pulsante. Endpoints `/api/worker/dlq*` com `total` + `totalFiltered`.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6   | **Extensão Chrome — Fases 0 + 1** (segurança + sync)    | [`docs/specs/extensao-chrome-evolucao.md`](./specs/extensao-chrome-evolucao.md)                        | Service worker MV3, popup simplificado (greeting + 2 botões), validação da URL da API, sincronização explícita via `validate-cookies`, helpers puros e redaction. Restam Fases 2–5.                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | **Templates avançados — Fases 1–4**                     | [`docs/specs/template-mensagem.md`](./specs/template-mensagem.md)                                      | `TemplateContext` + `buildTemplateContext` + `resolvePlaceholders`. `parseConditionalTemplate` (sintaxe técnica `{?}/{:}/{:/}` + humanizada `{se … senão … fim}`). `POST /api/affiliate/preview-template` + `validate-template`. Frontend integrado em `MirrorFormPage`. **Fase 5 (E2E dedicado) ainda pendente.**                                                                                                                                                                                                                                                  |
| 8   | **Amazon — single tracking ID**                         | (refactor sobre `0014_add_amazon_affiliates.sql`)                                                      | Migration `0018_simplify_amazon_single_tracking_id.sql` consolida `tracking_ids[]` em 1 tracking ID + flag `active` + `isDefault`. Remove apelido `nickname` legado.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Convenção:** quando uma spec tem phases entregues + phases pendentes, o doc correspondente é atualizado in-loco (status misto). Hoje só `extensao-chrome-evolucao.md` (specs/) está nesse modo; `feature-flags.md` vive em `plans/` enquanto só partes estão entregues.

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
Dívida D (bootstrap admin)  ─┐
                              ├─→ destrava todos os itens admin-only da tabela
Auth (Entrega 4) entregue  ──┘   (catálogo, feature flags operacionais)

Phase 1 (bootstrap admin + feature flags operacionais)
  → habilita catálogo (Phase 3) sem risco operacional
  → habilita qualquer nova feature de produto com gate admin

Phase 2 (Magalu real) → modelo replicável para futuros marketplaces
  → Amazon hardening (Phase 4) reusa template

Phase 3 (Catálogo) → fonte de dados para futuras features de comparativo

Phase 5 (Tenant/convites) → base de qualquer feature multi-usuário daqui em diante
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

| Date       | Change                                                                                           | Reason                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 2026-07-28 | Migrated to spec-driven format (Last updated, Phase N sections, Decision log, Revision history)  | Bootstrap of `spec-driven` skill; preserved entregues table + dependencies; added Phase 10 self-link  |
| 2026-07-28 | Reorganized `docs/`: specs implemented → `docs/specs/`; plans → `docs/plans/`                    | Eliminated `docs/planos/`; rewrote roadmap with entregues + planejado tables                          |
| 2026-07-27 | `8cd4e8a` … `ee0fb6d` (extension)                                                               | Fases 0+1 da extensão entregues (service worker, popup simplificado, sync inteligente)               |
| 2026-07-26 | worktree `wt/worker-monitoring-9def26` → main                                                    | Worker Monitoring entregue (spec `worker-monitoring.md`)                                              |
| 2026-07-25 | `wt/dev-worktree-isolation-20260725` → main (`e53285c`)                                          | Dev stack multi-worktree entregue (spec `multi-worktree-dev-stack.md`)                                |
| 2026-07-20 | Fundação do monorepo                                                                            | Auth + cadastro de afiliado entregues (spec `autenticacao-cadastro-afiliado.md`). Arquitetura worker v2 + E2E entregues. |

---

## Revision history

| Date       | Version | Change                                                                                          | Reason                                                                                |
| ---------- | ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 2026-07-28 | 0.2.0   | Migrated to spec-driven format (Phase N sections, Decision log, Revision history, todo phases) | Bootstrap of `spec-driven` skill — preserved semantic content from previous format  |
| 2026-07-28 | 0.1.0   | Initial scaffold (Entregue + Planejado tables, dependencies, principles)                       | Project reorganize of `docs/`                                                        |