# 🌐 Web — `@omestre/web`

> Interface React + Vite para conversão de links de afiliados. Consome a API REST via proxy do Vite.

---

## 🖥️ Funcionalidades

- Formulário para inserir URL de produto (Shopee ou Mercado Livre)
- Detecção automática do marketplace
- Exibição do link de afiliado gerado com botão "Copiar"
- Feedback visual de carregamento e erros
- Design responsivo em gradiente escuro

---

## 📸 Componentes

```
<App>
  ├── Header (título + descrição)
  ├── MarketplaceCards (Shopee / Mercado Livre)
  ├── Form (input URL + botão Converter)
  ├── ErrorBanner (se houver erro)
  └── ResultCard (se conversão bem-sucedida)
      ├── Header (✅/❌ + marketplace + método)
      ├── Original URL
      └── Affiliate Link + botão Copiar
```

### `App.tsx`

Componente principal que orquestra todo o estado da aplicação.

**Estado local:**
- `url: string` — valor do input
- `loading: boolean` — indicador de carregamento
- `result: ConversionResult | null` — resultado da conversão
- `error: string | null` — mensagem de erro

### Fluxo de conversão

```
Usuário digita URL → clica "Converter"
    │
    ├── fetch POST /api/convert
    │   ├── Vite proxy → http://localhost:3000/api/convert
    │   │
    │   ├── Response: { success: true, affiliateUrl: "...", ... }
    │   │   └── Renderiza ResultCard com link + botão Copiar
    │   │
    │   └── Response: { success: false, error: "..." }
    │       └── Renderiza ErrorBanner
    │
    └── Erro de rede
        └── Renderiza ErrorBanner
```

---

## 🚀 Como Rodar

```bash
# Desenvolvimento (com hot-reload)
bun run dev:web

# Ou direto na pasta
cd apps/web && bunx vite
```

A aplicação será servida em `http://localhost:5173`.

### Pré-requisitos

A API deve estar rodando em `http://localhost:3000` (ou configure o proxy no `vite.config.ts`).

```bash
# Em outro terminal
bun run dev:api
```

---

## 🔧 Proxy do Vite

Em desenvolvimento, o Vite faz proxy de `/api/*` para a API:

```typescript
// vite.config.ts
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
  },
},
```

Isso elimina problemas de CORS em desenvolvimento — o frontend faz requisições para a mesma origin.

---

## 📦 Build para Produção

```bash
bun run build:web
# ou
cd apps/web && bunx vite build
```

Gera os arquivos estáticos em `apps/web/dist/`:
```
dist/
├── index.html
├── assets/
│   ├── index-abc123.js
│   └── index-abc123.css
└── favicon.svg
```

Para servir em produção, use qualquer servidor estático (Nginx, S3, Cloudflare Pages):

```bash
npx serve dist -l 5173
```

Em produção, configure o servidor web para fazer proxy reverso de `/api` para a API,
ou remova o proxy e configure CORS na API para aceitar a origin de produção.

---

## 🎨 Estilo

- **Background:** gradiente `#0f172a → #1e293b` (slate escuro)
- **Cards:** `#1e293b` com borda sutil
- **Destaque:** roxo (`#6366f1` / `#818cf8`) no header e botão
- **Marketplace Shopee:** laranja (`#ee4d2d`) — cor oficial Shopee
- **Marketplace ML:** amarelo (`#fff059`) — cor oficial Mercado Livre
- **Fonte:** system-ui nativa

---

## 🧩 Dependências

| Pacote | Versão | Uso |
|--------|--------|-----|
| `react` | ^19.0.0 | UI library |
| `react-dom` | ^19.0.0 | Renderização DOM |
| `vite` | ^6.0.0 | Bundler / dev server |
| `@vitejs/plugin-react` | ^4.3.0 | React Fast Refresh |


## 📁 Estrutura de Arquivos

```
apps/web/
├── index.html            # HTML entry point
├── vite.config.ts        # Vite config + proxy
├── tsconfig.json         # TypeScript config
├── package.json          # Dependências
├── public/
│   └── favicon.svg       # Ícone da aba
└── src/
    ├── main.tsx          # ReactDOM.createRoot
    └── App.tsx           # Componente principal
```
