# Race window entre `getMirrorSendConfig` e `sendMediaOrText` permite bypass de mirror inativo

**Date:** 2026-07-30
**Severity:** high (security/economic — comissão cruzada silenciosa)
**Time lost:** ~1h (brainstorm + spec) + ongoing risk window from 2026-07-24 until Guardião lands
**Status:** open — mitigation pending (Phase 10 do roadmap)
**Escopo:** Por que o guardião precisa re-validar `mirror.status` e `mirror.targetGroupJid` **imediatamente antes** de chamar a Evolution API, em vez de confiar no snapshot que `getMirrorSendConfig` retorna.

---

## What happened

Ao discutir a arquitetura do guardião (`docs/plans/guardian-afiliado.md`), Matheus exigiu que o auditor:

> "tem que validar que aquele link convertido é do afiliado e que o grupo de destino também é o configurado no espelhamento e que o espelhamento esteja ativo"

A primeira versão do plano (rev 1) cobria apenas **link** (extração de `melitat`/`matt_word`/`tag` da URL vs credenciais ativas do `affiliateId`). O usuário identificou que essa camada era **insuficiente** — explicitou a tripla validação: link + targetGroup + mirror ativo.

A análise subsequente revelou que o `mirror-config.ts` (responsável atual por resolver a config no dispatcher) já valida `status === 'inactive' → null` (linha 42) e expõe `targetGroupJid` do primeiro elemento de `targetGroups` (linha 60). Esses checks **parecem** cobrir os requisitos do usuário — mas a checagem acontece **antes** do envio HTTP, criando uma janela de race.

**Janela de race real:** entre `getMirrorSendConfig()` retornar e `sendMediaOrText()` fazer a chamada HTTP à Evolution API, ~50-200ms no caminho normal (query ao PG + parsing + montagem do payload). Se um admin (ou qualquer outro ator que tenha permissão de escrita em `mirrors`) desativa o mirror ou troca `targetGroups` **dentro** dessa janela, o SendEvent já passou pelo `mirror-config` como válido e vai sair com:

- **`status: 'inactive'`** — admin tentou parar o espelhamento, mas uma última mensagem escapou.
- **`targetGroupJid` antigo** — admin migrou o espelhamento para um novo grupo de destino, mas a oferta atual cai no grupo antigo (que pode ter sido deletado do WhatsApp ou trocado de dono).

Em nenhum dos dois casos há erro na chamada — a Evolution API aceita e envia. O problema só é perceptível depois, pela comissão marcada no grupo errado.

---

## Why it happened

O pipeline foi desenhado assumindo que **uma leitura por SendEvent é suficiente**. Cada camada confia na anterior:

1. Webhook valida source group, publica no PubSub.
2. Ingestor resolve afiliado, converte link, publica SendEvent na Queue B.
3. Dispatcher pega SendEvent, **lê mirror config uma vez** (`getMirrorSendConfig`), envia via Evolution API.

Esse modelo "read-once-then-act" é elegante (1 SELECT por SendEvent) e cobre 99.9% dos cenários. Mas quebra em qualquer cenário onde o **estado do banco muda durante o voo** do SendEvent:

- Admin desativa espelhamento (race natural entre fetch e send).
- Admin edita targetGroups (mesma race).
- Admin troca dono do espelhamento entre usuários (vetor #1 do plano original — fallback via `.env`).

Esses três cenários não foram tratados pelas 3 camadas existentes (`link-verifier.ts`, dedup atômico, `reflected_offers` log) porque **todas assumem que o `convertedUrl` é estável** desde a publicação na Queue B. Nenhuma re-valida o estado do mirror **no momento do envio**.

Adicionalmente, o `link-verifier.ts` no ingestor (`apps/ingestor/src/link-verifier.ts:53-58`) é **fail-open em erro de DB** — outage do banco deixa passar qualquer link. O guardião é a oportunidade de reverter isso **no dispatcher** com lógica independente (consulta fresca, sem herdar fail-open).

---

## What we did about it

1. **Plano atualizado para rev 2** (`docs/plans/guardian-afiliado.md` versão 0.2.0) — adicionada tripla validação just-before-send:
   - Mirror continua ativo (`status !== 'inactive'`).
   - `targetGroupJid` do SendEvent == `targetGroupJid` atual do mirror.
   - Link convertido bate com credenciais ativas do `affiliateId` do mirror.
2. **Vetores 6, 7, 8 adicionados** ao plano — esses cenários não existiam na rev 1.
3. **Cenários E2E G2a, G2b, G6, G7** adicionados — cobrem as três novas falhas e a UX dual.
4. **UX dual** definida — usuário comum vê `failureReason: "guardian_blocked"` (genérico); super admin vê qual das 3 validações reprovou. Princípio: não revelar a existência do guardião para o usuário comum (vetor de ataque: usuário poderia tentar bypass se souber que existe).

**Pendente (Phase 10 do roadmap):**

- Implementação do `runGuardianChecks` em `packages/affiliate-guardian/src/dispatcher-checks.ts`.
- Hook no `apps/dispatcher/src/dispatcher.ts:150` (just-before-send).
- Tabela `affiliate_audit_log` (migration nova).
- Endpoint `/api/admin/affiliate-audit` + gate admin (depende de Phase 1 — admin bootstrap).
- Painel Guardião em `apps/web/src/pages/WorkerStatusPage.tsx`.

**Risco residual até o guardião estar ativo:** qualquer admin pode, intencionalmente ou não, causar comissão cruzada via edição de `targetGroups` ou desativação/reativação rápida do espelhamento. Não há defesa hoje além de "admin bem-intencionado".

---

## What we changed so it doesn't happen again

- **Regra nova (a ser adicionada a `docs/lessons-learned` quando virar issue):** qualquer camada de validação no pipeline que dependa de estado mutável (status, target group, dono) **deve re-validar imediatamente antes da ação externa** (chamada HTTP à Evolution API, INSERT em tabela, etc.), não só no início do handler. Read-once-then-act é vulnerável a TOCTOU; read-twice-then-act fecha a janela.
- **Check explícito na review de PRs:** quando um novo fluxo do pipeline tocar `getMirrorSendConfig` ou similar, revisar se há janela entre o read e a ação. Se sim, mover a re-validação para immediately-before-action ou documentar a janela como aceitável (com justificativa).
- **Lembrete ao skill `omestre-mirror-safety`:** §1 ("regras de segurança") não cobre a fase **read-twice-then-act** — adicionar §1.15 sobre re-validação de estado mutável pre-ação externa quando o Guardião for implementado.
- **PR / commit:** pendente — linkar quando Phase 10 do roadmap for entregue.
- **Issue:** criar issue "TOCTOU no pipeline de espelhamento" rastreando os 3 vetores como dívida crítica até Phase 10 fechar.

---

## Related

- `docs/plans/guardian-afiliado.md` rev 2 (este commit).
- `docs/roadmap.md` Phase 10 — Guardião do Afiliado.
- `apps/dispatcher/src/mirror-config.ts:42` — `status === 'inactive' → null` (validação atual, insuficiente).
- `apps/dispatcher/src/dispatcher.ts:85-97` — onde `getMirrorSendConfig` é chamado (read-once).
- `apps/dispatcher/src/dispatcher.ts:150` — onde `sendMediaOrText` é chamado (ponto de hook do guardião).
- `apps/ingestor/src/link-verifier.ts:53-58` — fail-open em erro de DB (padrão que o guardião inverte no dispatcher).
- AGENTS.md §Pitfalls #9 — fallback `convertUrl()` lendo `.env` (vetor #1 do plano).

---

## Revision history

| Date       | Version | Change                                                 | Reason                                              |
| ---------- | ------- | ------------------------------------------------------ | --------------------------------------------------- |
| 2026-07-30 | 0.1.0   | Lição inicial sobre TOCTOU entre mirror-config e envio | Identificado durante brainstorm do Guardião (rev 2) |
