# NotebookLM — Prompt para Análise do Programa de Afiliados Mercado Livre

> Cole este prompt no **NotebookLM** (https://notebooklm.google.com) após adicionar as fontes listadas abaixo.

---

## Fontes para adicionar ao Notebook

Adicione estas URLs como fontes antes de usar o prompt:

1. https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
2. https://developers.mercadolivre.com.br/pt_br/api-docs
3. https://afiliados.mercadolivre.com.br/ (requer login — faça uma captura da página de ajuda/FAQ e salve como PDF ou texto)
4. https://centraldeparceiros.mercadolivre.com.br/
5. https://partners.mercadolivre.com.br/
6. https://developers.mercadolivre.com.br/devcenter

Se conseguir acessar, adicione também:
- Termos e condições do programa de afiliados (geralmente link no rodapé do dashboard)
- Documentação da API de Search: https://api.mercadolibre.com/sites/MLB/search?q=exemplo (resposta JSON)

---

## Prompt

Analise a documentação oficial do programa de afiliados do Mercado Livre e do portal de desenvolvedores (developers.mercadolivre.com.br) para responder às perguntas abaixo. Seja específico com endpoints, payloads, status HTTP e valores exatos sempre que possível.

### 1. Códigos de Erro da API

Para os endpoints `POST https://api.mercadolibre.com/oauth/token` e `POST https://api.mercadolivre.com/affiliates/link-builder`:

- Quais códigos de erro HTTP cada um pode retornar? (401, 403, 422, 429, 500, etc.)
- Qual o formato e conteúdo do body de erro? (ex: `{"message": "...", "error": "..."}`)
- Existe limite de tentativas de refresh_token inválido?
- O que acontece se o `authorization_code` expirar antes da troca?
- Como a API sinaliza que o `refresh_token` foi invalidado?

### 2. Rate Limits

- Qual o limite de requisições por segundo/minuto/dia para a API autenticada (com OAuth)?
- Qual o limite para a API pública (sem autenticação)?
- O rate limit é por `access_token`, por IP, ou por App ID?
- O header de resposta inclui informações de rate limit (ex: `X-RateLimit-Remaining`)?
- Existe rate limit específico para o endpoint `/affiliates/link-builder` diferente da API geral?
- Como o ML notifica que o limite foi excedido? (status HTTP, body, headers)

### 3. Diferenças Regionais

O Mercado Livre opera em vários países:
- Brasil (mercadolivre.com.br)
- Argentina (mercadolibre.com.ar)
- México (mercadolibre.com.mx)
- Chile (mercadolibre.cl)
- Colômbia (mercadolibre.com.co)

Para cada país:
- Os endpoints de OAuth (`/oauth/token`) e Link Builder (`/affiliates/link-builder`) são os mesmos ou mudam?
- O domínio da API muda? (ex: `api.mercadolibre.com` vs `api.mercadolibre.com.ar`)
- O programa de afiliados existe em todos os países?
- O escopo de autorização (read/write) é o mesmo?

### 4. API de Relatórios e Métricas

- Existe uma API REST para consultar cliques, conversões e comissões geradas?
- Qual o endpoint para obter relatório de performance dos links de afiliado?
- É possível filtrar por período (data inicial/final)?
- O relatório pode ser exportado em JSON/CSV ou apenas via painel web?
- Existe endpoint para listar TODOS os links de afiliado gerados por uma conta?

### 5. Webhooks / Callbacks

- O programa de afiliados oferece webhooks para notificar quando uma venda é confirmada?
- Existe callback de clique no link de afiliado?
- Se sim, qual o payload format? Como configurar o webhook?
- Se não, qual a alternativa recomendada para notificações em tempo real?

### 6. Tabela de Comissões

- Quais as categorias de produto no Mercado Livre?
- Qual o percentual de comissão para cada categoria no programa de afiliados?
- A comissão é calculada sobre o valor final do produto (com frete?) ou apenas sobre o valor do anúncio?
- Existe comissão reduzida para produtos com frete grátis? E para produtos em oferta/desconto?
- A tabela de comissões varia por país?

### 7. Etiqueta de Uso (Tracking Tag)

- Como configurar a "etiqueta de uso" / "usage tag" via API?
- Quantas etiquetas diferentes podem ser criadas?
- É possível criar/gerenciar etiquetas programaticamente ou só pelo painel?
- Como a etiqueta aparece no link gerado (qual parâmetro na URL)?

### 8. Políticas e Restrições

- Quais produtos/serviços são proibidos de divulgar como afiliado?
- Existe limite mínimo de cliques para permanecer no programa?
- O que caracteriza uma violação dos termos de uso?
- Existe sanção por gerar links para os próprios produtos?
- É permitido usar encurtadores de link próprios antes do `meli.la`?
- Pode-se usar a API para disparar links em massa via WhatsApp/email?

---

## Como usar este prompt

1. Abra https://notebooklm.google.com e crie um novo notebook
2. Adicione as URLs listadas em "Fontes para adicionar ao Notebook" como fontes
3. Cole o prompt inteiro na caixa de chat do NotebookLM
4. O NotebookLM analisará as fontes e responderá cada pergunta com base no conteúdo delas
5. As respostas podem ser usadas para atualizar o arquivo `docs/marketplaces/mercadolivre/api-reference.md` no projeto
