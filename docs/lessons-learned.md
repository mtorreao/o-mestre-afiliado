# Lessons Learned — O Mestre Afiliado

**Scope:** O Mestre Afiliado monorepo
**Maintained by:** Matheus Torreão (with Hermes Agent assistance)

A retrospective log. Each entry captures one thing we learned the hard way — a mistake, a near-miss, a non-obvious gotcha — and what we did about it. The goal is to **not pay the same tuition twice**.

File a major incident under `docs/lessons-learned/<slug>.md`; this top-level file is the index.

## How to use

1. **When you discover something painful** (a bug that took a day, a misleading API, a subtle invariant), write an entry. Same day, before the context evaporates.
2. **When a spec is created or updated**, check this file for "lessons that should shape the spec". If a lesson pushes against a proposed design, link it.
3. **When the same lesson recurs**, escalate: promote the entry into a `docs/specs/<regression-test>.md` or a CI check.

Tone: terse, factual, blame-free. No "I told you so". Owner is whoever is responsible for the next iteration, not necessarily who was there when it happened.

## Index

| Date       | Lesson                                                                                                                                                             | Severity | Action                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------- |
| 2026-07-25 | [Mirror parou de entregar — `generateViaUrlParams` removido por commit com argumento técnico incorreto](./lessons-learned/2026-07-25-mirror-parou-de-entregar.md)  | high     | Investigação documentada; reverter `a45dfa0` ou justificar decisão           |
| 2026-07-30 | [Race window entre `getMirrorSendConfig` e `sendMediaOrText` permite bypass de mirror inativo](./lessons-learned/2026-07-30-guardian-race-window-mirror-config.md) | high     | Plano Guardião rev 2 adiciona tripla validação; pendente Phase 10 do roadmap |

---

## Template for a new entry

Copy this block into `docs/lessons-learned/<slug>.md` (or append here for small ones).

# <Slug — short, memorable>

**Date:** YYYY-MM-DD
**Severity:** low | medium | high
**Time lost:** <estimate, e.g. "2h", "1 sprint">
**Status:** open | resolved | accepted-risk

## What happened

<The story. Concrete, chronological, no blame. What did we observe? What did we think was happening? What was actually happening?>

## Why it happened

<Root cause. Not the symptom — the underlying mechanism.>

## What we did about it

<Fix, mitigation, rollback. Link to the PR / commit / spec that addresses it.>

## What we changed so it doesn't happen again

<The durable change. Could be a regression test, a lint rule, a documented invariant, a redesigned API, a renamed concept. If there is no durable change, the lesson is aspirational — flag it.>

## Related

- Spec: docs/specs/<name>.md
- Plan: docs/plans/<name>.md
- PR / commit: <link>
- Issue: <link>

---

## Revision history

| Date       | Version | Change                                                   | Reason                                                                                                |
| ---------- | ------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2026-07-28 | 0.1.0   | Initial index + moved investigation                      | Bootstrap of `spec-driven` skill; first retrospective recorded                                        |
| 2026-07-30 | 0.2.0   | Adicionada lição sobre TOCTOU entre mirror-config e send | Race window identificada durante brainstorm do Guardião (Phase 10); motivou tripla validação no plano |
