# 🍪 O Mestre Afiliado — Extensão Chrome

Extensão Manifest V3 para sincronizar e validar a sessão do Mercado Livre usada pelo O Mestre Afiliado.

## Funcionalidades implementadas

- detecta se a aba ativa está em um domínio Mercado Livre;
- lista afiliados disponíveis pela API;
- seleciona automaticamente o afiliado quando existe apenas um, ou restaura o último afiliado usado;
- lê cookies HttpOnly somente após ação explícita do usuário;
- deduplica cookies e envia a sessão para a API;
- não exibe nem persiste o cookie header na extensão;
- valida a sessão no endpoint de Link Builder após a sincronização;
- mostra estado sanitizado: válida, expirada ou ainda não validada;
- mostra o `melitat` detectado sem exibir credenciais;
- salva a URL da API sem credenciais, query string ou hash;
- oferece página de opções;
- agenda lembretes locais para sessões marcadas como expiradas;
- redige valores sensíveis em mensagens de erro;
- testa e sincroniza cookies do Magazine Você (Magalu OneLink);
- logger estruturado opcional (`extLog`) para diagnóstico de fluxo de auth;
- sink opcional que envia logs para `POST /api/extension/logs` (auth via API key dedicada).

## Envio de logs para a API

A extensão pode enviar logs estruturados para diagnóstico remoto. Auth via
API key dedicada (escopo apenas inserir — não dá pra ler nada).

### Configuração

1. **Servidor**: gere uma API key e configure no `.env`:

   ```bash
   EXTENSION_LOGS_API_KEY=$(openssl rand -hex 32)
   ```

   Se vazia, o endpoint rejeita todas as requisições (fail-closed).

2. **Migration**: aplique a tabela `extension_logs`:

   ```bash
   bun run db:migrate   # aplica 0017_add_extension_logs.sql
   ```

3. **Extensão**: abra `chrome://extensions/` → O Mestre Afiliado → **Configurações**
   → cole a mesma key em **API key (opcional)** → **Salvar**.

4. **Popup**: marque **📤 Enviar logs para a API**. Pronto.

### Como funciona

- SW mantém buffer em memória + persiste em `chrome.storage.local` (sobrevive
  a restart do service worker).
- Flush automático a cada 10s OU quando buffer passa de 20 entries.
- Batch máximo: 100 entries (limite do servidor).
- Rate limit: 5 requests / 10s por sessionId.
- Botão **🚀 Enviar agora** no popup força flush imediato.
- Status visível no popup: "Último envio: há 30s (12 logs) · Buffer: 8".

### Endpoints

- `POST /api/extension/logs` — recebe batch. Auth via header
  `X-Extension-Logs-Key`. Apenas inserir. Não há GET público.

### Privacidade

- O token JWT **nunca** é enviado — apenas `userEmail` (se logado) e `tabUrl`.
- Eventos sensíveis passam por redação antes do envio.
- API key fica em `chrome.storage.local` (criptografado pelo Chrome no SO).

## Debug de login

A extensão tem um logger opcional que escreve em JSON estruturado no console
do service worker (mesmo padrão dos workers do projeto). Use para entender
por que o login não está sendo detectado.

1. Abra o popup da extensão
2. Marque **🔧 Logs de debug (console do service worker)**
3. Vá em `chrome://extensions/` → clique em **Service worker** (link azul) da extensão
4. Recarregue a aba do painel (`https://dev.omestreafiliado.com.br`)
5. Clique **🔄 Verificar login** no popup

Eventos emitidos (filtrar por `[extensão]` no console do service worker):

| Evento                            | Quando                                        |
| --------------------------------- | --------------------------------------------- |
| `service-worker.boot`             | SW inicializou                                |
| `service-worker.installed`        | `onInstalled` (primeira vez)                  |
| `service-worker.startup`          | `onStartup` (Chrome iniciou)                  |
| `auth-sync.loaded`                | Content script rodou na página do painel      |
| `auth-sync.token.found`           | Leu token do `localStorage`                   |
| `auth-sync.token.absent`          | Não encontrou token                           |
| `auth-sync.message.ack`           | SW confirmou recebimento                      |
| `message.set-auth-token.received` | SW recebeu o token do content script          |
| `verify-auth.fetch.start`         | SW vai chamar `/api/auth/me`                  |
| `verify-auth.fetch.response`      | Resposta HTTP chegou                          |
| `verify-auth.success`             | Token válido, auth gravado                    |
| `verify-auth.invalid`             | Token expirado/inválido                       |
| `verify-auth.network.error`       | Falha de rede                                 |
| `popup.init`                      | Popup abriu                                   |
| `popup.refreshAuth.click`         | Botão "Verificar login" clicado               |
| `popup.storage.authState.changed` | Storage detectou novo authState (auto-update) |
| `popup.debug-toggle.changed`      | Toggle de debug mudou                         |

Os eventos `info` aparecem com debug desligado; `debug` requer o toggle ativo.

A partir da v1.6.0 o popup escuta `chrome.storage.onChanged` e re-renderiza
automaticamente quando o SW grava novo `authState`/`sessionState` — abrir o
popup antes do SW terminar a validação não exige mais fechar e abrir de novo.

## Instalação manual

1. Abra `chrome://extensions/`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione `extensions/chrome-cookie-importer/`.
5. Após alterações, clique em **Recarregar** no card da extensão.

## Uso

1. Faça login no Mercado Livre.
2. Abra o popup da extensão.
3. Configure a URL da API em **Configurações**, se necessário.
4. Selecione o afiliado, caso existam vários.
5. Clique em **Sincronizar e validar**.
6. Confira o estado da sessão e a etiqueta detectada.

A extensão não sincroniza cookies silenciosamente em background. O service worker apenas mantém o estado sanitizado e agenda lembretes; a leitura e o envio da sessão exigem ação explícita.

## Segurança

- Cookies não são gravados em `chrome.storage`.
- Cookies não são exibidos no popup, preview, logs ou mensagens de erro.
- A extensão não recebe tokens OAuth do Mercado Livre.
- A API deve ser uma origem confiável; ambientes locais são suportados somente para desenvolvimento.
- A validação é feita pelo backend existente, que mantém `sessionCookies` criptografado no banco.

## Testes locais

```bash
bun test extensions/chrome-cookie-importer/tests/pure.test.js
```

Os testes cobrem normalização da API, domínios ML, deduplicação, metadados sem segredo e redaction.

## Próximas fases

- menu de contexto para gerar link de afiliado;
- conversão contextual de produtos;
- campanhas e suporte a Shopee/Amazon.
