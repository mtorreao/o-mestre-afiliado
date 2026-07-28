# Roadmap — O Mestre Afiliado

> **Status:** documento vivo. Topo: o que **já foi entregue** (com link para a spec). Final: o que está **planejado**, ordenado por impacto (maior → menor).
>
> As specs em `docs/specs/` são a fonte de detalhe e critério de aceite das entregas. Os planos em `docs/plans/` continuam sendo a fonte de detalhe das features ainda não implementadas.

---

## ✅ Entregue (com link para spec)

Lista em **ordem cronológica de entrega** (não de impacto — o impacto está nas fases concluídas dos planos originais).

| #   | Entrega                                                 | Spec                                                                                                   | Resumo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Dev stack multi-worktree**                            | [`docs/specs/multi-worktree-dev-stack.md`](./specs/multi-worktree-dev-stack.md)                        | `bun run dev` com identidade derivada da branch (slug DNS/Compose, portas determinísticas, lockdir, 3 modos de tunnel). Mergeado em `e53285c`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | **Arquitetura do Worker v2** (2 filas, 2 workers)       | [`docs/specs/arquitetura-worker.md`](./specs/arquitetura-worker.md)                                    | `apps/ingestor` + `apps/dispatcher` + `packages/worker-common`. Queues Redis A/B, dedup webhook 30s, send-dedup 1h, send-completed 24h, fan-out 1:N com cache `mirror:source-group:{jid}`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | **Testes E2E da arquitetura v2**                        | [`docs/specs/testes-e2e-arquitetura-worker.md`](./specs/testes-e2e-arquitetura-worker.md)              | Suíte Playwright `mirror-pipeline.api.spec.ts` (P1–P9) + `worker-status.api.spec.ts` (W1–W7). Cobre pipeline end-to-end via Amazon (sem credenciais secretas), fan-out, dedup, fallback imagem→texto, mirror inativo.                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4   | **Autenticação + cadastro de afiliado**                 | [`docs/specs/autenticacao-cadastro-afiliado.md`](./specs/autenticacao-cadastro-afiliado.md)            | Tabela `users` + `user_credentials` + `user_id` em `ml_affiliates`. JWT via `@elysiajs/jwt`. Hook `useAuth` + Login/Register/Dashboard. `POST /api/affiliate/test-conversion` por usuário.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | **Worker Monitoring (tela operacional)**                | [`docs/specs/worker-monitoring.md`](./specs/worker-monitoring.md)                                      | `WorkerStatusPage` com 5 seções (Pipeline / Resumo / Ingestor / Dispatcher / DLQ). Filtros server-side, auto-refresh 30s, copiar JSON, badge pulsante. Endpoints `/api/worker/dlq*` com `total` + `totalFiltered`.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6   | **Extensão Chrome — Fases 0 + 1** (segurança + sync)    | [`docs/specs/extensao-chrome-evolucao.md`](./specs/extensao-chrome-evolucao.md)                        | Service worker MV3, popup simplificado (greeting + 2 botões), validação da URL da API, sincronização explícita via `validate-cookies`, helpers puros e redaction. Restam Fases 2–5 (ver [`docs/plans/magalu.md`](./plans/magalu.md) para a próxima grande entrega).                                                                                                                                                                                                                                                                                                                                                           |
| 7   | **Templates avançados — Fases 1–4**                     | [`docs/specs/template-mensagem.md`](./specs/template-mensagem.md)                                      | `TemplateContext` + `buildTemplateContext` + `resolvePlaceholders`. `parseConditionalTemplate` (sintaxe técnica `{?}/{:}/{:/}/{?}` + humanizada `{se … senão … fim}`). `POST /api/affiliate/preview-template` + `POST /api/affiliate/validate-template`. Frontend: `PlaceholderPicker`, `TemplateEditor`, `TemplatePreview` integrados em `MirrorFormPage`. **Fase 5 (E2E dedicado) ainda pendente.**                                                                                                                                                                                                                         |
| 8   | **Feature flags — Modo manutenção + kill switch envio** | [`docs/plans/feature-flags.md`](./feature-flags.md) (Fases 1–4 e 6 parciais; admin bootstrap pendente) | Package `@omestre/feature-flags` (registry + client + Redis PubSub). Migration `0016_add_feature_flags.sql` + `FeatureFlagRepository`. Rotas `/api/admin/feature-flags` (GET/PATCH). Flags: `maintenance_mode`, `evolution_send_enabled`. Dispatcher pausa no `mainLoop` antes do XREADGROUP. Frontend `FeatureFlagsPage` + `MaintenancePage`. **⚠️ Atenção: admin bootstrap quebrado — `users.is_admin` não existe no schema, `ADMIN_EMAILS` não está no `config`, login/register não passam `isAdmin` no JWT. Hoje nenhum usuário consegue virar admin pelo fluxo normal; a UI de feature flags é inacessível na prática.** |
| 9   | **Amazon — single tracking ID**                         | (refactor sobre `0014_add_amazon_affiliates.sql`)                                                      | Migration `0018_simplify_amazon_single_tracking_id.sql` consolida `tracking_ids[]` em 1 tracking ID + flag `active` + `isDefault`. Remove apelido `nickname` legado. Segue trabalho de Magalu (próxima entrega prioritária).                                                                                                                                                                                                                                                                                                                                                                                                  |

> **Convenção:** sempre que uma feature parcialmente implementada tiver phases "entregues" e phases "pendentes", o doc da spec correspondente deve ser atualizado in-loco para refletir o status real — ou, se preferir split, criar uma spec nova. Hoje só `feature-flags.md` (em `docs/plans/`) e `extensao-chrome-evolucao.md` (em `docs/specs/`) têm esse comportamento híbrido.

---

## ⚠️ Dívida crítica (corrigir antes de novas features)

| #   | Item                                                                         | Por que é crítico                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D   | **Bootstrap admin quebrado** — corrigir antes de qualquer feature admin-only | Sem `is_admin` na tabela `users` + `ADMIN_EMAILS` no `config` + assignment do JWT no login, **nenhum usuário vira admin pelo fluxo normal**. A UI `FeatureFlagsPage` é desenhada mas inacessível. Bloqueia catálogo (UI admin-only), feature flags operacionais, e qualquer kill switch novo. |

---

## ⏳ Planejado (em ordem de impacto, maior → menor)

A ordem abaixo foi escolhida para maximizar o retorno de cada entrega. Cada item linka para o plano detalhado.

| #   | Plano                                                                  | Entrega de valor                                                                                                                           | Por que nesta posição                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Bootstrap admin + feature flags operacionais**                       | Migration `users.is_admin`, env `ADMIN_EMAILS`, assignment no JWT; ligar `evolution_send_enabled` de verdade no dispatcher; E2E dedicado   | Sem admin real, **toda a UI admin é cosmética** (catálogo, feature flags, futuros dashboards). Esta é a fundação que destrava o resto da tabela. Sem isso, nenhum item admin funciona.            |
| 2   | **Magalu real** ⭐ PRIORIDADE ALTA                                     | Marketplace 4 funcional (afiliado/tenant/conversor/E2E) — sai do placeholder para produto real                                             | Demanda direta do owner; 3º maior e-commerce BR está **bloqueado** com mensagem "Marketplace ainda não liberado". Conversor já existe (`magalu.ts` + `magalu-pure.ts`); falta DB/API/UI/ingestor. |
| 3   | **Catálogo de preço** (somente admin)                                  | Persistência de ofertas + histórico de preço + UI admin de consulta                                                                        | Quando bootstrap admin existir, gate `isAdmin` funciona. Worker isolado (Queue C) → zero impacto no envio.                                                                                        |
| 4   | **Hardening Amazon**                                                   | Garantir Amazon ponta a ponta (E2E 100% verde, observabilidade por marketplace, link-verifier completo)                                    | Marketplace validado, base sólida. Reusa template do Magalu (item 2).                                                                                                                             |
| 5   | **Tenant + convites de funcionário**                                   | `affiliate_accounts`, `affiliate_admin`/`affiliate_user`, convites, permissões individuais                                                 | Destrava multi-usuário por conta, corrige gaps de IDOR. Depende da Magalu estar validada (1 afiliado = 1 tenant hoje).                                                                            |
| 6   | **Operação ML**                                                        | Renovação automática de cookies (`refreshSessionCookies` já existe), fallback inteligente, batch de URLs, mensagens descritivas, testes ML | Polimento operacional; não impacta fundação. Itens de baixo risco / alto retorno.                                                                                                                 |
| 7   | **Templates avançados — Fase 5**                                       | E2E dedicado + remoção de `MirrorConfigSection` se obsoleto                                                                                | Código já está em produção; só falta fechar o ciclo de testes E2E.                                                                                                                                |
| 8   | **Feature flags — Fases 5 + 7 restantes** (ingestor kill switch + E2E) | `ingest_enabled` flag + E2E Playwright                                                                                                     | Depende do item 1 (bootstrap admin); completa a cobertura operacional.                                                                                                                            |
| 9   | **Extensão Chrome — Fases 2–5** (conversão contextual → distribuição)  | Context menu "Gerar link de afiliado" → captura de oferta → multi-marketplace → distribuição                                               | Só vale generalizar depois de validar o fluxo ML na Fase 6.                                                                                                                                       |
| 10  | **Roadmap re-validado**                                                | Refresh do roadmap com base no uso real                                                                                                    | Documento vivo: reescrito após cada leva concluída.                                                                                                                                               |

---

## Princípios de priorização (para uso futuro)

1. **Fundação antes de feature:** toda feature que precisa de admin/kill switch depende do item 1 (bootstrap admin). Novas fundações seguem o mesmo padrão: env-defined bootstrap → migration idempotente → package dedicado → rotas API → worker consuming → frontend com gate.
2. **Kill switch antes de release:** qualquer feature nova que toca o pipeline deve ser amarrada a uma flag antes do rollout.
3. **Aproveitar o padrão existente:** Magalu (item 2) e Amazon hardening (item 4) seguem o template já validado (DB → converter → API → UI → E2E). Reaproveitar reduz risco e tempo.
4. **Magalu antes de Amazon:** owner pediu explicitamente; trabalho isolado, não bloqueia o resto.
5. **Multi-usuário → multi-tenant:** item 5 (tenant) só faz sentido depois do catálogo e do hardening Amazon, porque a UI admin vai consumir dados cross-tenant.
6. **Roadmap é vivo:** após cada leva, este documento é reescrito — `docs/roadmap.md` não acumula fases históricas, só o estado atual + próximo horizonte.

---

## Resumo de dependências

```text
Dívida D (bootstrap admin)  ─┐
                              ├─→ destrava todos os itens admin-only da tabela
Fase 8 entregue (auth+login) ┘   (catálogo, feature flags operacionais)

Item 1 (bootstrap admin + feature flags operacionais)
  → habilita catálogo (item 3) sem risco operacional
  → habilita qualquer nova feature de produto com gate admin

Item 2 (Magalu real) → modelo replicável para futuros marketplaces
  → Amazon hardening (item 4) reusa template

Item 3 (Catálogo) → fonte de dados para futuras features de comparativo

Item 5 (Tenant/convites) → base de qualquer feature multi-usuário daqui em diante
```

---

## Como usar este documento

- **Novo no projeto?** Leia primeiro `docs/README.md` (arquitetura), depois `docs/roadmap.md` (estado atual + horizonte).
- **Vai implementar um item da tabela "Planejado"?** Abra o plano linkado em `docs/plans/`. Eles têm o detalhamento técnico, critérios de aceite e commits sugeridos.
- **Vai consultar uma entrega?** Abra a spec linkada em `docs/specs/`. Ela é a fonte da verdade do que está no código hoje.
- **Achou algo fora do lugar?** Edite este arquivo e o índice em `docs/README.md` no mesmo PR.

---

## Histórico

| Data       | Commit / evento                                                | Mudança                                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-28 | segunda passada da reorganização de `docs/`                    | `docs/specs/template-mensagem.md` adicionado (Fases 1–4 entregues, Fase 5 E2E pendente). Dívida crítica "bootstrap admin quebrado" identificada (item D). Item "Fundação admin" do roadmap anterior removido por não estar realmente implementado. |
| 2026-07-28 | reorganização de `docs/`                                       | Specs implementadas → `docs/specs/`. Planos não iniciados → `docs/plans/`. Este roadmap reescrito com tabela "Entregue" + tabela "Planejado por impacto". Mesclagem de `docs/planos/` em `docs/plans/` no mesmo dia.                               |
| 2026-07-27 | `8cd4e8a` … `ee0fb6d` (extensão)                               | Fases 0+1 da extensão entregues (service worker, popup simplificado, sync inteligente).                                                                                                                                                            |
| 2026-07-26 | worktree `wt/worker-monitoring-9def26` → main                  | Worker Monitoring entregue (spec `worker-monitoring.md`).                                                                                                                                                                                          |
| 2026-07-25 | `wt/dev-worktree-isolation-20260725` → main (commit `e53285c`) | Dev stack multi-worktree entregue (spec `multi-worktree-dev-stack.md`).                                                                                                                                                                            |
| 2026-07-20 | fundação do monorepo                                           | Auth + cadastro de afiliado entregues (spec `autenticacao-cadastro-afiliado.md`). Arquitetura worker v2 (spec `arquitetura-worker.md`) + E2E (spec `testes-e2e-arquitetura-worker.md`) entregues.                                                  |
