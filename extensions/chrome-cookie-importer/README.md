# 🍪 O Mestre Afiliado — Chrome Cookie Importer

Extensão Chrome que importa cookies de sessão do Mercado Livre para gerar **links curtos de afiliado** (meli.la) automaticamente.

## Por que isso existe?

A API de links curtos do ML (`/affiliate-program/api/v2/affiliates/createLink`) exige **cookies de sessão** (incluindo HttpOnly), que JavaScript comum não consegue ler. A extensão usa a API `chrome.cookies.getAll()` que tem acesso a todos os cookies.

## Instalação (manual)

1. Abra o Chrome e vá para `chrome://extensions/`
2. Ative **"Modo do desenvolvedor"** (canto superior direito)
3. Clique em **"Carregar sem compactação"**
4. Selecione a pasta `extensions/chrome-cookie-importer/`
5. A extensão aparecerá na barra de ferramentas como 🍪

## Como usar

1. **Faça login** no Mercado Livre (`mercadolivre.com.br`) com a conta de afiliado
2. **Abra a extensão** clicando no ícone 🍪
3. **Selecione o afiliado** no dropdown (a lista vem do seu servidor)
4. **Clique em "Importar Cookies"**
5. ✅ Pronto! Agora o protótipo gera links curtos pra essa conta

## Como funciona

```
Extensão (chrome.cookies.getAll)
    │ Lê TODOS os cookies do ML (incluindo HttpOnly)
    ▼
Concatena como "nome=valor; nome=valor; ..."
    │
    ▼
PUT /api/ml/affiliates/:mlUserId
    { sessionCookies: "..." }
    │
    ▼
Backend armazena no PostgreSQL (tabela `ml_affiliates`)
    │
    ▼
POST /api/ml/convert → tenta link curto via API interna do ML
    ├── ✅ Cookies válidos → https://meli.la/XXXXX
    └── ❌ Cookies expirados → fallback URL params
```

## Estrutura

```
extensions/chrome-cookie-importer/
├── manifest.json          # Manifest v3
├── popup.html             # Interface do popup
├── popup.js               # Lógica (cookies + API)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Permissões

- `cookies` — leitura de cookies (incluindo HttpOnly)
- `https://*.mercadolivre.com.br/*` — cookies do ML
- `https://dev.omestreafiliado.com.br/*` — envio para a API
- `http://127.0.0.1:5441/*` — ambiente dev local
- `http://127.0.0.1:5442/*` — ambiente dev local
