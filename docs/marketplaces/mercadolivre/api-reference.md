# Mercado Livre — API de Afiliados (Clube de Afiliados)

> **Fonte:** Documentação oficial do programa de afiliados Mercado Livre + API pública developers.mercadolivre.com.br + análise de implementações open source + validação via Postman + análise NotebookLM da documentação oficial.
> **Última atualização:** 2026-07-20
> **Link do programa:** https://afiliados.mercadolivre.com.br/ (requer login)
> **Portal do desenvolvedor:** https://developers.mercadolivre.com.br/
> **Dev Center (criação de apps):** https://developers.mercadolivre.com.br/devcenter

---

## Sumário

- [1. Visão Geral](#1-visão-geral)
- [2. Cadastro e Configuração no Dev Center](#2-cadastro-e-configuração-no-dev-center)
  - [2.1 Criar Aplicação](#21-criar-aplicação)
  - [2.2 Configurar Redirect URL e Scopes](#22-configurar-redirect-url-e-scopes)
  - [2.3 Autenticação de Dois Fatores (2FA)](#23-autenticação-de-dois-fatores-2fa)
  - [2.4 Credenciais Obtidas](#24-credenciais-obtidas)
- [3. Fluxo de Autenticação (OAuth 2.0)](#3-fluxo-de-autenticação-oauth-20)
  - [3.1 Obter Authorization Code](#31-obter-authorization-code)
  - [3.2 Trocar Code por Tokens (POST)](#32-trocar-code-por-tokens-post)
  - [3.3 Renovação via Refresh Token](#33-renovação-via-refresh-token)
- [4. Geração de Links de Afiliado — Link Builder API](#4-geração-de-links-de-afiliado--link-builder-api)
  - [4.1 Endpoint Oficial](#41-endpoint-oficial)
  - [4.2 Exemplo com cURL](#42-exemplo-com-curl)
  - [4.3 Resposta da API](#43-resposta-da-api)
  - [4.4 Tratamento de Erros](#44-tratamento-de-erros)
  - [4.5 Rate Limits e Escalabilidade](#45-rate-limits-e-escalabilidade)
- [5. Abordagens Alternativas](#5-abordagens-alternativas)
  - [5.1 Via Cookies (Link Builder Simulado)](#51-via-cookies-link-builder-simulado)
  - [5.2 Fallback — Parâmetros na URL](#52-fallback--parâmetros-na-url)
  - [5.3 Formato Matt Tool (recomendado para fallback)](#53-formato-matt-tool-recomendado-para-fallback)
- [6. API de Produtos (Busca Pública)](#6-api-de-produtos-busca-pública)
  - [6.1 Buscar Produtos](#61-buscar-produtos)
  - [6.2 Parâmetros de Busca](#62-parâmetros-de-busca)
  - [6.3 Resposta](#63-resposta)
- [7. Testes e Validação via Postman](#7-testes-e-validação-via-postman)
- [8. Diferenças Regionais](#8-diferenças-regionais)
- [9. API de Relatórios e Métricas](#9-api-de-relatórios-e-métricas)
- [10. Webhooks e Callbacks](#10-webhooks-e-callbacks)
- [11. Tabela de Comissões](#11-tabela-de-comissões)
- [12. Etiqueta de Uso (Tracking Tag)](#12-etiqueta-de-uso-tracking-tag)
- [13. Políticas e Restrições](#13-políticas-e-restrições)
- [14. Exemplos Práticos](#14-exemplos-práticos)
  - [14.1 Fluxo Completo: Autenticação → Link](#141-fluxo-completo-autenticação--link)
  - [14.2 Buscar Produtos + Gerar Link](#142-buscar-produtos--gerar-link)
- [15. Detecção de Links no WhatsApp](#15-detecção-de-links-no-whatsapp)
- [16. Diagrama de Integração](#16-diagrama-de-integração)
- [17. Considerações Técnicas Cruciais](#17-considerações-técnicas-cruciais)
- [18. Referências](#18-referências)

---

## 1. Visão Geral

O Mercado Livre possui um programa de afiliados ("Clube de Afiliados") que permite gerar links rastreados a partir de URLs de produtos. O ML oferece **duas abordagens** para geração de links de afiliado, em ordem de prioridade:

| # | Abordagem | Volume | Requer | Link Builder |
|---|-----------|--------|--------|-------------|
| 1 | **API Oficial OAuth 2.0** — `authorization_code` | Alto (>500 cliques/dia) | App registrada no Dev Center + refresh_token | `POST /affiliates/link-builder` |
| 2 | **Cookies** — Simulação do painel Link Builder | Médio | Sessão logada no ML (cookies) | POST para página interna |

> ✅ **A API oficial de conversão (`/affiliates/link-builder`) EXISTE e está confirmada.** Diferente do que documentações anteriores indicavam, o ML possui sim um endpoint REST para gerar links encurtados (`meli.la/xxx`) — o fluxo completo está detalhado nas seções 3 e 4.

---

## 2. Cadastro e Configuração no Dev Center

O primeiro passo para usar a API oficial é registrar uma aplicação no **Dev Center** do Mercado Livre.

### 2.1 Criar Aplicação

1. Acesse https://developers.mercadolivre.com.br/devcenter
2. Clique em **"Criar uma nova aplicação"**
3. Preencha os campos obrigatórios:
   - **Nome da aplicação** (ex: "O Mestre Afiliado")
   - **Descrição** (ex: "Conversor automático de links de afiliados")
   - **Logotipo** — obrigatório. Faça upload de uma imagem (qualquer logo válido)

### 2.2 Configurar Redirect URL e Scopes

- **Redirect URL:** informe uma URL válida para onde o usuário será redirecionado após autorizar o acesso. Pode ser:
  - URL do seu site (ex: `https://seudominio.com.br/auth/callback`)
  - URL temporária para testes (ex: `https://localhost:3000/auth/callback`)
  - Até mesmo `https://httpbin.org/anything` para capturar o code durante desenvolvimento

- **Scopes (Escopos):** selecione as permissões de **leitura e escrita** (`read` / `write`) para garantir acesso full aos dados necessários para gerar os links.

### 2.3 Autenticação de Dois Fatores (2FA)

O Mercado Livre exige **autenticação de dois fatores** para finalizar o registro da aplicação. O código de verificação é enviado via **WhatsApp** para o número cadastrado no parceiro/afiliado. Tenha o celular por perto durante o cadastro.

### 2.4 Credenciais Obtidas

Após salvar, você receberá:

| Campo | Nome Técnico | Onde usar |
|-------|--------------|-----------|
| **App ID** | `client_id` | URL de autorização + corpo do POST `/oauth/token` |
| **Secret Key** | `client_secret` | Corpo do POST `/oauth/token` |

> ⚠️ Armazene a Secret Key de forma segura. Ela não é exibida novamente após a criação.

#### Configuração de Referência — O Mestre Afiliado

Dados da aplicação registrada no Dev Center:

| Item | Valor |
|------|-------|
| **App ID** | `8762086145951776` |
| **Secret Key** | `l8CcS5DsFkewcITnhZxPIDIWKLoL97YN` |
| **Redirect URI** | `https://omestreafiliado.com.br/` |
| **Notification Callback** | `https://omestreafiliado.com.br/callback` |
| **OAuth Flows** | `authorization_code` + `refresh_token` |
| **Escopo de permissão** | `read` (Leitura) para `Usuários` |
| **Business Unit** | Mercado Livre |

> ⚠️ A Secret Key acima foi copiada do Dev Center no momento da criação. Se for regenerada, atualize este documento e o `.env`.

---

## 3. Fluxo de Autenticação (OAuth 2.0)

A API oficial usa o fluxo **`authorization_code`** do OAuth 2.0 (não `client_credentials`). Isso é importante porque o `authorization_code` retorna um `refresh_token` que permite renovar o acesso sem repetir o processo manual.

### 3.1 Obter Authorization Code

Construa a URL abaixo e acesse-a pelo navegador (estando logado no ML como afiliado):

```
https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=[SEU_APP_ID]&redirect_uri=[SUA_REDIRECT_URL]
```

**Parâmetros:**

| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `response_type` | `code` | Fixo — indica fluxo authorization_code |
| `client_id` | Seu App ID | Obtido no Dev Center |
| `redirect_uri` | Sua Redirect URL | Deve ser IDENTICA à cadastrada no Dev Center |

**O que acontece:**

1. O navegador abre a página de autorização do ML
2. Você confirma que permite o acesso
3. O navegador é redirecionado para sua `redirect_uri` com o parâmetro `?code=...` no final da URL
4. **Copie o valor do `code` imediatamente** — ele expira em poucos minutos

```
https://seudominio.com.br/auth/callback?code=TG-1234567890abcdef1234567890abcdef
                                                      ↑
                                              Authorization Code
```

### 3.2 Trocar Code por Tokens (POST)

Com o `code` em mãos, faça uma requisição **POST** para o endpoint de token:

```
POST https://api.mercadolibre.com/oauth/token
Content-Type: application/json
Accept: application/json

{
  "grant_type": "authorization_code",
  "client_id": "SEU_APP_ID",
  "client_secret": "SEU_CLIENT_SECRET",
  "code": "O_CODE_OBTIDO",
  "redirect_uri": "SUA_REDIRECT_URL"
}
```

**Exemplo com cURL:**

```bash
curl -X POST https://api.mercadolibre.com/oauth/token \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "client_id": "1234567890",
    "client_secret": "s3cr3tK3yF0rM3rc4d0L1vr3",
    "code": "TG-1234567890abcdef1234567890abcdef",
    "redirect_uri": "https://httpbin.org/anything"
  }'
```

**Resposta de sucesso (200 OK):**

```json
{
  "access_token": "APP_USR-1234567890-123456-abc123def456-1234567890",
  "token_type": "Bearer",
  "expires_in": 21600,
  "refresh_token": "TG-1234567890abcdef1234567890abcdef-1234567890",
  "user_id": 1234567890,
  "scope": "read write"
}
```

| Campo | Descrição | Validade |
|-------|-----------|----------|
| `access_token` | Token usado nas chamadas da API | **6 horas** (21.600s) |
| `refresh_token` | Token para renovar sem repetir autorização manual | Longa duração |
| `scope` | Permissões concedidas | `read write` |

> ⚠️ O Mercado Livre retorna `Content-Type: application/x-www-form-urlencoded` como padrão. Testes indicam que `application/json` também funciona. Em caso de erro, tente com `x-www-form-urlencoded`.

### 3.3 Renovação via Refresh Token

Quando o `access_token` expirar (6h), use o `refresh_token` para obter um novo par sem precisar repetir o fluxo manual:

```
POST https://api.mercadolibre.com/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "client_id": "SEU_APP_ID",
  "client_secret": "SEU_CLIENT_SECRET",
  "refresh_token": "SEU_REFRESH_TOKEN"
}
```

**Resposta:**

```json
{
  "access_token": "APP_USR-NOVO_TOKEN...",
  "token_type": "Bearer",
  "expires_in": 21600,
  "refresh_token": "NOVO_REFRESH_TOKEN..."
}
```

> 🔄 A resposta também retorna um **novo `refresh_token`** — sempre atualize o armazenado. Se o `refresh_token` for invalidado (por expiração ou logout), a aplicação perde o acesso e exige um novo fluxo de autorização manual (seção 3.1).

---

## 4. Geração de Links de Afiliado — Link Builder API

### 4.1 Endpoint Oficial

Com um `access_token` válido, converta URLs de produtos comuns em links rastreados:

\`\`\`
POST https://api.mercadolibre.com/affiliates/link-builder
Authorization: Bearer SEU_ACCESS_TOKEN
Content-Type: application/json

{
  "url": "https://www.mercadolivre.com.br/produto-X/p/MLB1234567890"
}
\`\`\`

**Headers obrigatórios:**

| Header | Valor |
|--------|-------|
| `Authorization` | `Bearer [ACCESS_TOKEN]` |
| `Content-Type` | `application/json` |

### 4.2 Exemplo com cURL

```bash
curl -X POST https://api.mercadolivre.com/affiliates/link-builder \
  -H "Authorization: Bearer APP_USR-1234567890-..." \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.mercadolivre.com.br/produto-X/p/MLB1234567890"}'
```

### 4.3 Resposta da API

**Sucesso (200 OK):**

```json
{
  "shorten_url": "https://meli.la/2LguX52",
  "long_url": "https://www.mercadolivre.com.br/produto-X/p/MLB1234567890?matt_word=USERNAME&matt_tool=TOOLID",
  "status": "ok"
}
```

| Campo | Descrição |
|-------|-----------|
| `shorten_url` | Link encurtado oficial (`meli.la/xxx`) — use este para divulgação |
| `long_url` | Link completo com parâmetros de tracking do seu ID de afiliado |
| `status` | "ok" em caso de sucesso |

> 💡 O `long_url` já contém os parâmetros de tracking (`matt_word` + `matt_tool`) automaticamente — você não precisa construí-los manualmente quando usa a API.

### 4.4 Tratamento de Erros

A API do Link Builder pode retornar os seguintes erros:

| Situação | Resposta | Causa Provável |
|----------|----------|----------------|
|| URL inválida | `"URL invalida"` | URL do produto não reconhecida pelo sistema do ML (sem acento) |
| Token expirado | `401 Unauthorized` | `access_token` expirou (6h) — renovar via `refresh_token` |
| Credenciais inválidas | `403 Forbidden` | App ID / Secret Key incorretos ou conta desativada |
| Refresh token inválido | Erro na renovação | `refresh_token` expirou ou foi revogado (logout do usuário) |
| Sessão expirada | Redirecionamento para login | Cookies do Link Builder simulado expiraram |

**Regras importantes:**
- O `authorization_code` tem vida curta (poucos minutos) — deve ser trocado imediatamente
- Se o `refresh_token` for invalidado, o fluxo manual de autorização (seção 3.1) precisa ser repetido
- Para erros de URL inválida, verifique se o link do produto está acessível publicamente
- Em caso de falha na conversão, a API pode retornar a mensagem `"URL invalida"` (sem acento) diretamente no body

**Estratégia de retry recomendada:**

```
1ª tentativa → 200 OK? Entrega o link
               401? Renova token com refresh_token e tenta de novo
               403? Aborta — problema de credenciais
               "URL invalida"? Aborta — URL do produto problemática
               429 (rate limit)? Aguarda e retry com backoff
               Timeout/erro de rede? Retry 3x com backoff exponencial
```

### 4.5 Rate Limits e Escalabilidade

| Aspecto | Detalhe |
|---------|---------|
| **Volume recomendado** | API indicada para >500 cliques/dia |
| **Volumes menores** | Abordagens via cookies ou fallback de URL são mais simples |
| **Alta demanda** | Implementações personalizadas podem usar **filas (Redis)** para gerenciar grandes volumes sem interrupções. Ferramentas de automação como **n8n**, **Make** e **Node-RED** são comuns para orquestrar filas + chamadas à API em lote |
| **Headers de rate limit** | Não confirmados oficialmente (não documentados nas fontes analisadas) |
| **API pública (sem auth)** | ~10 req/s estimado; mais restritivo |
| **API autenticada (OAuth)** | Limites maiores, mas não especificados oficialmente |

> 💡 Para operações em escala, considere usar um sistema de fila (Redis/Bull) ou ferramentas de automação como **n8n** para processar as conversões de link em lote, evitando estourar limites não documentados.

> 💡 O domínio correto da API é `api.mercadolibre.com` (sem 'v'), mesmo para o Brasil.

---

## 5. Abordagem Alternativa

### 5.1 Via Cookies (Link Builder Simulado)

Para médio volume, é possível simular o Link Builder acessando a página interna do painel de afiliados com cookies de sessão.

- **URL:** `https://www.mercadolivre.com.br/afiliados/link-builder`
- **Método:** POST com `Content-Type: application/x-www-form-urlencoded`
- **Body:** `url=https://www.mercadolivre.com.br/...`
- **Header adicional:** `X-Metadata-Session-Id` (ID único por requisição)
- **Cookies:** Sessão logada no ML — expiram periodicamente, necessário renovar via `set-cookie`

**Resposta:** HTML contendo o link encurtado `meli.la/xxx` ou redirect para o mesmo.

> ⚠️ Cookies expirados redirecionam para a página de login do ML. Nesse caso, é necessário reautenticar manualmente no navegador e extrair os cookies novamente.

---

## 6. API de Produtos (Busca Pública)

### 6.1 Buscar Produtos

```
GET https://api.mercadolibre.com/sites/MLB/search?q={termo}
```

Pode ser acessada **sem autenticação** para consultas básicas, mas com limite de taxa mais restritivo (~10 req/s). Com token OAuth, os limites são maiores.

```bash
curl "https://api.mercadolibre.com/sites/MLB/search?q=iphone&limit=3"
```

Ou com autenticação para maior rate limit:

```bash
curl "https://api.mercadolibre.com/sites/MLB/search?q=iphone&limit=3" \
  -H "Authorization: Bearer APP_USR-..."
```

### 6.2 Parâmetros de Busca

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `q` | String | Termo de busca (obrigatório) |
| `limit` | Int | Máx. de resultados (default: 50, máx: 100) |
| `sort` | String | Ordenação: `price_asc`, `price_desc`, `relevance` |
| `shipping` | String | `free` para frete grátis |
| `condition` | String | `new` ou `used` |
| `DEAL` | String | `true` para apenas ofertas com desconto |
| `category` | String | ID da categoria para filtrar |

### 6.3 Resposta

```json
{
  "results": [
    {
      "id": "MLB1234567890",
      "title": "iPhone 15 Pro Max 256GB",
      "price": 6999.0,
      "original_price": 7999.0,
      "currency_id": "BRL",
      "thumbnail": "https://http2.mlstatic.com/D_12345.jpg",
      "permalink": "https://www.mercadolivre.com.br/iphone-15-pro/p/MLB1234567890",
      "condition": "new",
      "shipping": { "free_shipping": true },
      "sold_quantity": 500
    }
  ],
  "paging": {
    "total": 150,
    "offset": 0,
    "limit": 10
  }
}
```

**Campos importantes para o sistema:**

| Campo | Descrição |
|-------|-----------|
| `permalink` | URL do produto (base para gerar link de afiliado) |
| `title` | Nome do produto (para exibir no WhatsApp) |
| `price` | Preço atual |
| `original_price` | Preço original (null se não há desconto) |
| `thumbnail` | URL da miniatura (trocar `-I.jpg` por `-O.jpg` para imagem grande) |
| `shipping.free_shipping` | Frete grátis? |
| `condition` | Novo ou usado |

---

## 7. Testes e Validação via Postman

Para garantir que a integração está correta antes de escalar para o código final:

### 7.1 Importar Requisições do Navegador

1. Abra o painel de afiliados no navegador (https://afiliados.mercadolivre.com.br/)
2. Pressione **F12** (DevTools) → aba **Network**
3. Interaja com o Link Builder para gerar um link
4. Clique com botão direito na requisição → **Copy as cURL**
5. No Postman: **File → Import → Raw text** → cole o cURL

### 7.2 Configurar Variáveis de Ambiente

No Postman, configure variáveis globais para facilitar os testes:

| Variável | Valor |
|----------|-------|
| `ml_client_id` | Seu App ID |
| `ml_client_secret` | Sua Secret Key |
| `ml_access_token` | Atualizado automaticamente após obter token |
| `ml_refresh_token` | Para renovação sem re-autorizar |
| `ml_redirect_uri` | URL de redirecionamento configurada |

### 7.3 Fluxo de Teste Recomendado

1. **GET Authorization Code** → abra a URL de autorização no navegador, copie o `code`
2. **POST /oauth/token** → troque o code por `access_token` + `refresh_token`
3. **POST /affiliates/link-builder** → com o `access_token`, converta uma URL de produto
4. **POST /oauth/token (refresh)** → teste a renovação com o `refresh_token`
5. **Teste de erro** → tente com URL inválida e veja a resposta `"URL invalida"`
6. **Verificar Status:** uma integração bem-sucedida retorna **200 OK** em todos os endpoints

---

## 8. Diferenças Regionais

O Mercado Livre opera em vários países da América Latina. Abaixo o resumo das diferenças:

| País | Domínio ML | Domínio Auth | Domínio API (OAuth) | Programa de Afiliados |
|------|-----------|-------------|-------------------|-----------------------|
| Brasil | mercadolivre.com.br | auth.mercadolivre.com.br | api.mercadolibre.com | ✅ Sim |
| Argentina | mercadolibre.com.ar | auth.mercadolibre.com.ar | api.mercadolibre.com | ✅ Sim |
| México | mercadolibre.com.mx | auth.mercadolibre.com.mx | api.mercadolibre.com | ✅ Sim |
| Chile | mercadolibre.cl | auth.mercadolibre.cl | api.mercadolibre.com | ✅ Sim |
| Colômbia | mercadolibre.com.co | auth.mercadolibre.com.co | api.mercadolibre.com | ✅ Sim |

**Regras:**
- **OAuth:** Cada país tem seu domínio de autorização local (`auth.mercadolivre.com.br`, `auth.mercadolibre.com.ar`, etc.)
- **API centralizada:** O endpoint de token (`api.mercadolibre.com/oauth/token`) e o Link Builder (`api.mercadolivre.com/affiliates/link-builder`) são os mesmos para todos os países
- **Escopos:** Os scopes `read` / `write` são os mesmos em todos os países
- **Programa de Afiliados:** Existe em todos os países, mas os percentuais de comissão podem variar por região e categoria
- **Links de produto:** Ao gerar links para outros países, use o domínio local do ML (ex: `mercadolibre.com.ar` para Argentina)

> ⚠️ **Importante:** O endpoint do Link Builder usa o domínio `.com.br` (`api.mercadolivre.com`), mesmo para URLs de outros países. Se precisar testar com URLs de outros mercados, mantenha o mesmo endpoint da API.

---

## 9. API de Relatórios e Métricas

**⚠️ Status atual:** Não há uma API REST pública documentada para consultar relatórios de desempenho, cliques ou comissão. O acesso a esses dados é feito exclusivamente pelo **painel web** do programa de afiliados.

### Painel de Relatórios

Acesse: https://afiliados.mercadolivre.com.br/ → aba **"Relatórios"**

**Dados disponíveis no painel:**

| Métrica | Descrição |
|---------|-----------|
| Cliques por link/canal | Quantidade de cliques em cada link de afiliado gerado |
| Valor médio do pedido | Ticket médio das compras convertidas |
| Comissões pendentes | Vendas aguardando confirmação (prazo de até 60 dias) |
| Comissões pagas | Valores já confirmados e pagos via Mercado Pago |
| Performance por período | Filtro por data (personalizado ou predefinido) |

### Exportação

- **Formato:** Não há exportação JSON/CSV documentada via API
- **Recomendação:** Use o painel web para consultas manuais
- **Ferramentas complementares:** O **Rally de Vendas** (ferramenta do ecossistema ML) pode ser usado como centralizador de métricas

> 💡 Para automação de relatórios, uma possível abordagem é usar o Playwright/Browser MCP para acessar o painel logado e extrair os dados — similar à abordagem de cookies do Link Builder.

---

## 10. Webhooks e Callbacks

**⚠️ Status atual:** O programa de afiliados do Mercado Livre **não oferece webhooks oficiais** para notificação de cliques, vendas ou comissões.

### Alternativas para notificações

| Abordagem | Descrição | Limitação |
|-----------|-----------|-----------|
| **Painel de relatórios** | Acompanhamento manual via aba "Relatórios" no dashboard | Sem automação |
| **Webhook customizado (sua aplicação)** | Implementações de automação (como **n8n**, **Make**, **Node-RED**) podem configurar um webhook POST no payload para receber notificações quando a tarefa de **geração de link** ou **scraping de dados** for concluída, contendo o resultado (ex: `shorten_url`) no body da resposta | É um webhook da automação para notificar tarefa completa, **não do ML** — não notifica que a venda ocorreu |
| **Scraping periódico do painel** | Usar Playwright para acessar o dashboard logado e extrair métricas | Requer manter sessão ativa; sujeito a mudanças no HTML |

### Prazo de confirmação

As comissões aparecem no relatório após o prazo de confirmação da venda (que pode levar até **60 dias**). O afiliado deve acompanhar o status via painel.

---

## 11. Tabela de Comissões

### Percentuais Gerais

| Aspecto | Valor |
|---------|-------|
| **Comissão máxima** | Até **16%** sobre o valor do produto |
| **Variação por categoria** | Categorias de margem maior pagam mais |
| **Pagamento** | Via **Mercado Pago** após confirmação da venda |
| **Prazo de confirmação** | Até **60 dias** para a venda ser confirmada |

### Variação por Categoria (exemplos)

| Categoria | Comissão Relativa |
|-----------|-------------------|
| Beleza e Cuidados Pessoais | 💰 Mais alta (próximo ao teto de 16%) |
| Moda e Acessórios | 💰 Alta |
| Casa e Decoração | 💰 Média-Alta |
| Eletrônicos | 💵 Mais baixa (margens menores) |
| Informática | 💵 Mais baixa |

> ℹ️ **Nota:** As comissões exatas por categoria não são divulgadas publicamente em formato de tabela única. Os valores acima são baseados em observações empíricas de afiliados e variam conforme o programa, o país e promoções vigentes. Consulte o dashboard de afiliados para ver as taxas atuais dos produtos que você divulga.

### Regras de Cálculo

- A comissão é calculada sobre o **valor final do produto** (considerando frete?)
- Produtos em oferta/desconto podem ter comissão calculada sobre o valor com desconto
- A confirmação da venda depende da política de devolução e prazo do ML (até 60 dias)
- O pagamento é feito via **Mercado Pago** após a confirmação

---

## 12. Etiqueta de Uso (Tracking Tag)

A "etiqueta de uso" é um recurso do programa de afiliados para categorizar e rastrear os links gerados por canal de divulgação.

### Como configurar

1. Acesse https://afiliados.mercadolivre.com.br/
2. Navegue para **Afiliados → Administrar etiquetas**
3. Crie etiquetas como: "WhatsApp", "Site Próprio", "Instagram", "Telegram", "Blog"
4. Cada etiqueta terá um identificador único

### Como usar na API

- Durante a geração do link (via API ou painel), **selecione a etiqueta desejada**
- A etiqueta aparece vinculada a parâmetros como `picker=` ou outros identificadores de rastreio na URL gerada
- O `long_url` retornado pela API do Link Builder já inclui a etiqueta configurada

### Por que usar

- **Atribuição de canal:** Cada etiqueta permite ver no relatório qual canal está gerando mais cliques e conversões
- **Otimização:** Identifique quais canais têm melhor ROI e foque neles
- **Organização:** Separe tráfego orgânico de pago, ou diferentes campanhas

> ⚠️ A criação e gerenciamento de etiquetas é feita **exclusivamente pelo painel web** — não há API pública para CRUD de etiquetas.

---

## 13. Políticas e Restrições

### Divulgação Obrigatória

É **exigência legal e do programa** identificar links de afiliados com hashtags como:
- `#publicidade`
- `#linkpatrocinado`
- Termos equivalentes que deixem claro que há interesse comercial

> ⚠️ **Importante:** A ausência de identificação pode violar o Código de Defesa do Consumidor (CDC) e as regras do programa, resultando em sanções.

### Encurtadores de Link

| Permitido | Proibido |
|-----------|----------|
| ✅ Encurtador oficial `meli.la` | ❌ Encurtadores de terceiros que ocultem o domínio do ML |
| ✅ Links diretos do ML com parâmetros | ❌ Qualquer serviço que impeça o ML de rastrear a origem do clique |

**Regra:** O uso de encurtadores de terceiros que ocultem o domínio do Mercado Livre é proibido, pois pode causar a **perda da comissão**. Use sempre o `meli.la` fornecido pela API ou gere links diretos com parâmetros de tracking.

### Janela de Atribuição

- A comissão é válida para compras feitas em até **30 dias** após o clique no link de afiliado
- Se o usuário clicar no link hoje e comprar em até 30 dias, a comissão é garantida

### Automação e Bots

**✅ Permitido:**
- Uso de APIs oficiais (OAuth) para gerar links programaticamente
- Automação de postagens em grupos de WhatsApp e Telegram
- Bots que convertem links automaticamente, desde que as credenciais e sessões sejam mantidas de forma legítima

**❌ Práticas de risco:**
- Gerar links para os próprios produtos (autocompra) — pode ser considerado fraude
- Spam de links em canais não autorizados
- Uso de robôs para clicar nos próprios links (click fraud)
- Camuflagem de links de afiliado com encurtadores proibidos

### Sanções

Violações dos termos podem resultar em:
- **Suspensão temporária** da conta de afiliado
- **Cancelamento permanente** do cadastro no programa
- **Perda de comissões** não pagas
- **Bloqueio da aplicação** no Dev Center

---

## 14. Exemplos Práticos

### 14.1 Fluxo Completo: Autenticação → Link

```typescript
/**
 * Fluxo completo: OAuth authorization_code → Link Builder API
 */
const OAUTH_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const LINK_BUILDER_API = 'https://api.mercadolivre.com/affiliates/link-builder';

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface LinkResponse {
  shorten_url: string;
  long_url: string;
  status: string;
}

// 1. Trocar authorization_code por tokens
async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<AuthResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

// 2. Renovar token via refresh_token
async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<AuthResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`Refresh error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

// 3. Gerar link de afiliado
async function generateAffiliateLink(
  productUrl: string,
  accessToken: string,
): Promise<string> {
  const res = await fetch(LINK_BUILDER_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: productUrl }),
  });

  if (!res.ok) {
    throw new Error(`Link Builder error ${res.status}: ${await res.text()}`);
  }

  const data: LinkResponse = await res.json();

  if (!data.shorten_url) {
    throw new Error(`API não retornou shorten_url: ${JSON.stringify(data)}`);
  }

  return data.shorten_url; // Ex: "https://meli.la/2LguX52"
}
```

### 14.2 Buscar Produtos + Gerar Link

```typescript
// 1. Buscar produto via API pública
async function searchMLProduct(query: string) {
  const res = await fetch(
    `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(query)}&limit=1`
  );
  const data = await res.json();
  if (!data.results?.length) return null;

  const product = data.results[0];
  return {
    title: product.title,
    price: product.price,
    originalPrice: product.original_price,
    image: product.thumbnail.replace('-I.jpg', '-O.jpg'),
    url: product.permalink,
    freeShipping: product.shipping?.free_shipping ?? false,
  };
}

// 2. Gerar link de afiliado via API oficial (se tiver token)
async function makeMLAffiliateLinkOfficial(
  productUrl: string,
  accessToken: string,
): Promise<string> {
  return generateAffiliateLink(productUrl, accessToken);
}

// 3. Ou fallback manual com parâmetros na URL
function makeMLAffiliateLinkFallback(
  productUrl: string,
  affiliateTag: string,
): string {
  const url = new URL(productUrl);

  // Formato Matt Tool
  if (affiliateTag.startsWith('matt:')) {
    const [_, word, tool] = affiliateTag.split(':');
    url.searchParams.set('matt_word', word);
    url.searchParams.set('matt_tool', tool);
  } else {
    url.searchParams.set('tag', affiliateTag);
  }

  return url.toString();
}
```

---

## 15. Detecção de Links no WhatsApp

Padrões de URL do Mercado Livre para detectar nas mensagens:

```
mercadolivre.com.br/{produto}/p/MLB{id}
mercadolivre.com.br/p/MLB{id}
mercadolivre.com.br/{produto}/dp/{id}
mercadolivre.com.br/item/MLB{id}
```

Regex para detecção:

```typescript
const ML_LINK_REGEX = /mercadolivre\.com\.br\/(?:[^/\s]+\/)?(?:p\/MLB\d+|item\/MLB\d+|dp\/\w+)/i;
```

---

## 16. Diagrama de Integração

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FLUXO OAUTH 2.0 — ML AFILIADOS                    │
└─────────────────────────────────────────────────────────────────────┘

    ┌─────────┐          ┌──────────────┐          ┌────────────────┐
    │   DEV    │          │   ML AUTH    │          │   ML API       │
    │   APP    │          │   SERVER     │          │   (oauth/token)│
    └────┬────┘          └──────┬───────┘          └───────┬────────┘
         │                      │                          │
         │  1. GET authorize    │                          │
         │  ──────────────────► │                          │
         │                      │                          │
         │  2. redirect_uri?    │                          │
         │  code=XXX ◄────────  │                          │
         │                      │                          │
         │  3. POST code+creds  │                          │
         │  ──────────────────────────────────────────────► │
         │                      │                          │
         │  4. access_token +   │                          │
         │  refresh_token ◄─────────────────────────────── │
         │                      │                          │
         │                      │                          │
    ┌────┴────┐          ┌──────┴───────┐          ┌───────┴────────┐
    │   DEV    │          │   ML LINK    │          │   (6h depois)  │
    │   APP    │          │   BUILDER    │          │   ML API       │
    └────┬────┘          └──────┬───────┘          └───────┬────────┘
         │                      │                          │
         │  5. POST url +       │                          │
         │  Bearer token ─────► │                          │
         │                      │                          │
         │  6. shorten_url +    │                          │
         │  long_url ◄────────  │                          │
         │                      │                          │
         │  7. POST refresh     │                          │
         │  ──────────────────────────────────────────────► │
         │                      │                          │
         │  8. NOVOS tokens ◄───────────────────────────── │
         │                      │                          │
```

---

## 17. Considerações Técnicas Cruciais

1. **✅ API de conversão EXISTE** — o endpoint `POST /affiliates/link-builder` é a forma oficial e recomendada para volumes profissionais. O `shorten_url` retornado (`meli.la/xxx`) é o link encurtado oficial.

2. **Janela de Atribuição:** A comissão é garantida para compras feitas em até **30 dias** após o clique no link gerado.

3. **Etiqueta de Uso:** Configure corretamente sua "etiqueta de uso" no painel de afiliados (Afiliados → Administrar etiquetas) para que o rastreamento seja atribuído ao canal correto (ex: "site próprio", "WhatsApp", "redes sociais").

4. **Volume Profissional:** A API oficial via OAuth é recomendada para afiliados que geram mais de **500 cliques por dia**. Para volumes menores, as abordagens via cookies ou fallback de URL podem ser mais simples.

5. **Comissão máxima:** Até **16%**, variando por categoria. Pagamento via Mercado Pago após confirmação (até 60 dias).

6. **Imagens:** A URL da thumbnail (`-I.jpg`) pode ser convertida para imagem grande trocando `-I` por `-O`.

7. **Rate limit da API pública:** ~10 req/s sem autenticação. Com OAuth autenticado, os limites são maiores. Para escala, considere usar filas (Redis/Bull).

8. **Refresh Token:** Sempre armazene o NOVO `refresh_token` retornado na resposta de refresh — o antigo pode ser invalidado. Se invalidado, repita o fluxo de autorização manual.

9. **Link de terceiros:** Se o link original já contiver `tag`, `matt_word` ou `matt_tool`, não sobrescrever. Ignorar a conversão ou avisar.

10. **Divulgação obrigatória:** Links de afiliado devem ser identificados com `#publicidade` ou equivalente (exigência legal).

11. **Encurtadores:** Use apenas o `meli.la` oficial. Encurtadores de terceiros que ocultem o domínio do ML podem causar perda da comissão.

12. **Automação permitida:** APIs e bots para automação de postagens são permitidos, desde que as credenciais sejam mantidas de forma legítima.

13. **API de relatórios:** Não há endpoint REST público — métricas de desempenho são acessíveis apenas pelo painel web.

14. **Erro "URL invalida":** A API retorna esta mensagem (sem acento) quando a URL do produto não é reconhecida. Verifique se o link está acessível.

15. **Domínio do Link Builder:** O endpoint `api.mercadolivre.com/affiliates/link-builder` atende **todos os países** (Brasil, Argentina, México, etc.).

16. **Automação com n8n/Make:** Ferramentas de automação como **n8n**, **Make** e **Node-RED** podem orquestrar o fluxo completo de autenticação, geração de links e postagem em grupos, utilizando filas (Redis) para gerenciar escala e evitar rate limits. Consulte os tutoriais nas referências.

---

## 18. Referências

- **Clube de Afiliados ML:** https://afiliados.mercadolivre.com.br/
- **Portal do Desenvolvedor ML:** https://developers.mercadolivre.com.br/
- **Dev Center (criação de apps):** https://developers.mercadolivre.com.br/devcenter
- **OAuth ML:** https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
- **API de Busca ML:** https://api.mercadolibre.com/sites/MLB/search
- **Gerador de Links ML (open source):** https://github.com/DeivianDS/mercadolivre-afiliados
- **Central de Parceiros:** https://centraldeparceiros.mercadolivre.com.br
- **Portal de Parceiros:** https://partners.mercadolivre.com.br
- **n8n — Automatizar Links de Afiliado ML:** https://www.youtube.com/results?search_query=n8n+mercado+livre+afiliados
- **Rally de Vendas:** https://rallydevendas.com.br/
- **API geradora de links (Fripixel):** https://github.com/Fripixel/mercadolivre-link-de-afiliados
- **Blog Rally de Vendas — Como Criar Link de Afiliado no ML:** https://blog.rallydevendas.com.br/como-criar-link-de-afiliado-mercado-livre/
