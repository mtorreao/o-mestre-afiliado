# Chrome Extension — Testes locais

Os testes da extensão não dependem do Chrome nem da rede. Eles validam funções puras em `tests/pure.test.js`.

```bash
bun test extensions/chrome-cookie-importer/tests/pure.test.js
```

As funções testadas incluem:

- normalização da URL da API;
- identificação de domínios do Mercado Livre;
- deduplicação de cookies;
- criação do cookie header sem expor valores nos metadados de UI;
- redaction de mensagens com possíveis cookies.

A extensão continua sendo carregada manualmente em `chrome://extensions` durante a validação de integração.
