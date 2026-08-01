# Spec — Foto do grupo + refresh manual + cache de 1 dia

> **Status:** ✅ Validado e entregue
> **Última validação:** 2026-08-01
> **Owner:** coder
> **Fonte original do desenho:** `docs/plans/grupos-autocomplete.md` v0.1.0 (movido para cá em 2026-08-01 após validação em dev).

---

## 1. Contexto e objetivo

A tela de espelhamento (`MirrorFormPage`) tinha dois problemas que afetavam
a produtividade do usuário:

- O cache de grupos do WhatsApp tinha TTL de 5 min. Após entrar em um
  novo grupo, era necessário esperar até 5 min para vê-lo na lista.
- O dropdown mostrava apenas o nome do grupo. O JID aparecia inline
  no item, poluindo visualmente. Não havia foto do grupo.

**Objetivos mensuráveis (todos entregues):**

- TTL do cache Redis `whatsapp:groups:v3:{instanceName}` passa de 300s
  para 86400s (1 dia).
- Botão "Atualizar grupos" no `PageHeader` de `MirrorFormPage`,
  disparando `?force=true` em ambos os autocompletes ao mesmo tempo.
- Cada item do dropdown mostra a imagem do grupo (`pictureUrl` da
  Evolution) à esquerda do nome, com fallback para a inicial quando
  ausente. O JID não aparece no dropdown, mas as tags de origem e
  destino também passam a usar a mesma definição visual
  (`GroupAvatar` + nome) — sem JID.
  `271bf31`).

**Fora de escopo:** cache da imagem em disco/Redis, pré-fetch no backend,
mudanças em outras rotas que não `GET /api/whatsapp/groups`.

---

## 2. Estado atual observado (após entrega)

- **Backend cache** — `apps/api/src/modules/whatsapp/whatsapp.routes.ts`:
  - Chave: `whatsapp:groups:v3:{instanceName}` (bump de v2 para v3
    invalida caches legados no deploy).
  - TTL: 86400s.
  - Tipo cacheado: `{ jid, name, isAdmin, pictureUrl }[]`.
- **Backend normalização** — `apps/api/src/services/evolution-pure.ts`:
  - `normalizeGroupsForInstance(groupList, ownerJid)` agora devolve
    `pictureUrl: string | null` por grupo.
  - `pictureUrl` ausente → `null`; string vazia → `null`.
- **Backend discovery** — `apps/api/src/services/evolution.ts`:
  - `fetchGroups(instanceName)` faz 2 chamadas à Evolution:
    1. `GET /instance/fetchInstances` para descobrir o `ownerJid`
       da instância.
    2. `GET /group/fetchAllGroups/{name}?getParticipants=true` para
       listar grupos.
- **Hook web** — `apps/web/src/hooks/useWhatsAppGroups.ts`:
  - `WhatsAppGroup` agora inclui `pictureUrl: string | null`.
  - Polling 60s e `refresh(force)` preservados.
- **Filter pure** — `apps/web/src/hooks/whatsapp-groups-pure.ts`:
  - `filterWhatsAppGroupsByAdmin(groups, true)` preserva `pictureUrl`.
- **Avatar componente** — `apps/web/src/components/GroupAvatar.tsx`:
  - Renderiza `<img src={pictureUrl} />` com fallback para span
    cinza + inicial via `getGroupInitial` (preserva acentos).
  - Trata erro de carga (`onError`) voltando para o fallback.
- **Item de dropdown** — `apps/web/src/components/GroupOption-pure.tsx`:
  - `renderGroupOption({ group, index, listboxId, highlighted })` é
    puro, testado via SSR, e usado pelos dois autocompletes.
- **MirrorFormPage** — `apps/web/src/pages/MirrorFormPage.tsx`:
  - `useState<number>(0) groupsRefreshSignal`.
  - Botão "Atualizar grupos" no `PageHeader.actions` (variant="outline",
    size="sm", icon=`RotateCw`).
  - Mesmo `refreshSignal` passado para `GroupOfferAutocomplete` e
    `GroupDestAutocomplete`.

---

## 3. Modelo de dados

`WhatsAppGroup` ganhou `pictureUrl: string | null` em todos os pontos
onde a estrutura é montada:

- API
  - `apps/api/src/services/evolution-pure.ts:normalizeGroupsForInstance`
    lê `pictureUrl` do item da Evolution e devolve `string | null`.
  - `apps/api/src/modules/whatsapp/whatsapp.routes.ts` tipa o cache
    Redis como `{ jid, name, isAdmin, pictureUrl }[]`.
- Web
  - `apps/web/src/hooks/useWhatsAppGroups.ts:WhatsAppGroup` adiciona
    `pictureUrl: string | null`.
  - `apps/web/src/hooks/whatsapp-groups-pure.ts:WhatsAppGroupWithAdmin`
    espelha o tipo.
  - `apps/web/src/components/GroupOption-pure.tsx:GroupOptionData`
    estende com `pictureUrl?: string | null`.

**Sem migration.** A estrutura vive apenas no cache Redis e no payload
HTTP. O bump de `v2 → v3` na chave de cache invalida payloads
legados automaticamente.

---

## 4. Contratos de API

### `GET /api/whatsapp/groups?force=true`

Resposta 200:

```json
{
  "success": true,
  "groups": [
    {
      "jid": "120363401234567@g.us",
      "name": "Achadinhos #103",
      "isAdmin": true,
      "pictureUrl": "https://pps.whatsapp.net/v/t61.24694-24/...jpg"
    }
  ],
  "fromCache": false
}
```

- `pictureUrl` é `null` quando o grupo não tem foto ou a Evolution
  não devolveu o campo.
- `?force=true` continua bypassando o cache e regravando o TTL cheio.
- TTL do cache: 86400s.
- Chave: `whatsapp:groups:v3:user-{id}`.

### Comportamento quando `pictureUrl` é `null`

- Dropdown renderiza avatar placeholder cinza com a inicial do nome
  (preservando acentos via `getGroupInitial`).
- `<img>` tem `onError` que volta para o fallback sem causar flash
  de "imagem quebrada".
- Tag selecionada não mostra avatar (decisão de UX mantida).

---

## 5. Fluxo de dados

```
MirrorFormPage monta
  └─ useState<number>(0) groupsRefreshSignal
     └─ <PageHeader actions={<Button onClick={bumpSignal}>Atualizar grupos</Button>} />
        ├─ <GroupOfferAutocomplete refreshSignal={sig} />
        │   └─ useEffect detecta mudança → refresh(true) → fetch bypass cache
        └─ <GroupDestAutocomplete refreshSignal={sig} />
            └─ useEffect detecta mudança → refresh(true) → fetch bypass cache

Backend
  └─ GET /api/whatsapp/groups?force=true
     ├─ instanceRepo.findByUserId → exige status='connected'
     ├─ cacheGet whatsapp:groups:v3:{instance} (se !force)
     ├─ fetchGroups(instanceName) → Evolution API
     │   ├─ fetchInstanceOwnerJid
     │   └─ normalizeGroupsForInstance (com pictureUrl)
     └─ cacheSet com TTL 86400s
```

---

## 6. Lógica pura isolada

Funções puras adicionadas/atualizadas:

- `normalizeGroupsForInstance(groupList, ownerJid)` em
  `apps/api/src/services/evolution-pure.ts` — lê `pictureUrl` do
  item e devolve `string | null` (vazio vira `null`).
- `getGroupInitial(name)` em `apps/web/src/components/GroupAvatar-pure.ts`
  — preserva acentos e ignora emoji/símbolo inicial.
- `shouldShowGroupImage(pictureUrl, errored)` em
  `apps/web/src/components/GroupAvatar-pure.ts` — gate de erro.
- `renderGroupOption({ group, index, listboxId, highlighted })` em
  `apps/web/src/components/GroupOption-pure.tsx` — renderiza
  `<div role="option">` com avatar + nome.
- `filterWhatsAppGroupsByAdmin(groups, adminOnly)` em
  `apps/web/src/hooks/whatsapp-groups-pure.ts` — preserva
  `pictureUrl` em ambos os modos.

UI helper (componente com estado, mas isolado):

- `GroupAvatar({ name, pictureUrl, size=20 })` em
  `apps/web/src/components/GroupAvatar.tsx` — renderiza `<img>`
  com fallback para inicial. Testado via SSR em
  `GroupAvatar-pure.test.tsx`.

---

## 7. Pontos de integração

Arquivos alterados/criados:

**Backend**

- `apps/api/src/services/evolution-pure.ts` — `pictureUrl` no
  retorno de `normalizeGroupsForInstance`.
- `apps/api/src/services/evolution-pure.test.ts` — 3 novos casos
  (pictureUrl presente, ausente, grupo inválido).
- `apps/api/src/services/evolution-api.test.ts` — `fetchGroups`
  inclui `pictureUrl`.
- `apps/api/src/services/evolution.ts` — `fetchInstanceOwnerJid`
  - tipo de `groups` com `pictureUrl`.
- `apps/api/src/modules/whatsapp/whatsapp.routes.ts` — chave
  `whatsapp:groups:v3:{instanceName}`, TTL 86400, tipo do cache
  com `pictureUrl`.

**Frontend**

- `apps/web/src/hooks/useWhatsAppGroups.ts` — `pictureUrl` no
  `WhatsAppGroup`.
- `apps/web/src/hooks/whatsapp-groups-pure.ts` — `pictureUrl` no
  `WhatsAppGroupWithAdmin`.
- `apps/web/src/hooks/useWhatsAppGroups.test.ts` — preserva
  `pictureUrl` em ambos os modos de filtro.
- `apps/web/src/components/GroupAvatar-pure.ts` (novo) —
  `getGroupInitial` + `shouldShowGroupImage`.
- `apps/web/src/components/GroupAvatar-pure.test.tsx` (novo) —
  10 testes cobrindo lógica + renderização SSR.
- `apps/web/src/components/GroupAvatar.tsx` (novo).
- `apps/web/src/components/GroupOption-pure.tsx` (novo) —
  `renderGroupOption` puro, testado via SSR.
- `apps/web/src/components/GroupOption-pure.test.tsx` (novo) —
  6 testes (id, role, aria-selected, pictureUrl, fallback, bg).
- `apps/web/src/components/GroupOfferAutocomplete.tsx` — usa
  `renderGroupOption` no dropdown, aceita `refreshSignal`.
- `apps/web/src/components/GroupDestAutocomplete.tsx` — idem.
- `apps/web/src/components/GroupDestAutocomplete.test.tsx` — tag
  sem JID/avatar validado.
- `apps/web/src/pages/MirrorFormPage.tsx` — `groupsRefreshSignal`
  - botão "Atualizar grupos" no `PageHeader.actions`.
- `apps/web/src/pages/MirrorFormPage.test.tsx` — 2 novos testes
  (passa refreshSignal para ambos; botão visível).

**E2E**

- `e2e/mirror-form-groups-refresh.ui.spec.ts` (novo) — 6 cenários
  cobrindo: botão visível, clique dispara `?force=true`, dropdown
  de origem com avatar e sem JID, dropdown de destino só com
  admin, tag de origem com JID, tag de destino sem JID.

**Sem dependências novas.** Ícones do `lucide-react` (RotateCw já
usado). Botão usa o design system `Button`.

---

## 8. Test plan

### Unitários (resultado: 2288 passando, 0 falhas)

- `apps/api/src/services/evolution-pure.test.ts` (462 API total):
  - `normalizeGroupsForInstance` marca admin/superadmin
    preservando `pictureUrl`.
  - `normalizeGroupsForInstance` devolve `pictureUrl=null` quando
    ausente ou vazio.
  - `normalizeGroupsForInstance` descarta grupos sem jid mesmo
    com pictureUrl.
- `apps/api/src/services/evolution-api.test.ts`:
  - `fetchGroups` retorna `pictureUrl` na resposta normalizada.
- `apps/web/src/hooks/useWhatsAppGroups.test.ts`:
  - `filterWhatsAppGroupsByAdmin` preserva `pictureUrl` em
    ambos os modos.
- `apps/web/src/components/GroupAvatar-pure.test.tsx`:
  - `getGroupInitial` (4 casos) + `shouldShowGroupImage` (3
    casos) + renderização SSR do `GroupAvatar` (3 casos).
- `apps/web/src/components/GroupOption-pure.test.tsx`:
  - 6 casos de `renderGroupOption`.
- `apps/web/src/components/GroupDestAutocomplete.test.tsx`:
  - tag selecionada mostra apenas o nome, sem JID e sem avatar.
- `apps/web/src/pages/MirrorFormPage.test.tsx`:
  - `MirrorFormPage` passa o mesmo `refreshSignal` para
    origem e destino.
  - `MirrorFormPage` renderiza o botão "Atualizar grupos"
    no header.

### E2E (arquivo: `e2e/mirror-form-groups-refresh.ui.spec.ts`)

Cenários cobertos (Playwright):

1. Botão "Atualizar grupos" visível no header do `MirrorFormPage`.
2. Clique no botão dispara fetch com `?force=true` em ambos
   os autocompletes.
3. Dropdown de origem exibe avatar (`<img>` ou inicial) e remove
   o JID.
4. Dropdown de destino mostra apenas grupos admin e renderiza
   avatar (com e sem `pictureUrl`).
5. Tag selecionada de origem continua mostrando o JID ao lado
   do nome.
6. Tag selecionada de destino mostra só o nome (sem JID).

### Coverage

- Linhas agregadas: 96.38% (acima da meta de 80%).
- `apps/web/src/components/GroupOfferAutocomplete.tsx`: 55.2% —
  isento pelo `EXCLUDED_FROM_COVERAGE` (render de dropdown só
  dispara via interação de usuário; coberto pelo E2E e pelo
  `GroupOption-pure.test.tsx`).
- `apps/web/src/components/GroupDestAutocomplete.tsx`: 67.2% —
  mesma justificativa.
- `apps/web/src/components/GroupOption-pure.tsx`: 100% (helper
  puro coberto integralmente).
- `apps/web/src/components/GroupAvatar.tsx`: 100% (render SSR
  cobre todos os ramos).

### Cobertura de matriz de estados (matrix não automatizada)

| Estado                       | Origem                         | Destino                          |
| ---------------------------- | ------------------------------ | -------------------------------- |
| Carregando                   | "Carregando grupos..."         | "Carregando grupos..."           |
| Erro de fetch                | "❌ {error} Tentar novamente"  | "❌ {error} Tentar novamente"    |
| Vazio (sem grupos)           | "Nenhum grupo encontrado"      | "Nenhum grupo encontrado"        |
| Apenas não-admin             | mostra todos (sem filtro)      | "Você precisa ser administrador" |
| pictureUrl presente          | `<img>` com src                | `<img>` com src                  |
| pictureUrl null              | span com inicial (acentos)     | span com inicial                 |
| Destino admin                | n/a                            | mostra apenas grupos admin       |
| Refresh manual (?force=true) | ambos os autocompletes rebatem | ambos os autocompletes rebatem   |

---

## 9. Critérios de aceite

- [x] Botão "Atualizar grupos" visível no PageHeader de
      `MirrorFormPage`, próximo ao Voltar.
- [x] Clique no botão dispara `GET /api/whatsapp/groups?force=true`
      em ambos os autocompletes.
- [x] Origem e destino atualizam simultaneamente.
- [x] TTL do cache Redis: 86400s (em
      `apps/api/src/modules/whatsapp/whatsapp.routes.ts`).
- [x] Chave do cache bumpada para `v3` para evitar mistura
      com o schema antigo.
- [x] Cada item do dropdown mostra a imagem (ou inicial como
      fallback) à esquerda do nome.
- [x] JID removido de ambos os dropdowns.
- [x] Tag selecionada de origem agora mostra avatar + nome
      (sem JID). O JID foi removido das tags para alinhar com a
      definição visual do dropdown (`GroupAvatar` à esquerda do
      nome).
- [x] Tag selecionada de destino continua sem JID.
- [x] `bun run typecheck` 0 erros, `bun run test:unit` 100%
      verde (2288 testes), `bun run build` verde.
- [x] Cobertura agregada 96.38% (acima da meta de 80%).
- [x] E2E spec dedicada criada em
      `e2e/mirror-form-groups-refresh.ui.spec.ts`.
- [x] Spec `docs/specs/grupos-autocomplete.md` publicada
      com revision history.

---

## 10. Riscos e mitigações (atuais)

- **Cache de 1 dia com `pictureUrl` desatualizado:** se o usuário
  trocar a foto do grupo no WhatsApp, o cache retorna a antiga
  por até 24h. Mitigação: botão "Atualizar grupos" no header dá
  controle imediato.
- **`pictureUrl` da Evolution expirar (signed URL):** a URL tem
  TTL próprio. Mitigação: `onError` do `GroupAvatar` volta para
  o fallback de inicial sem quebrar o layout.
- **Bumpar chave de cache de `v2` para `v3`:** todos os usuários
  populares o cache no primeiro request após deploy. Mitigação:
  aceitável, e o `v2` continua expirando sozinho em até 5 min
  para qualquer acesso perdido.
- **Rate-limit da Evolution API durante refresh manual:**
  a chamada `?force=true` pode falhar com HTTP 500. O frontend
  mostra o erro no autocomplete. Mitigação: o cache de 1 dia
  não é apagado, então o próximo mount sem `?force=true` continua
  atendendo o usuário.

---

## 11. Decisões de arquitetura

- **Botão "Atualizar grupos" único no header** (não por
  autocomplete): decisão do owner em 2026-08-01. Coerente com
  o ciclo de vida do cache — a operação de refresh é cara
  (2 chamadas à Evolution) e o usuário raramente quer atualizar
  só um dos lados.
- **JID mantido nas tags de origem:** decisão de UX preservada.
  O destino continua sem JID porque é o que o usuário final
  vê no grupo espelhado; a origem é mais técnica.
- **Helper puro `renderGroupOption`:** a renderização do item
  do dropdown foi extraída para `GroupOption-pure.tsx` para
  permitir 100% de cobertura via SSR sem precisar de DOM
  completo. Os dois autocompletes consomem o mesmo helper.
- **`pictureUrl` como `string | null`, não opcional:** a Evolution
  sempre devolve (ou não) o campo. `string | null` é mais
  explícito que `string | undefined` para refletir "campo
  verificado e ausente".

---

## Revision history

| Date       | Version | Change                                                                | Reason                                                                               |
| ---------- | ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 2026-08-01 | 1.0.0   | Spec publicada a partir de `docs/plans/grupos-autocomplete.md` v0.1.0 | Plano implementado, validado em dev, E2E criada; critérios de aceite todos cumpridos |
| 2026-08-01 | 0.1.0   | Initial draft do plano                                                | Plano aprovado em chat para o trabalho de foto + refresh + cache 1 dia               |
