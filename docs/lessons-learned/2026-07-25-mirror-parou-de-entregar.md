# Investigação: Mirror parou de entregar ofertas — 2026-07-25

> **Status:** open. Root cause identified; corrective action pending decision.

**Autor:** Hermes Agent (sessão com Matheus Torreão, mtorreao1@gmail.com)
**Data:** 2026-07-25
**Severity:** high
**Time lost:** ~6h (diagnostic) + ongoing blocked mirror since 2026-07-24 19:35
**Status:** open — decisão de reverter `a45dfa0` ou justificar pendente com o usuário
**Escopo:** Por que o espelhamento do mirror `id=1` (user_id=1, `Teste 321` → grupos `Promozone #156` + `Achadinhos Mari Parente 🛒🛍️🤑`) parou de entregar mensagens no grupo destino.
**Método:** Diagnóstico read-only (logs Docker, Redis, Postgres, testes isolados com credenciais reais do user). Nenhuma correção foi aplicada — todas as decisões ficam pendentes com o usuário.

## What we learned

- `URLSearchParams.set()` **substitui** valores, não concatena. Argumento técnico do commit `a45dfa0` ("dois matt_word conflitantes") estava incorreto — testado e confirmado.
- O endpoint interno do ML (`/affiliate-program/api/v2/affiliates/createLink`) **não está documentado**; hoje rejeita tudo (`URL not allowed in affiliates program`) mesmo para URLs canônicas. Pode ter mudado ou os cookies perderam escopo do Link Builder.
- `resolveRedirectUrl()` em `apps/ingestor/src/resolve-redirect.ts` **não usa a API interna do Promozone** (`link-shortener-501307668672.southamerica-east1.run.app/resolve/{code}`). Como `go.promozone.ai` é SPA/JS redirect, o resolver atual retorna a própria URL do redirector — bug latente para fontes do Promozone.

## Why it happened

O commit `a45dfa0` removeu `generateViaUrlParams` como fallback em `convertMlForAffiliate` depois da skill `omestre-mirror-safety` §1.9a. A intenção da skill era correta, mas a remoção do fallback foi além do que o problema original exigia — uma interpretação equivocada da regra.

## What we changed so it doesn't happen again

- Investigação documentada como lição.
- Lembrete explícito ao skill `omestre-mirror-safety`: **não remover fallback** sem E2E verde que prove a causa-raiz; argumentação técnica deve ser validada com teste isolado antes do commit.
- (proposto) Spec ou regression test que cubra o fallback `URLSearchParams.set` vs `append` para matt_word.

## Related

- Spec: `docs/specs/arquitetura-worker.md`
- Plan: `docs/plans/melhorias-ml.md` (itens relacionados a fallback ML)
- Commit: `a45dfa0` (2026-07-24, Matheus)
- Skills envolvidas: `omestre-mirror-safety` §1.9a/§1.9b, `omestre-mirror-diagnostics` §1/§6/§8/§13/§15

---

## TL;DR

- **Webhook → Ingestor:** funcionando (1017 mensagens processadas).
- **Ingestor → SendEvent (Queue B):** **0** SendEvents criados nas últimas horas.
- **Bloqueios por marketplace (6h):** Amazon 639 blocked, ML 274 blocked, Shopee 31 blocked, unknown 49 blocked.
- **Histórico que funcionou:** 2026-07-24 entre ~15h e ~19h35 foram enviadas **194 ML + 190 Shopee = 384 mensagens com sucesso**. O padrão dessas URLs convertidas é exatamente o que hoje é bloqueado.
- **Causa:** commit `a45dfa0` (24/07 16:41, Matheus) removeu `generateViaUrlParams` como fallback em `convertMlForAffiliate` depois da skill `omestre-mirror-safety` §1.9a. O argumento técnico do commit ("dois matt_word conflitantes") está incorreto — `URLSearchParams.set()` SUBSTITUI, não adiciona. Confirmado com teste isolado.
- **Link Builder do ML:** rejeita TUDO hoje (`URL not allowed in affiliates program`), incluindo URLs canônicas de produto. Provável: cookies parcialmente válidos (autenticam mas perderam escopo do Link Builder), ou API do ML mudou.
- **Conversor Shopee:** aceita TUDO via GraphQL Affiliate API, mas ~80% dos shortlinks convertidos resolvem pra `/opaanlp/...` ou `/user/voucher-wallet` (não-produto). Só 1 dos 5 shortlinks testados resolveu pra produto real (`Ventilador De Teto LED E27`).
- **Bug latente:** `resolveRedirectUrl()` em `apps/ingestor/src/resolve-redirect.ts` não usa a API interna do Promozone (`link-shortener-501307668672.southamerica-east1.run.app/resolve/{code}`). Como `go.promozone.ai` é SPA/JS redirect, não segue via HTTP 30x, e o resolver atual retorna a própria URL do redirector. Resultado: mensagens do Promozone caem em `meli.la` ou `s.shopee.com.br` quando processadas downstream.

---

## 1. Estado do ambiente verificado

### 1.1 Containers Docker (docker-compose.dev.yml)

| Container                | Status           | Porta |
| ------------------------ | ---------------- | ----- |
| `omestre_dev_api`        | Up 12h (healthy) | 5452  |
| `omestre_dev_ingestor`   | Up 11h           | 9092  |
| `omestre_dev_dispatcher` | Up 12h           | 9093  |
| `omestre_dev_evolution`  | Up 19h           | 5454  |
| `omestre_dev_postgres`   | Up 19h (healthy) | 5453  |
| `omestre_dev_redis`      | Up 19h (healthy) | 5455  |
| `omestre_dev_tunnel`     | Up 46h           | —     |
| `omestre_dev_web`        | Up 12h           | 5451  |

### 1.2 Health checks

```
curl http://localhost:5452/health  → 200 {"status":"ok"}
curl http://localhost:5451/        → 200 HTML
curl http://localhost:9092/status  → 401 Unauthorized (rota protegida — esperado)
curl http://localhost:9093/status  → 401 Unauthorized (rota protegida — esperado)
```

### 1.3 Filas Redis Streams

```
XLEN omestre:mirror:raw   = 1017
XLEN omestre:mirror:send  = 526
XPENDING omestre:mirror:send mirror-send = 0
XINFO GROUPS omestre:mirror:raw  → consumers=1, pending=1, lag=0
XINFO GROUPS omestre:mirror:send → consumers=4, pending=0, lag=0
```

PEL zerado em ambas as filas — sem trap órfão do §15a.1.

### 1.4 Cache Redis source-group

```
KEYS mirror:source-group:* →
  mirror:source-group:120363173228903067@g.us
  mirror:source-group:120363416262366934@g.us

GET mirror:source-group:120363416262366934@g.us →
  [{"affiliateId":1,"mirrorId":1,"instanceName":"user-1","targetGroupJid":"120363419074538010@g.us","targetGroupName":"Teste 321","messageTemplate":null,"subRateMaxMsgs":5,"subRateWindowSec":300}]

GET mirror:source-group:120363173228903067@g.us →
  [{"affiliateId":1,"mirrorId":1,"instanceName":"user-1","targetGroupJid":"120363419074538010@g.us","targetGroupName":"Teste 321","messageTemplate":null,"subRateMaxMsgs":5,"subRateWindowSec":300}]
```

**Cache limpo** — 1 config por sourceGroup, sem poluição do §13.

---

## 2. Configuração da conta (user_id=1, mtorreao1@gmail.com)

### 2.1 Login via API

```bash
POST /api/auth/login
{"email":"mtorreao1@gmail.com","password":"Asdf1234"}

→ {"success":true,"token":"eyJhbG...","user":{"id":1,"email":"mtorreao1@gmail.com","name":"Matheus"}}
```

(O token expira entre chamadas — observado que não é cache de sessão.)

### 2.2 Mirror ativo

```sql
SELECT id, user_id, name, status, source_groups, target_groups,
       sub_rate_limit_max_msgs, sub_rate_limit_window_sec
FROM omestre.mirrors WHERE user_id = 1;
```

```
id | user_id | name                  | status | source_groups                                                                                       | target_groups                                       | sub_rate
 1 |       1 | Espelhamento Padrão   | active | [Promozone #156, Achadinhos Mari Parente 🛒🛍️🤑]                                                   | [Teste 321]                                          | 5/300s
```

### 2.3 Credenciais do afiliado

```sql
SELECT * FROM omestre.affiliates WHERE evolution_instance_id = 'user-1';
-- id=1, name='Affiliate user-1', evolution_instance_id='user-1', active=true

SELECT user_id, shopee_app_id, length(shopee_app_secret) AS secret_len
FROM omestre.user_credentials WHERE user_id = 1;
-- shopee_app_id=18339760660, secret_len=32

SELECT id, user_id, ml_user_id, nickname, length(session_cookies) AS cookies_len,
       length(refresh_token), length(access_token), melitat, meliid
FROM omestre.ml_affiliates WHERE user_id = 1;
-- id=1, ml_user_id='test_encrypt_user', nickname='TestUser',
-- session_cookies_len=6264 (criptografado), refresh_len=18, access_len=17,
-- melitat='mtorreao', meliid=''

SELECT id, user_id, nickname, tracking_ids FROM omestre.amazon_affiliates;
-- 2 registros: user_id=9 e user_id=12 com [{"tag":"meusite-20",...}]
-- User 1 SEM registro de Amazon (esperado pelo usuário)
```

### 2.4 Histórico do mirror

```sql
SELECT status, COUNT(*) FROM omestre.reflected_offers WHERE affiliate_id = 1 GROUP BY status;
-- blocked: 993, sent: 384, failed: 15

SELECT marketplace, status, COUNT(*)
FROM omestre.reflected_offers WHERE affiliate_id = 1
GROUP BY marketplace, status;
-- shopee      | sent    | 190
-- shopee      | failed  |   8
-- shopee      | blocked |  31
-- mercadolivre| sent    | 194
-- mercadolivre| failed  |   7
-- mercadolivre| blocked | 274
-- amazon      | blocked | 639
-- unknown     | blocked |  49
```

### 2.5 Distribuição temporal dos envios

Janela de **envios com sucesso**:

```
2026-07-23 02h–25 00h (somente shopee, raros)
2026-07-24 15h00–19h35 (pico: 194 ML + 190 Shopee)
2026-07-24 19h35–25 00h (somente shopee, raros)
2026-07-25 13h+ (zero)
```

**Mensagens ML com sucesso: TODAS no intervalo 2026-07-24 15h–19h35.** Exatamente a janela entre o commit `9a6f82e` (resolver meli.la, 16:19) e o commit `a45dfa0` (remover fallback URL params, 16:41 — surpreendentemente dentro da janela de sucesso, ver §6).

---

## 3. Análise do conteúdo que está chegando (texto bruto)

Mensagens reais do `XREVRANGE omestre:mirror:raw + - COUNT 5`:

```json
{
  "messageId": "3EB0CEBFE4E9BD00441857319E7DEF4F741BB871",
  "instanceName": "user-1",
  "sourceGroupJid": "120363173228903067@g.us",
  "sourceGroupName": "",
  "text": "DIGA ADEUS AO CALOR COM TOTAL PRATICIDADE\n\n✅ Ventilador de Teto LED E27\n\n🔥 DE ~80,63~ | POR *49,99*\n\n🔗 https://go.promozone.ai/shopee/wGxPXd",
  "timestamp": 1784988661
}

{
  "messageId": "3EB0FC116EE26D281378E0",
  "instanceName": "user-1",
  "sourceGroupJid": "120363416262366934@g.us",
  "sourceGroupName": "",
  "text": "*CASUAL DA MORMAII NAO TEM ERRO*‼️\n\n✅ Tênis Mormaii Urban Free Skate\n\n*💰R$ 100,00* no Pix‼️🔥🔥🔥\n\n🎟️ Use o cupom: *MODACOMVC*\n\n🛒 https://meli.la/1tdi5B5\n\n(Anúncio)",
  "timestamp": 1784988656
}

{
  "messageId": "3EB0E909B9E66D44E2CE1F3CFA2B3637063EB246",
  "instanceName": "user-1",
  "sourceGroupJid": "120363173228903067@g.us",
  "sourceGroupName": "",
  "text": "ESPAÇO DE SOBRA PRA RENOVAR O QUARTO\n\n✅ Guarda-roupa Casal Easy Slim\n\n🔥 DE ~1.399,90~ | POR *989,91*\n\n🎟️ CUPOM: *MELIPRACASA*\n\n🔗   https://go.promozone.ai/mercadolivre/wvbdwW",
  "timestamp": 1784988408
}

{
  "messageId": "3EB0C81E802253BB27558A1B7F1703753F016A93",
  "instanceName": "user-1",
  "sourceGroupJid": "120363173228903067@g.us",
  "sourceGroupName": "",
  "text": "RESOLVA QUALQUER REPARO SEM PAGAR UM ABSURDO\n\n✅ Parafusadeira Furadeira Simake Com Maleta\n\n🔥 DE ~299,00~ | POR *98,79*\n\n🎟️ CUPOM: *QUEROMAIS*\n\n🔗  https://go.promozone.ai/mercadolivre/CDB9Tj",
  "timestamp": 1784988351
}

{
  "messageId": "3EB01DCB2E2903B8966737",
  "instanceName": "user-1",
  "sourceGroupJid": "120363416262366934@g.us",
  "sourceGroupName": "",
  "text": "Fritadeira e Forno Elétrico Style Oven Fry 3 em 1 Elgin - 10 Litros, 220V\n\n🚨 *BAIXOU* 🚨\n\n*R$ 218,01* 🔥\nUsem o cupom: *CUPOM10*\n \nhttps://www.amazon.com.br/dp/B0DTW3GDS4?tag=achadin0c048b-20\n#anuncio",
  "timestamp": 1784988264
}
```

**Padrões identificados:**

1. **Cupons em texto livre, não em link** — `"Use o cupom: MODACOMVC"`, `"CUPOM: MELIPRACASA"` são strings, não URLs. Não há múltiplos links de cupom no mesmo texto.
2. **Links únicos na maioria das mensagens** — `go.promozone.ai/*`, `meli.la/*`, ou Amazon direto.
3. **Amazon com `?tag=achadin0c048b-20`** — tag de outro afiliado (`achadin0c048b`), sem tracking seu.
4. **Promozone como redirector de shortlinks** — todos os links `go.promozone.ai` redirecionam para `s.shopee.com.br` ou `meli.la`.

---

## 4. Cadeia de redirecionamento completa (resolvida manualmente)

### 4.1 Promozone → Shopee

```
Input:  https://go.promozone.ai/shopee/wGxPXd
        (HTTP 200, página HTML+JS, não segue via redirect HTTP)
        ↓ (não seguido pelo `fetch redirect:'follow'`)
        ↓ (segue via API interna do Promozone — documentada em omestre-mirror-safety §"Resolução de redirectors JS")
API:    GET https://link-shortener-501307668672.southamerica-east1.run.app/resolve/wGxPXd
        → 200 {"destinationUrl":"https://s.shopee.com.br/2g9nwk9ce1"}
        ↓ (resolveRedirectUrl testa agora — HEAD com redirect:manual)
HEAD:   https://s.shopee.com.br/2g9nwk9ce1
        → ???
```

**O ingestor NÃO está usando a API interna do Promozone.** `resolveRedirectUrl()` em `apps/ingestor/src/resolve-redirect.ts` testa apenas o redirect HTTP padrão, que não funciona pra SPAs.

### 4.2 Promozone → ML → Social de outro afiliado

```
Input:  https://go.promozone.ai/mercadolivre/wvbdwW
API:    GET https://link-shortener-501307668672.southamerica-east1.run.app/resolve/wvbdwW
        → 200 {"destinationUrl":"https://meli.la/1sUWziY"}
HEAD:   https://meli.la/1sUWziY
        → 301 Location: https://www.mercadolivre.com.br/social/promozonevip?matt_word=promozonewpp&matt_tool=21926883&forceInApp=true&ref=BFDa...
Follow: → /social/promozonevip?matt_word=promozonewpp&...  (perfil de afiliado)
```

**O `promozonevip` é o perfil do afiliado que originou a lista** (`matt_word=promozonewpp`). Esses `/social/<id>` **não são produtos** — são perfis/listas de outros afiliados compartilhando as próprias listas marcadas com a comissão deles.

### 4.3 meli.la direto

```
Input:  https://meli.la/2A9nWBB
HEAD:   301 → https://www.mercadolivre.com.br/social/om895584?matt_word=om895584&matt_tool=50805475&forceInApp=true&ref=BC7Pi...
Follow: /social/om895584?matt_word=om895584&...  (perfil `om895584`)
```

Mesma estrutura. Todos os `meli.la` testados do grupo `Achadinhos Mari Parente` resolvem para `/social/om895584` ou `/social/promozonevip`.

### 4.4 `s.shopee.com.br` shortlink

```
Input:  https://s.shopee.com.br/2BDXRoRt6J
HEAD:   302 → https://shopee.com.br/user/voucher-wallet?...
```

Resolvem pra `/user/voucher-wallet` (afiliado/cupom), ou `/opaanlp/<shop>/<item>?...` (link genérico de tracking), ou produto real em raros casos.

---

## 5. Testes executados (resultados reais)

### 5.1 Link Builder ML com cookie real do user 1

Script: `apps/ingestor/src/_test-ml.ts` (removido após testes, era só pra investigação).
Ambiente: `ENCRYPTION_KEY=<key do container api>`, `POSTGRES_URL=postgres://evolution:evolution_pass@127.0.0.1:5453/omestre_db`.

```typescript
import { MlAffiliateRepository } from '@omestre/db';
import { generateShortAffiliateLink } from '@omestre/converters';

const repo = new MlAffiliateRepository();
const ml = await repo.findByUserId('test_encrypt_user');
// ml.sessionCookies = 4668 bytes descriptografados
// ml.melitat = 'mtorreao'

const cases = [
  '/social/om895584',
  '/social/promozonevip?matt_word=promozonewpp',
  '/iphone-15-pro/p/MLB2103478231',
  'https://meli.la/2A9nWBB',
];

for (const url of cases) {
  const r = await generateShortAffiliateLink(url, ml.melitat, ml.sessionCookies);
  console.log(url, '→', r);
}
```

**Resultados:**

```
MELITAT: mtorreao, NICKNAME: TestUser, COOKIES_LEN: 4668

=== 1. /social/<outro-afiliado> sem matt_word ===
URL: https://www.mercadolivre.com.br/social/om895584
result: {"success":false,"error":"URL not allowed in affiliates program"}

=== 2. /social/<outro> COM matt_word (URL real do grupo) ===
URL: https://www.mercadolivre.com.br/social/promozonevip?matt_word=promozonewpp
result: {"success":false,"error":"URL not allowed in affiliates program"}

=== 3. URL canônica de produto (teste positivo) ===
URL: https://www.mercadolivre.com.br/iphone-15-pro/p/MLB2103478231
result: {"success":false,"error":"URL not allowed in affiliates program"}

=== 4. meli.la puro ===
URL: https://meli.la/2A9nWBB
result: {"success":false,"error":"URL Invalid."}
```

**Conclusão:** Link Builder rejeita 100% das URLs testadas. Cookies autenticam (passam do CSRF), mas o endpoint `createLink` rejeita o payload.

### 5.2 `generateViaUrlParams` (verificação técnica do argumento de `a45dfa0`)

Script Node:

```js
const u = new URL('https://x.com/social/foo?matt_word=ORIGINAL&matt_tool=999');
u.searchParams.set('matt_word', 'NOVO');
u.searchParams.set('matt_tool', '111');
console.log(u.toString());
// → 'https://x.com/social/foo?matt_word=NOVO&matt_tool=111'
console.log(u.searchParams.getAll('matt_word'));
// → ['NOVO']
```

**Resultado: `URLSearchParams.set()` SUBSTITUI, não adiciona.** Não há dois `matt_word` conflitantes.

A premissa do commit `a45dfa0` (mensagem do commit):

> "O fallback generateViaUrlParams estava enviando para o WhatsApp links como:
> https://www.mercadolivre.com.br/social/om895584?matt_word=om895584
> &matt_tool=50805475&matt_word=mtorreao&matt_tool=71835809"

…**não corresponde ao comportamento real do código** (`packages/converters/src/mercadolivre.ts:240-265`). O `generateViaUrlParams` sempre produziu URLs com um único `matt_word` substituindo o anterior.

### 5.3 Pipeline alternativo (resolve → strip → add)

```js
// 1. Resolve meli.la via redirect
const r = await fetch('https://meli.la/2WLGuW9', {
  redirect: 'follow',
  headers: { 'User-Agent': 'Mozilla/5.0' },
});
const resolved = r.url;
// → 'https://www.mercadolivre.com.br/social/om895584/lists'

// 2. Strip params do afiliado original (como resolveMeliRedirect faz)
const u = new URL(resolved);
const dropped = [];
for (const p of ['matt_word', 'matt_tool', 'ref', 'forceInApp']) {
  if (u.searchParams.has(p)) {
    u.searchParams.delete(p);
    dropped.push(p);
  }
}
// → dropped: []  (essa URL específica não tinha params extras além dos removidos)
// → URL canônica: 'https://www.mercadolivre.com.br/social/om895584/lists'

// 3. Adicionar nosso matt_word (como generateViaUrlParams faria)
u.searchParams.set('matt_word', 'mtorreao');
u.searchParams.set('matt_tool', '71835809');
// → 'https://www.mercadolivre.com.br/social/om895584/lists?matt_word=mtorreao&matt_tool=71835809'
```

**Esse URL é EXATAMENTE o padrão que aparece no histórico de mensagens enviadas com sucesso** (`SELECT original_link, converted_link FROM omestre.reflected_offers WHERE affiliate_id = 1 AND status = 'sent' AND marketplace = 'mercadolivre' ORDER BY reflected_at DESC LIMIT 10`).

### 5.4 Conversor Shopee — GraphQL Affiliate API

Script: `apps/ingestor/src/_test-shopee.ts` (removido após testes).

```typescript
import { UserCredentialsRepository } from '@omestre/db';
import { convertShopeeUrlWithCredentials } from '@omestre/converters';

const creds = await new UserCredentialsRepository().findByUserId(1);
// shopeeAppId='18339760660', shopeeAppSecret (32 chars)

const cases = [
  'https://s.shopee.com.br/2g9nwk9ce1', // veio do Promozone
  'https://s.shopee.com.br/AAFqRD6KKY',
  'https://s.shopee.com.br/W5KuwSyaV',
  'https://s.shopee.com.br/2BDXRoRt6J',
  'https://shopee.com.br/Ventilador-de-Teto-LED-i.12345.67890', // fake
  'https://shopee.com.br/user/voucher-wallet',
];

for (const url of cases) {
  const r = await convertShopeeUrlWithCredentials(url, { appId, secret });
  console.log(url, '→', r);
}
```

**Resultados:**

```
APP_ID: 18339760660, SECRET_LEN: 32

https://s.shopee.com.br/2g9nwk9ce1     → success: true  affiliateUrl: https://s.shopee.com.br/6pzOXOccJp
https://s.shopee.com.br/AAFqRD6KKY     → success: true  affiliateUrl: https://s.shopee.com.br/5LAakdiKMe?lp=aff
https://s.shopee.com.br/W5KuwSyaV      → success: true  affiliateUrl: https://s.shopee.com.br/qiBOMzJyr?lp=aff
https://s.shopee.com.br/2BDXRoRt6J     → success: true  affiliateUrl: https://s.shopee.com.br/8fR2ilYwBJ
shopee.com.br/...-i.12345.67890         → success: true  affiliateUrl: https://s.shopee.com.br/9zwQJDUxfo
shopee.com.br/user/voucher-wallet       → success: true  affiliateUrl: https://s.shopee.com.br/8V7cWSaoF1
```

**Todos os 6 inputs retornaram `success: true`** — o conversor Shopee aceita TUDO via GraphQL Affiliate API.

### 5.5 Onde os shortlinks convertidos da Shopee levam (follow redirect)

```js
const urls = [
  'https://s.shopee.com.br/6pzOXOccJp', // convertido de 2g9nwk9ce1 (Promozone)
  'https://s.shopee.com.br/5LAakdiKMe', // convertido de AAFqRD6KKY
  'https://s.shopee.com.br/qiBOMzJyr', // convertido de W5KuwSyaV
  'https://s.shopee.com.br/8V7cWSaoF1', // convertido de voucher-wallet
  'https://s.shopee.com.br/8fR2ilYwBJ', // convertido de 2BDXRoRt6J
];

for (const u of urls) {
  const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log(u, '→', r.url);
}
```

**Resultados:**

```
6pzOXOccJp → https://shopee.com.br/Ventilador-De-Teto-LED-E27-40W-...-i.1182228888.58259889781?...&mmp_pid=an_18339760660
5LAakdiKMe → https://shopee.com.br/opaanlp/968302991/23198369308?...&mmp_pid=an_18339760660
qiBOMzJyr  → https://shopee.com.br/opaanlp/532455428/58257688023?...&mmp_pid=an_18339760660
8V7cWSaoF1 → https://shopee.com.br/user/voucher-wallet?mmp_pid=an_18339760660
8fR2ilYwBJ → https://shopee.com.br/user/voucher-wallet?mmp_pid=an_18339760660
```

| Convertido | Destino real                                                  | Categoria           |
| ---------- | ------------------------------------------------------------- | ------------------- |
| 6pzOXOccJp | `Ventilador-De-Teto-LED-E27-40W-...-i.1182228888.58259889781` | ✅ PRODUTO REAL     |
| 5LAakdiKMe | `/opaanlp/968302991/23198369308`                              | ❌ landing genérica |
| qiBOMzJyr  | `/opaanlp/532455428/58257688023`                              | ❌ landing genérica |
| 8V7cWSaoF1 | `/user/voucher-wallet`                                        | ❌ cupom/afiliado   |
| 8fR2ilYwBJ | `/user/voucher-wallet`                                        | ❌ cupom/afiliado   |

**Taxa de produto real: 1/5 (20%).** Todos têm `mmp_pid=an_18339760660` (seu app_id), então a atribuição de comissão está correta Shopee-side — mas o link final 80% das vezes não é produto.

---

## 6. Histórico que prova o comportamento anterior (e quando mudou)

### 6.1 Mensagens ML enviadas com sucesso

```sql
SELECT original_link, converted_link
FROM omestre.reflected_offers
WHERE affiliate_id = 1 AND status = 'sent' AND marketplace = 'mercadolivre'
ORDER BY reflected_at DESC LIMIT 10;
```

```
original_link      | converted_link (formato abreviado)
-------------------+------------------------------------------------------------------------
meli.la/161QLxX    | /social/om895584?matt_word=mtorreao&matt_tool=71835809&forceInApp=true&ref=...
meli.la/1PR5Xfx    | /social/om895584?matt_word=mtorreao&matt_tool=71835809&...
meli.la/2gxnFb5    | /social/om895584?matt_word=mtorreao&matt_tool=71835809&...
meli.la/2WLGuW9    | /social/om895584?matt_word=mtorreao&matt_tool=71835809&...
meli.la/2WLGuW9    | /social/om895584/lists?matt_word=mtorreao&matt_tool=71835809
meli.la/1yFm5Jc    | /social/om895584?matt_word=mtorreao&matt_tool=71835809&...
meli.la/1gQQ8TE    | /social/om895584?matt_word=mtorreao&matt_tool=71835809&...
meli.la/1LPdYW2    | /social/om895584?matt_word=mtorreao&matt_tool=71835809&...
```

**Padrão:** `meli.la/XXX` → resolve → `/social/<outro-afiliado>?matt_word=mtorreao&matt_tool=71835809`.

### 6.2 Mensagens Shopee enviadas com sucesso

```sql
SELECT original_link, converted_link
FROM omestre.reflected_offers
WHERE affiliate_id = 1 AND status = 'sent' AND marketplace = 'shopee'
ORDER BY reflected_at DESC LIMIT 10;
```

```
original_link                  | converted_link
-------------------------------+-------------------------------------
https://test.com               | https://test.com
https://test.com               | https://test.com
https://s.shopee.com.br/2BDXRoRt6J | https://s.shopee.com.br/AAFp63psD3
https://s.shopee.com.br/2BDXRoRt6J | https://s.shopee.com.br/AUsfUfoT0k
https://s.shopee.com.br/2BDXRoRt6J | https://s.shopee.com.br/8AUkiNxUGb
https://s.shopee.com.br/9Kgi4RWDqD | https://s.shopee.com.br/1gHGwMTFD5?lp=aff
https://s.shopee.com.br/9Kgi4RWDqD | https://s.shopee.com.br/60QG6KDi7H?lp=aff
https://s.shopee.com.br/9Kgi4RWDqD | https://s.shopee.com.br/1gHGwMTFD5?lp=aff
https://s.shopee.com.br/5q6pu29Xal | https://s.shopee.com.br/1LeQXlZkMC?lp=aff
https://s.shopee.com.br/5q6pu29Xal | https://s.shopee.com.br/2BDXXIWIbd?lp=aff
```

**Padrão:** `s.shopee.com.br/XXX` → Shopee Affiliate API → novo `s.shopee.com.br/YYY?lp=aff` (cada chamada gera shortlink novo).

### 6.3 Janela de mudança

```
2026-07-24 09a6f82e 16:19:49 -0300  fix(ingestor): resolver meli.la antes do Link Builder + revalidator periódico
2026-07-24 592c6e0  16:25:08 -0300  fix(converters): update strategies for Mercado Livre and Shopee, remove cookies support
2026-07-24 a45dfa0  16:41:30 -0300  fix(ingestor): bloquear oferta ML quando Link Builder falha (sem fallback de URL params)

(Mensagens enviadas com sucesso continuaram até 19h35 do mesmo dia)
(Mensagens shopee continuaram sendo enviadas depois)
(Mensagens ML com sucesso pararam após a45dfa0 + efeito de invalidação de cookies)
```

O commit `a45dfa0` é o suspeito principal — ele removeu `generateViaUrlParams` como fallback. O argumento técnico (dois `matt_word` conflitantes) **foi invalidado** pelo teste em §5.2. A skill `omestre-mirror-safety` §1.9a descreve o comportamento correto em alto nível, mas o **código removido não produzia o bug descrito**.

---

## 7. Causa raiz proposta

### 7.1 Bloqueios ML — explicados

O pipeline atual (`apps/ingestor/src/ingestor.ts:convertMlForAffiliate`, após `a45dfa0`):

1. Recebe `https://meli.la/XXX` (ou similar)
2. `resolveMeliRedirect()` segue o redirect → `/social/<outro>`
3. Detecta `isProduct = false` (URL canônica não tem `/p/MLB` nem `/social/<id>/lists/<produto>`)
4. **Bloqueia** com `success: false, error: "meli.la não redireciona para produto"`
5. Nenhum SendEvent criado

**Comparação com o histórico:** Antes do `a45dfa0`, o pipeline tinha fallback que aceitava essas URLs e gerava `/social/<outro>?matt_word=mtorreao&matt_tool=71835809` via `generateViaUrlParams`. Esse padrão foi removido.

### 7.2 Bloqueios Shopee — explicados

O pipeline (`apps/ingestor/src/ingestor.ts:classifyLinkKind`) marca `s.shopee.com.br` como `coupon` (skill §1.9). Depois tenta `resolveRedirectUrl()`:

```typescript
// apps/ingestor/src/ingestor.ts (aproximado, linhas 870-899)
for (const link of couponLinks) {
  if (!/s\.shopee\.com\.br/i.test(link.url)) { ... continue; }
  const resolved = await resolveRedirectUrl(link.url);
  if (resolved && resolved !== link.url) {
    const isProduct = /-i\.\d+\.\d+/i.test(resolved);
    if (isProduct) { promotedShopeeUrl = resolved; }
    else { log('info', 'Shortlink Shopee não resolve para produto — descartado', ...); }
  } else {
    log('info', 'Shortlink Shopee sem redirect ou não resolveu — descartado', ...);
  }
}
```

Os shortlinks observados nos logs recentes (`2BDXRoRt6J`, `AAFqRD6KKY`, etc.) **redirecionam para `/user/voucher-wallet`** ou `/opaanlp/...` — não têm `-i.{shopid}.{itemid}` no path → `isProduct = false` → descartado.

### 7.3 Bug latente: `resolveRedirectUrl` não conhece Promozone

`apps/ingestor/src/resolve-redirect.ts`:

- `resolveRedirectUrl()` testa só `redirect: 'follow'` HTTP padrão
- `go.promozone.ai` é SPA — não redireciona via HTTP 30x, apenas via JS
- Resultado: o resolver recebe a própria URL do Promozone de volta, marca como "não resolveu"
- O classificador marca como `coupon` (regra `if (/go\.promozone\.ai/i.test(url)) return 'coupon';`)
- Mensagens com só Promozone caem em `coupon_only` e são bloqueadas

A solução documentada na skill `omestre-mirror-safety` §"Resolução de redirectors JS (Promozone)" — `link-shortener-501307668672.southamerica-east1.run.app/resolve/{shortCode}` — **não foi implementada em `resolve-redirect.ts`**.

---

## 8. Cenários e suas consequências

| Mensagem recebida                                            | Comportamento atual                             | Esperado pelo usuário                                 |
| ------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| `meli.la/XXX` → `/social/<outro>`                            | ❌ bloqueado (§1.9a)                            | ✅ enviar com `matt_word=mtorreao`                    |
| `s.shopee.com.br/XXX` → `/user/voucher-wallet` ou `/opaanlp` | ❌ bloqueado (§1.9 shopee_shortlink_only)       | ⚠️ enviar (Shopee Affiliate API aceita, comissão sua) |
| `s.shopee.com.br/XXX` → produto real                         | ❌ bloqueado (§1.9) — resolver falha            | ✅ enviar                                             |
| `go.promozone.ai/*`                                          | ❌ bloqueado como `coupon` (§1.6)               | ⚠️ resolver via API interna → tratar como o destino   |
| Amazon `dp/ASIN?tag=achadin0c048b-20`                        | ❌ bloqueado (sem tracking ID Amazon do user 1) | ❌ bloqueado (correto — sem credencial)               |
| Cupom em texto livre (`"Use o cupom: XXX"`)                  | ✅ texto preservado no template                 | ✅ preservado                                         |

---

## 9. Decisões pendentes (nada foi aplicado)

As opções que o usuário (Matheus) precisa decidir antes de qualquer correção:

### A) Reverter o `generateViaUrlParams` no ML

- **Pro:** restaura o comportamento de 2026-07-24 15h–19h35 (194 mensagens enviadas)
- **Pro:** `URLSearchParams.set()` garante que não há conflito de `matt_word` (testado em §5.2)
- **Contra:** gera URLs `/social/<outro>` no grupo destino — UX questionável (página de perfil vs produto)
- **Contra:** comissão precisa ser validada no painel de afiliado ML (não testável sem comprar)
- **Escopo:** `apps/ingestor/src/ingestor.ts:convertMlForAffiliate()` — reintroduzir o fallback entre o Link Builder e o bloqueio final

### B) Investigar por que o Link Builder ML parou

- **Pro:** se cookies estão parcialmente válidos, reimportar via extensão Chrome pode resolver
- **Pro:** testar com `meli.la` direto resolve (precisa do redirect primeiro)
- **Pro:** ou pode ser mudança da API do ML (não tem fix do nosso lado)
- **Escopo:** `extensions/chrome-cookie-importer/` + diagnóstico manual com Playwright abrindo `https://www.mercadolivre.com.br/afiliados/linkbuilder`

### C) Implementar resolução de `go.promozone.ai` via API interna

- **Pro:** destrava ~30% das mensagens (todas as do grupo Promozone #156)
- **Pro:** código documentado em `omestre-mirror-safety`, falta apenas portar pra `resolve-redirect.ts`
- **Escopo:** adicionar `resolvePromozone()` em `apps/ingestor/src/resolve-redirect.ts`

### D) Validar Shopee pós-conversão (follow-up do shortlink)

- **Pro:** filtra os 80% que viram `/opaanlp` ou `/voucher-wallet` após conversão
- **Pro:** mantém os 20% que viram produto real
- **Contra:** adiciona 1 fetch HTTP por mensagem Shopee (~200ms)
- **Escopo:** em `apps/ingestor/src/ingestor.ts` após `convertShopeeUrlWithCredentials`

### E) Aceitar o estado atual e trocar grupo fonte

- **Pro:** simples
- **Contra:** o sistema está bloqueando corretamente o conteúdo que chega; trocar de grupo resolve se houver grupo melhor

---

## 10. Apêndice: comandos e scripts usados durante a investigação

### 10.1 Login + perfil (API)

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"email":"mtorreao1@gmail.com","password":"Asdf1234"}' \
  http://localhost:5452/api/auth/login
# → {"success":true,"token":"eyJhbGciOi...","user":{"id":1,"email":"mtorreao1@gmail.com","name":"Matheus"}}

# Token expira rapidamente entre chamadas — refazer login a cada curl
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5452/api/affiliate/profile
```

### 10.2 Diagnóstico de filas + cache

```bash
docker exec omestre_dev_redis redis-cli XLEN omestre:mirror:raw
docker exec omestre_dev_redis redis-cli XLEN omestre:mirror:send
docker exec omestre_dev_redis redis-cli XPENDING omestre:mirror:send mirror-send
docker exec omestre_dev_redis redis-cli KEYS "mirror:source-group:*"
docker exec omestre_dev_redis redis-cli GET "mirror:source-group:120363416262366934@g.us"

docker exec omestre_dev_redis redis-cli XREVRANGE omestre:mirror:raw + - COUNT 5
```

### 10.3 Diagnóstico de DB

```bash
# Mirror do user 1
docker exec omestre_dev_postgres psql -U evolution -d omestre_db -c "
  SELECT id, user_id, name, status, source_groups, target_groups,
         sub_rate_limit_max_msgs, sub_rate_limit_window_sec
  FROM omestre.mirrors WHERE user_id = 1;"

# Credenciais
docker exec omestre_dev_postgres psql -U evolution -d omestre_db -c "
  SELECT user_id, shopee_app_id, length(shopee_app_secret) AS secret_len
  FROM omestre.user_credentials WHERE user_id = 1;"

docker exec omestre_dev_postgres psql -U evolution -d omestre_db -c "
  SELECT id, user_id, ml_user_id, nickname, length(session_cookies) AS cookies_len,
         length(refresh_token) AS refresh_len, length(access_token) AS access_len,
         melitat, meliid
  FROM omestre.ml_affiliates WHERE user_id = 1;"

# Histórico do mirror
docker exec omestre_dev_postgres psql -U evolution -d omestre_db -c "
  SELECT marketplace, status, COUNT(*)
  FROM omestre.reflected_offers WHERE affiliate_id = 1
  GROUP BY marketplace, status ORDER BY marketplace, status;"

# Mensagens enviadas com sucesso (ML)
docker exec omestre_dev_postgres psql -U evolution -d omestre_db -c "
  SELECT original_link, converted_link
  FROM omestre.reflected_offers
  WHERE affiliate_id = 1 AND status = 'sent' AND marketplace = 'mercadolivre'
  ORDER BY reflected_at DESC LIMIT 10;"
```

### 10.4 Teste do Link Builder ML (script Bun)

Arquivo temporário `apps/ingestor/src/_test-ml.ts` (removido após testes):

```typescript
import { MlAffiliateRepository } from '@omestre/db';
import { generateShortAffiliateLink } from '@omestre/converters';

const repo = new MlAffiliateRepository();
const ml = await repo.findByUserId('test_encrypt_user');
console.log('MELITAT:', ml.melitat, 'COOKIES_LEN:', ml.sessionCookies?.length);

const cases = [
  '/social/om895584',
  '/social/promozonevip?matt_word=promozonewpp',
  '/iphone-15-pro/p/MLB2103478231',
  'https://meli.la/2A9nWBB',
];

for (const url of cases) {
  const r = await generateShortAffiliateLink(url, ml.melitat, ml.sessionCookies);
  console.log(url, '→', r);
}
```

Execução:

```bash
cd apps/ingestor && \
  ENCRYPTION_KEY='7d9168d8b1c8a679734dee9947ef4e7a0592ede2f5221b811b7c411bcc64f7f8' \
  POSTGRES_URL='postgres://evolution:evolution_pass@127.0.0.1:5453/omestre_db' \
  POSTGRES_HOST='127.0.0.1' POSTGRES_PORT='5453' \
  bun run src/_test-ml.ts
```

### 10.5 Teste do conversor Shopee (script Bun)

```typescript
import { UserCredentialsRepository } from '@omestre/db';
import { convertShopeeUrlWithCredentials } from '@omestre/converters';

const creds = await new UserCredentialsRepository().findByUserId(1);

const cases = [
  'https://s.shopee.com.br/2g9nwk9ce1',
  'https://s.shopee.com.br/AAFqRD6KKY',
  'https://s.shopee.com.br/W5KuwSyaV',
  'https://s.shopee.com.br/2BDXRoRt6J',
  'https://shopee.com.br/Ventilador-de-Teto-LED-i.12345.67890',
  'https://shopee.com.br/user/voucher-wallet',
];

for (const url of cases) {
  const r = await convertShopeeUrlWithCredentials(url, {
    appId: creds.shopeeAppId,
    secret: creds.shopeeAppSecret,
  });
  console.log(url, '→', r);
}
```

### 10.6 Verificação de URLSearchParams.set()

```js
const u = new URL('https://x.com/social/foo?matt_word=ORIGINAL&matt_tool=999');
u.searchParams.set('matt_word', 'NOVO');
u.searchParams.set('matt_tool', '111');
console.log(u.toString());
// → 'https://x.com/social/foo?matt_word=NOVO&matt_tool=111'
console.log(u.searchParams.getAll('matt_word'));
// → ['NOVO']
```

### 10.7 Resolução de shortlinks manualmente

```bash
# Resolver meli.la
docker exec omestre_dev_ingestor bun -e "
const r = await fetch('https://meli.la/2A9nWBB', { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
console.log(r.url);"

# Resolver Promozone via API interna
docker exec omestre_dev_ingestor bun -e "
const codes = ['wGxPXd', 'wvbdwW', 'CDB9Tj'];
for (const code of codes) {
  const r = await fetch('https://link-shortener-501307668672.southamerica-east1.run.app/resolve/' + code, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
  });
  console.log(code, '→', r.status, await r.text());
}"
```

### 10.8 Limpeza após investigação

Todos os scripts `_test-*.ts` em `apps/ingestor/src/` foram removidos. Git status antes:

```
modified:   apps/api/package.json
new file:   apps/api/src/services/worker-metrics.ts
modified:   apps/dispatcher/src/index.ts
modified:   apps/ingestor/src/index.ts
new file:   apps/web/src/lib/worker-status.ts
modified:   apps/web/src/pages/WorkerStatusPage.tsx
modified:   docker-compose.dev.yml
modified:   docker-compose.yml
modified:   packages/worker-common/src/index.ts
modified:   packages/worker-common/src/metrics-server.ts

modified:   apps/ingestor/src/ingestor.ts
modified:   apps/ingestor/src/resolve-redirect.ts
deleted:    apps/web/src/components/WorkerStatus.tsx
modified:   apps/web/src/components/ui/Card.tsx
modified:   apps/web/src/pages/WorkerStatusPage.tsx
```

Os arquivos modificados `ingestor.ts`, `resolve-redirect.ts`, `WorkerStatusPage.tsx` e `Card.tsx` são mudanças do `worker-v2` (branch relacionada) ainda não commitadas em `main` — **não foram tocadas nesta investigação**.

---

## 11. Referências cruzadas (skills)

- `omestre-mirror-pipeline` — arquitetura geral do pipeline (webhook → Redis cache + PubSub → ingestor → dispatcher)
- `omestre-mirror-safety` §1.9a, §1.9b — regras sobre `meli.la` resolvendo pra `/social/<outro>` (descreve comportamento desejado, mas a implementação em `a45dfa0` foi além do necessário ao remover o `generateViaUrlParams` fallback)
- `omestre-mirror-diagnostics` §1, §6, §8, §13 — recipes para diagnosticar cada tipo de falha
- `omestre-mirror-diagnostics` §15 — dedup atômico no consumer (Dispatcher OK, já tem `SET NX EX`)
- `omestre-afiliado-overview` — visão geral do monorepo, Docker, comandos


## Revision history

| Date       | Version | Change                                | Reason                                                       |
| ---------- | ------- | ------------------------------------- | ------------------------------------------------------------ |
| 2026-07-28 | 0.2.0   | Adopted lessons-learned template (added Severity, Time lost, Status, "What we learned" / "Why it happened" / "What we changed" / "Related" sections) | Migrated from `docs/investigacoes/` to `docs/lessons-learned/` per spec-driven bootstrap |
| 2026-07-25 | 0.1.0   | Initial investigation                  | Diagnostic session for blocked mirror `id=1`                |
