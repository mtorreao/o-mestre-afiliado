# 📋 Plano de Próximos Passos — Fluxo ML

## 🔴 Crítico

### 1. Renovação automática de cookies
**Problema:** Cookies de sessão expiram (horas/dias) e precisam ser reimportados manualmente.

**Solução:** Ao detectar que o link curto falhou (erro 401/403 → cookies expirados), o backend tenta renovar os cookies fazendo um GET no linkbuilder com os cookies atuais e capturando os novos `set-cookie` headers.

```typescript
// Já existe o mergeCookies() no mercadolivre.ts, mas não é usado pra sessão
// Adaptar refreshSessionCookies() para o domínio www.mercadolivre.com.br
```

### 2. Link curto para OM895584
**Problema:** O OM895584 usa o formato antigo (Clube de Afiliados) com `meliid`+`melitat`. A API interna do novo programa não reconhece a tag.

**Solução:** Pedir pro usuário logar como OM895584 e importar os cookies. Se o ML permitir múltiplas etiquetas na mesma conta, cadastrar `om895584` como etiqueta adicional.

---

## 🟡 Importante

### 3. Feedback visual de cookies expirados
**Problema:** Quando os cookies expiram, o usuário só descobre ao tentar converter e cair no fallback.

**Solução:** Na listagem de afiliados, mostrar status "🍪 expirado" quando `POST /api/ml/affiliates/:mlUserId/validate-cookies` retornar `valid: false`. Já existe o endpoint, falta chamar no frontend.

### 4. Batch de URLs (1-25)
**Problema:** A API do ML aceita até 25 URLs por request, mas o protótipo envia 1 por vez.

**Solução:** No frontend, permitir colar múltiplas URLs (uma por linha). No backend, enviar batch e retornar array de resultados.

### 5. Cache de CSRF token
**Problema:** Cada chamada de link curto faz um GET no linkbuilder pra pegar CSRF, mesmo que os cookies ainda sejam os mesmos.

**Solução:** Cachear o CSRF token por afiliado (válido enquanto os cookies não expirarem). Reduz latência de 2 requests pra 1.

---

## 🟢 Melhorias

### 6. Extensão — auto-detect de conta logada
**Problema:** Usuário precisa selecionar manualmente qual afiliado no dropdown.

**Solução:** A extensão lê o cookie `orguseridp` ou `orgnickp` que já identificam qual conta está logada e pré-seleciona o afiliado correspondente.

### 7. Extensão — refresh periódico
**Problema:** Usuário precisa lembrar de reimportar cookies.

**Solução:** Usar `chrome.alarms` pra rodar a importação a cada N horas automaticamente, se o usuário estiver logado no ML.

### 8. Mensagens de erro descritivas
**Problema:** Erros genéricos como "Produto não elegível" sem explicação.

**Solução:** Mapear `error_code` da API:

| Código | Significado | Ação |
|--------|-------------|------|
| 109 | Tag não associada ao afiliado | Reimportar cookies da conta correta |
| — | URL não permitida | Produto não elegível no programa |
| 401 | Não autorizado | Cookies expirados |

### 9. Fallback inteligente
**Problema:** Quando o link curto falha por produto inelegível, o sistema cai em URL params. Mas URL params podem não trackear corretamente no novo programa.

**Solução:** Se o método `api` falhar com "URL não permitida", retornar o erro em vez de silenciosamente cair em fallback — o usuário precisa saber que aquele produto não é elegível.

### 10. Testes automatizados
- Teste de conversão com cookies válidos → link curto
- Teste de conversão sem cookies → URL params
- Teste de conversão com cookies expirados → fallback
- Teste de validação de cookies

---

## 🎯 Roadmap sugerido

| Sprint | O que |
|--------|-------|
| **1** | Renovação automática de cookies + fallback inteligente |
| **2** | Feedback visual de cookies expirados + batch de URLs |
| **3** | Extensão: auto-detect + refresh periódico |
| **4** | Mensagens de erro + testes |
