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
- redige valores sensíveis em mensagens de erro.

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
- captura de ofertas como rascunho;
- campanhas e suporte a Shopee/Amazon.
