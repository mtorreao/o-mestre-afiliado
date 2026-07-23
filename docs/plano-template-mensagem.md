# Plano de Melhoria — Template de Mensagem

## Resumo

Evoluir o sistema atual de template de mensagem (2 placeholders, textarea simples)
para um sistema completo com placeholders avançados, condicionais, seletor visual
no frontend e preview com dados reais.

---

## 1. Placeholders Avançados

### 1.1 Novos placeholders

| Placeholder | Origem | Exemplo de saída |
|---|---|---|
| `{texto_original}` | Texto completo da mensagem com link convertido | `"🔗 OFERTA: https://s.shopee.com.br/xxx"` |
| `{link_convertido}` | URL de afiliado isolada | `https://s.shopee.com.br/xxx` |
| `{link_original}` | URL original antes da conversão | `https://shopee.com.br/produto` |
| `{marketplace}` | `detectMarketplace()` | `shopee` / `mercadolivre` / `amazon` |
| `{marketplace_nome}` | Nome amigável do marketplace | `Shopee` / `Mercado Livre` / `Amazon` |
| `{source_group}` | Nome do grupo de origem (do evento) | `Ofertas Gerais` |
| `{target_group}` | Nome do grupo de destino (iteração) | `Meus Afiliados` |
| `{data}` | Data atual | `22/07/2026` |
| `{hora}` | Hora atual | `14:30` |
| `{data_hora}` | Data e hora completas | `22/07/2026 14:30` |

### 1.2 Onde implementar

**Worker** — `mirror-pipeline.ts` → função `buildTemplateMessage()`
- Receber `MirrorMessageEvent` completo + lista de `targetGroups` atuais
- Injetar `sourceGroupName`, `marketplace` nome amigável, timestamp
- Resolver placeholders antes de aplicar o template

### 1.3 Assinatura nova da `buildTemplateMessage`

```typescript
interface TemplateContext {
  originalText: string;
  originalUrl: string;
  convertedUrl: string | null;
  marketplace: string;
  sourceGroupName: string;
  targetGroupName: string;
  timestamp: Date;
}

function buildTemplateMessage(
  ctx: TemplateContext,
  template: string | null,
): string
```

---

## 2. Condicionais no Template

### 2.1 Sintaxe

```
{? marketplace = shopee}
🛒 Oferta imperdível da Shopee: {link_convertido}
{: marketplace = mercadolivre}
📦 Promoção do Mercado Livre: {link_convertido}
{: marketplace = amazon}
📚 Amazon recomenda: {link_convertido}
{:}
🔗 Oferta de afiliado: {link_convertido}
{/}
```

### 2.2 Gramática

```
template   := ( text | conditional )*
conditional := '{?' condition '}' template ( '{:' condition '}' template )* ( '{:}' template )? '{/}'
condition  := identifier '=' value        // marketplace = "shopee"
            | identifier '!=' value       // marketplace != "shopee"
```

Condicionais podem ser aninhadas (`{? ... {? ... } ... }`).

### 2.3 Implementação

**Novo arquivo**: `packages/shared/src/template-parser.ts`

```
parseConditionalTemplate(input: string, context: Record<string, string>): string
```

Lógica:
1. Scanner: percorre a string procurando `{?`
2. Se encontrar, extrai a condição → avalia → branch match → renderiza conteúdo
3. Se não encontrar branch match, renderiza `{:}` (else) se existir
4. Se erro de parsing, faz escape do bloco como texto literal (nunca quebra)

### 2.4 Separação de responsabilidades

```
buildTemplateMessage()   → resolve placeholders simples + chama parseConditionalTemplate
parseConditionalTemplate → avalia condicionais, faz merge
```

---

## 3. Validação de Placeholders

### 3.1 No worker (runtime)

- Se um placeholder `{algo}` não for reconhecido, **não substitui** — mantém literal
- Se o template resultar em string vazia após substituição, usa fallback (texto original)
- Log warning com o placeholder desconhecido

### 3.2 Na API (save time)

- Nova rota `POST /api/affiliate/validate-template`
- Recebe o template text, retorna placeholders desconhecidos
- Usado pelo frontend antes de salvar

### 3.3 Frontend (antes de salvar)

- Validação client-side:
  - Placeholders `{...}` não reconhecidos ficam destacados em vermelho
  - Aviso se não contiver `{texto_original}` nem `{link_convertido}` (template vazio → fallback)
  - Placeholders `{texto_original}` e `{link_convertido}` ausentes = usa fallback automático

---

## 4. Seletor de Placeholders no Frontend

### 4.1 Componente novo: `PlaceholderPicker`

```tsx
<PlaceholderPicker
  onInsert={(placeholder) => insertAtCursor(textareaRef, placeholder)}
  category="all" | "text" | "link" | "metadata" | "conditional"
/>
```

Botões no topo do textarea:

```
📝 [texto_original]   🔗 [link_convertido]   🏪 [marketplace_nome]
📅 [data]             ⏰ [hora]              👥 [source_group]  
🎯 [target_group]     
──── Condicionais ────
🔀 [se marketplace = shopee ...]
```

Cada botão insere o placeholder na posição do cursor.

### 4.2 Agrupamento visual

Linha 1: placeholders de **texto** (`{texto_original}`)
Linha 2: placeholders de **link** (`{link_convertido}`, `{link_original}`)
Linha 3: placeholders de **metadata** (`{marketplace}`, `{marketplace_nome}`, `{source_group}`, `{target_group}`, `{data}`, `{hora}`, `{data_hora}`)
Linha 4: **condicionais** (`{? marketplace = ...}` snippet)

### 4.3 Onde aplicar

- `MirrorFormPage.tsx` — substituir textarea atual por uma versão com PlaceholderPicker
- `MessageTemplateSection.tsx` — mesma melhoria

---

## 5. Preview com Conversão Real

### 5.1 Componente novo: `TemplatePreview`

```tsx
<TemplatePreview
  template={messageTemplate}
  testUrl={testUrl}
  onTestUrlChange={setTestUrl}
  marketplace={detectedMarketplace}
  onTest={() => fetchTestConversion(testUrl)}
  previewResult={previewData}
/>
```

### 5.2 Fluxo

1. Usuário cola uma URL real de produto (Shopee/ML/Amazon) no campo "URL de teste"
2. Clica "Testar template"
3. Frontend chama `POST /api/affiliate/test-conversion` (já existe) para obter o link convertido
4. Depois chama `POST /api/affiliate/preview-template` (novo) com:
   - `template`: texto do template
   - `testUrl`: URL original
   - `convertedUrl`: resultado da conversão
   - `marketplace`: detectado
   - `sourceGroupName`, `targetGroupName`: placeholders preenchidos
5. Backend aplica o template e retorna o resultado final
6. Preview mostra o texto exato que seria enviado para o grupo

### 5.3 API nova

```
POST /api/affiliate/preview-template
Body: {
  template: string;
  testUrl: string;
  convertedUrl: string | null;
  marketplace: string;
  sourceGroupName?: string;
  targetGroupName?: string;
}
Response: {
  success: boolean;
  preview: string;        // template renderizado
  unknownPlaceholders: string[];  // placeholders não reconhecidos
  isEmpty: boolean;       // true se resultou em string vazia
  length: number;         // caracteres (para alerta de limite WhatsApp)
}
```

---

## 6. Melhorias no Fluxo de Salvamento

### 6.1 Unificar: template global vs por mirror

Já existe fallback (mirror → affiliate). Melhorar:

- **Settings (WhatsApp)**: template global = template **padrão** para novos mirrors
- **MirrorFormPage**: template específico do mirror, com indicador "Usando template padrão" se vazio
- Botão "Resetar para template padrão" no MirrorFormPage

### 6.2 Visual indicator

- `MessageTemplateSection`: badge "📝 Padrão" se vazio, "✅ Personalizado" se preenchido
- `MirrorFormPage`: indicar se está usando o template do mirror ou o global

---

## 7. Plano de Implementação (Ordem)

### Fase 1 — Placeholders avançados + TemplateContext

| # | Arquivo | O que |
|---|---|---|
| 1.1 | `packages/shared/src/types.ts` | Adicionar `TemplateContext` type |
| 1.2 | `apps/worker/src/mirror-pipeline.ts` | Refatorar `buildTemplateMessage()` para receber `TemplateContext` |
| 1.3 | `apps/worker/src/mirror-pipeline.ts` | Resolver `marketplace_nome`, `data`, `hora`, `source_group`, `target_group` |
| 1.4 | `packages/shared/src/` | Extrair `resolvePlaceholders()` para shared (reuso no preview da API) |
| 1.5 | Atualizar chamada em `processMirrorMessage()` | Passar contexto real |

### Fase 2 — Condicionais

| # | Arquivo | O que |
|---|---|---|
| 2.1 | `packages/shared/src/template-parser.ts` | Implementar `parseConditionalTemplate()` |
| 2.2 | `packages/shared/src/template-parser.test.ts` | Testes unitários (básico, aninhado, else, sem match) |
| 2.3 | `apps/worker/src/mirror-pipeline.ts` | Integrar `parseConditionalTemplate` em `buildTemplateMessage()` |
| 2.4 | `apps/api/src/modules/affiliate/` | Usar no preview da API |

### Fase 3 — API de validação e preview

| # | Arquivo | O que |
|---|---|---|
| 3.1 | `apps/api/src/modules/affiliate/affiliate.routes.ts` | Rota `POST /api/affiliate/preview-template` |
| 3.2 | `apps/api/src/modules/affiliate/affiliate.routes.ts` | Rota `POST /api/affiliate/validate-template` |
| 3.3 | Validar placeholders desconhecidos | Compartilhar lógica de validação com o worker |

### Fase 4 — Frontend

| # | Arquivo | O que |
|---|---|---|
| 4.1 | `apps/web/src/components/PlaceholderPicker.tsx` | Novo componente de botões de inserção |
| 4.2 | `apps/web/src/components/TemplateEditor.tsx` | Novo textarea inteligente (textarea + PlaceholderPicker + validação inline) |
| 4.3 | `apps/web/src/components/TemplatePreview.tsx` | Preview com conversão real |
| 4.4 | `apps/web/src/pages/sections/MessageTemplateSection.tsx` | Usar TemplateEditor + TemplatePreview |
| 4.5 | `apps/web/src/pages/MirrorFormPage.tsx` | Usar TemplateEditor + TemplatePreview |
| 4.6 | Indicador global vs mirror | Badge "Usando template padrão" |

### Fase 5 — Limpeza e testes

| # | O que |
|---|---|
| 5.1 | Testes E2E do template no Playwright |
| 5.2 | Atualizar testes unitários do worker |
| 5.3 | Remover `MirrorConfigSection.tsx` do Settings se obsoleto (migrado para Mirrors) |

---

## 8. Risco e Mitigação

| Risco | Mitigação |
|---|---|
| Condicionais quebram template de usuário existente | Backward compatible: template sem condicionais continua funcionando |
| Placeholder não reconhecido vira texto literal | Log warning + fallback para template padrão se resultado vazio |
| Preview não reflete o grupo destino real | Placeholders `source_group`/`target_group` usam "Grupo de Origem" / "Grupo de Destino" como fallback no preview |
| Template muito longo | Já existe truncamento em 4000 chars |

---

## 9. Exemplos de Templates

### Básico
```
{texto_original}
```

### Com metadata
```
🏷️ OFERTA ({marketplace_nome})

{texto_original}

📅 Postado em: {data} às {hora}
```

### Com condicional + metadata
```
{? marketplace = shopee}
🛒 Shopee - Não perca!
{: marketplace = mercadolivre}
📦 Mercado Livre - Confira!
{: marketplace = amazon}
📚 Amazon - Oferta do dia!
{:}
🔗 Oferta especial
{/}

{link_convertido}

📍 Grupo: {source_group}
```
