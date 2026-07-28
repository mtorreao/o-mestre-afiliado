# Plano de evolução da extensão Chrome

Status: Fases 0 e 1 implementadas na extensão; Fases 2–5 planejadas
Data: 2026-07-27
Escopo: `extensions/chrome-cookie-importer/`

## 1. Resumo executivo

A extensão hoje resolve uma necessidade técnica específica: ler cookies HttpOnly da sessão do Mercado Livre e enviá-los à API para habilitar a geração de links curtos `meli.la`. Ela já automatiza a detecção inicial do Mercado Livre e tenta descobrir o `melitat`, mas ainda funciona como um popup manual, depende de uma URL de API digitada, expõe uma seleção global de afiliados e não possui diagnóstico, renovação, ações contextuais ou integração com o fluxo diário de criação de ofertas.

A recomendação é evoluí-la para uma **Central de Operações do Afiliado**, mantendo o importador de cookies como capacidade central, mas adicionando automações graduais e de baixo risco:

1. conexão segura e configuração mínima;
2. sincronização/validação automática da sessão;
3. conversão contextual de produtos;
4. captura de ofertas e organização de links;
5. alertas e saúde da sessão;
6. somente depois, automações assistidas de páginas e campanhas.

A extensão não deve automatizar publicação em WhatsApp, login, CAPTCHA, cliques em massa, scraping agressivo ou ações irreversíveis sem confirmação explícita.

## 2. Estado atual observado

### Manifest

- Manifest V3, versão `1.0.0`.
- Permissões: `cookies`, `storage`, `tabs`, `scripting`.
- Host permissions amplas para domínios Mercado Livre e API de desenvolvimento.
- Apenas `action.default_popup`; não há service worker, context menu, alarms, notifications ou opções.

Arquivo: `extensions/chrome-cookie-importer/manifest.json`.

### Popup

`popup.js` atualmente:

- restaura uma `apiUrl` salva no `chrome.storage.local`;
- verifica se a aba ativa pertence ao Mercado Livre;
- busca todos os afiliados em `GET /api/ml/affiliates`;
- exige seleção manual de `mlUserId`;
- lê cookies dos domínios configurados com `chrome.cookies.getAll()`;
- deduplica por nome + path e envia um cookie header concatenado;
- grava em `PUT /api/ml/affiliates/:mlUserId`;
- navega uma aba existente para `/afiliados/linkbuilder` para extrair `tag_in_use`;
- salva o `melitat` detectado em uma segunda chamada PUT.

### Backend já disponível

A API já oferece base para a evolução:

- `GET /api/ml/affiliates`, retornando sumários sem tokens;
- `PUT /api/ml/affiliates/:mlUserId`, aceitando `meliid`, `melitat` e `sessionCookies`;
- `POST /api/ml/affiliates/:mlUserId/validate-cookies`, que acessa o Link Builder, identifica cookies expirados e tenta detectar `tag_in_use`;
- o repositório criptografa `sessionCookies` antes do armazenamento e descriptografa somente no uso interno;
- conversão ML já tenta link curto e possui fallback por parâmetros.

Conclusão: a primeira evolução deve reutilizar esses contratos, evitando criar outro armazenamento de cookies ou duplicar a validação no navegador.

## 3. Aplicações possíveis

### 3.1. Importação e saúde da sessão — prioridade máxima

- detectar automaticamente quando a aba ativa é um domínio ML;
- identificar se há sessão logada antes de abrir o popup;
- escolher automaticamente o afiliado vinculado ao usuário da plataforma, quando houver vínculo;
- importar cookies sem exigir seleção quando existir apenas um afiliado elegível;
- chamar `validate-cookies` após o upload, em vez de duplicar a validação por scraping no popup;
- exibir status: válido, expirado, não autenticado, API indisponível, tag detectada;
- registrar `lastSyncAt`, quantidade de cookies e último resultado localmente, sem persistir valores de cookie;
- usar `chrome.alarms` para lembrete de revalidação, não para ler/enviar cookies em segundo plano sem uma ação clara do usuário.

### 3.2. Conversão contextual de produto — alto valor e baixo risco

Em páginas de produto do Mercado Livre:

- adicionar uma ação no menu de contexto: “Gerar link de afiliado”;
- adicionar botão/overlay opcional “Converter com O Mestre Afiliado”;
- enviar somente a URL da página à API, usando a conta selecionada/vinculada;
- copiar automaticamente o resultado para o clipboard após confirmação;
- mostrar link curto, fallback, marketplace, etiqueta utilizada e mensagem de erro;
- preservar a página original e não modificar formulários do marketplace.

A mesma abstração pode suportar Shopee, Amazon e outros marketplaces, mas cada domínio deve ser habilitado separadamente e somente depois de validar o contrato de conversão.

### 3.3. Captura de oferta para o pipeline

- capturar URL, título, imagem principal, preço visível e marketplace da página atual;
- permitir “Salvar oferta” em uma lista pessoal na plataforma;
- anexar uma nota, campanha ou grupo de destino;
- enviar a oferta para o pipeline existente apenas como rascunho;
- permitir revisar e converter antes de qualquer espelhamento.

A captura deve preferir dados estruturados/DOM da página e ter tolerância a mudanças de layout. Não deve depender de endpoints privados do marketplace para dados que já estão visíveis ao usuário.

### 3.4. Biblioteca de links e campanhas

- selecionar `melitat`/tracking ID conforme campanha;
- permitir uma campanha padrão por domínio ou origem;
- marcar links usados recentemente;
- guardar metadados não sensíveis: URL original, URL convertida, marketplace, campanha, timestamp e resultado;
- abrir a tela da plataforma já filtrada pela campanha.

A fonte de verdade deve continuar sendo a API/plataforma. A extensão guarda apenas cache e preferências locais.

### 3.5. Diagnóstico e alertas

- badge com estado da sessão;
- notificação quando uma tentativa de conversão indicar cookies expirados;
- botão “Reimportar agora” que abre o Mercado Livre e orienta o usuário;
- diagnóstico de permissões, API configurada e conectividade;
- página de suporte com eventos técnicos sem valores de cookie ou tokens.

### 3.6. Automação assistida de pesquisa

Fase posterior, sempre com confirmação:

- extrair dados da página atual para preencher um rascunho;
- verificar se uma URL já foi salva/converteu antes;
- detectar páginas de produto inelegíveis somente a partir do resultado da API;
- comparar preço/título/imagem entre páginas abertas pelo usuário;
- criar uma fila local de URLs selecionadas pelo usuário.

Não recomendar neste ciclo:

- varrer automaticamente resultados de busca em massa;
- coletar dados de usuários terceiros;
- alterar preços, carrinhos ou checkout;
- publicar automaticamente em WhatsApp/redes sociais;
- burlar CAPTCHA, rate limit ou controles de acesso;
- usar a extensão como cofre genérico de cookies.

## 4. Princípios de segurança e conformidade

1. **Minimizar permissões.** Começar com `cookies`, `storage`, `activeTab` e `scripting` apenas onde necessários. Avaliar trocar host permissions amplas por `optional_host_permissions` e solicitar acesso por domínio.
2. **Não armazenar cookie bruto na extensão.** Ler em memória, enviar somente por HTTPS à API configurada e limpar referências após o uso.
3. **Não exibir cookie no popup.** O preview atual mostra parte do cookie header; substituir por quantidade, domínios e timestamp. Valores de cookie nunca devem aparecer em tela, log ou erro.
4. **Restringir API permitida.** A primeira execução deve parear com uma origem HTTPS conhecida. URL local deve ser uma opção explícita de desenvolvimento.
5. **Autorização por usuário.** Não listar afiliados globalmente em produção sem autenticação/pareamento. A extensão deve usar uma sessão própria da plataforma ou um código de pareamento de uso único.
6. **Escopo por domínio.** Content scripts e ações de página só devem rodar em domínios explicitamente suportados.
7. **Transparência.** Toda sincronização de cookies deve ser iniciada pelo usuário, com texto claro sobre destino e finalidade.
8. **Retenção mínima.** API pode manter a sessão criptografada para o Link Builder, mas a extensão não deve manter cópia persistente.
9. **Falhas seguras.** Se a API, a origem ou a autenticação não forem confiáveis, bloquear envio e orientar o usuário.
10. **Revisar políticas atuais do Chrome Web Store e termos dos marketplaces** antes de publicar externamente. A primeira distribuição deve permanecer privada/manual, se a extensão continuar sendo uma ferramenta interna.

## 5. Arquitetura alvo

```text
Popup / Options / Content UI
          │
          ▼
     runtime.sendMessage
          │
          ▼
MV3 service worker
  ├─ pairing/auth
  ├─ cookie sync (ação explícita)
  ├─ API client
  ├─ contextMenus
  ├─ alarms/notifications
  └─ storage de preferências e cache sem segredo
          │ HTTPS
          ▼
API O Mestre Afiliado
  ├─ afiliado vinculado ao usuário
  ├─ PUT sessionCookies criptografado
  ├─ validate-cookies
  ├─ conversão de URL
  └─ captura/rascunho de oferta (novo contrato)
```

### Separação sugerida de arquivos

```text
extensions/chrome-cookie-importer/
├── manifest.json
├── src/
│   ├── service-worker.js
│   ├── popup.html
│   ├── popup.js
│   ├── options.html
│   ├── options.js
│   ├── content/
│   │   ├── mercadolivre.js
│   │   ├── shopee.js
│   │   └── shared.js
│   ├── lib/
│   │   ├── api-client.js
│   │   ├── cookies.js
│   │   ├── storage.js
│   │   └── domains.js
│   └── styles.css
├── icons/
└── README.md
```

A migração pode ser incremental. Não é necessário transformar o projeto inteiro em TypeScript antes de validar o fluxo.

## 6. Roadmap faseado

### Progresso de implementação

| Fase                                  | Estado          | Entregue nesta worktree                                                                                                                         |
| ------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Contrato e segurança              | ✅ Implementada | Service worker, opções, validação da URL da API, remoção do preview sensível, helpers puros e redaction                                         |
| 1 — Sincronização inteligente         | ✅ Implementada | Seleção automática quando há um afiliado, sincronização explícita, validação via backend, estado local sanitizado e lembrete de sessão expirada |
| 2 — Conversão contextual              | ⏳ Planejada    | Próxima fase                                                                                                                                    |
| 3 — Captura de oferta e rascunho      | ⏳ Planejada    | Depende da Fase 2                                                                                                                               |
| 4 — Multi-marketplace e campanhas     | ⏳ Planejada    | Depende da validação do fluxo ML                                                                                                                |
| 5 — Operação assistida e distribuição | ⏳ Planejada    | Fase final                                                                                                                                      |

Observação: pareamento por código de uso único permanece como reforço futuro. Nesta implementação, a extensão preserva o contrato atual de listagem de afiliados e seleciona automaticamente apenas quando há uma opção ou um afiliado previamente validado.

### Ordem executiva atualizada

| Ordem | Fase                              | Resultado de negócio                                    | Bloqueia              |
| ----- | --------------------------------- | ------------------------------------------------------- | --------------------- |
| 0     | Contrato e segurança              | Importador atual sem exposição desnecessária de cookies | Todas as demais fases |
| 1     | Sincronização inteligente         | Sessão ML sincronizada e validada em um fluxo           | Conversão contextual  |
| 2     | Conversão contextual              | Produto aberto convertido com poucos cliques            | Captura de oferta     |
| 3     | Captura de oferta e rascunho      | Produto pesquisado vira rascunho revisável              | Multi-marketplace     |
| 4     | Multi-marketplace e campanhas     | Uma experiência para ML, Shopee e Amazon                | Operação/distribuição |
| 5     | Operação assistida e distribuição | Extensão auditável, suportável e distribuível           | —                     |

Regra de execução: não começar a fase seguinte antes de cumprir os critérios de aceite da anterior. A Fase 0 é obrigatória mesmo que a primeira entrega permaneça restrita ao Mercado Livre.

### Entrega inicial recomendada

O primeiro ciclo de implementação deve combinar somente os itens abaixo:

1. adicionar service worker MV3 e cliente centralizado da API;
2. remover o preview do cookie header e qualquer log de valor sensível;
3. introduzir pareamento/ownership do usuário e afiliado padrão;
4. manter a leitura de cookies em memória, acionada por clique explícito;
5. enviar os cookies para o backend e chamar `validate-cookies`;
6. exibir estado sanitizado da sessão e `melitat` detectado;
7. adicionar testes locais de redaction, seleção de afiliado, estados de API e permissões.

Fora do primeiro ciclo: content script, overlay, menu contextual, Shopee/Amazon, captura de preço e publicação no pipeline.

### Gate de promoção entre fases

Cada fase só pode ser promovida quando houver:

- critérios funcionais da fase atendidos;
- typecheck/build dos apps afetados sem regressão;
- testes unitários da lógica pura;
- teste manual de segurança da extensão;
- documentação do comportamento e das permissões atualizada;
- confirmação de que a extensão não interfere no mirror existente.

### Fase 0 — Contrato e segurança

Objetivo: tornar a base segura e observável sem adicionar automação de página.

Por que nesta posição: o fluxo atual envia credenciais sensíveis e não deve receber novas superfícies antes de reduzir o risco.

Entregas:

- remover preview de cookie bruto;
- validar e normalizar `apiUrl`;
- pareamento/autenticação da extensão com a plataforma;
- associar extensão a um usuário/afiliado, sem dropdown global como padrão;
- `service-worker.js`
- centralizar chamadas no `api-client`;
- mover leitura de cookies para função isolada;
- criar logs locais redigidos;
- adicionar página de opções para API, ambiente e consentimento;
- atualizar README com modelo de ameaça e procedimento de revogação.

Dependências: nenhum endpoint novo obrigatório se o pareamento inicial usar autenticação já existente; caso contrário, criar endpoint de código de pareamento de uso único.

Critérios de aceite:

- nenhum valor de cookie aparece na UI ou console;
- sem API pareada, o envio é bloqueado;
- `PUT` ocorre somente após clique explícito;
- `validate-cookies` é o mecanismo de diagnóstico pós-importação;
- testes de validação estática da extensão passam.

Commit sugerido: `refactor(extension): centralizar sincronizacao segura da sessao ml`.

Saída esperada: importador atual mais seguro, sem alteração no fallback de conversão.

### Fase 1 — Sincronização inteligente

Objetivo: reduzir trabalho manual sem enviar cookies silenciosamente.

Por que nesta posição: entrega ganho imediato no caso de uso existente e cria uma base confiável para as demais ações.

Entregas:

- detectar domínio e estado da aba ativa;
- seleção automática quando houver um afiliado vinculado;
- botão “Sincronizar e validar”;
- resultado estruturado: sessão válida/expirada, `melitat`, nickname e timestamp;
- badge de saúde no ícone;
- `chrome.alarms` para lembrete de sessão potencialmente expirada;
- reimportação guiada, sem execução invisível em background.

Dependências: Fase 0 e endpoint atual de validação.

Critérios de aceite:

- usuário com um afiliado vinculado conclui sincronização em um fluxo;
- sessão expirada mostra ação clara de correção;
- nenhuma navegação destrutiva da aba ativa sem consentimento;
- o popup não precisa abrir uma página de Link Builder para detectar tag.

Commit sugerido: `feat(extension): automatizar sincronizacao e diagnostico da sessao`.

Saída esperada: importação quase automática, mantendo consentimento para leitura/envio.

### Fase 2 — Conversão contextual

Objetivo: transformar qualquer produto aberto no Chrome em link de afiliado com poucos cliques.

Por que nesta posição: é a aplicação com maior valor diário e menor complexidade de negócio depois da sessão.

Entregas:

- `contextMenus` para URL da página/seleção;
- comando “Gerar link de afiliado”;
- popup de resultado com copiar, abrir e tentar novamente;
- suporte inicial apenas a Mercado Livre;
- endpoint de conversão autenticado por usuário, não por lista global;
- telemetria mínima de sucesso/erro sem URL sensível além do necessário.

Dependências: pareamento da Fase 0 e sincronização da Fase 1.

Critérios de aceite:

- conversão funciona em produto ML elegível;
- fallback é mostrado claramente;
- produto inelegível não é tratado como erro de sessão;
- nenhuma ação de publicação é realizada.

Commit sugerido: `feat(extension): adicionar conversao contextual de produtos ml`.

Saída esperada: extensão passa de utilitário de manutenção para ferramenta diária.

### Fase 3 — Captura de oferta e rascunho

Objetivo: capturar produto e iniciar o fluxo de espelhamento sem publicar automaticamente.

Por que nesta posição: aproveita a conversão contextual, mas exige contrato de dados e UI de revisão.

Entregas:

- extrator por marketplace com dados visíveis/estruturados;
- botão “Salvar como rascunho”;
- metadados de campanha/grupo;
- endpoint de rascunho idempotente;
- tela na plataforma para revisar e reenviar;
- proteção contra `convertedUrl=null` e incompatibilidade de parâmetros, alinhada às regras de segurança do mirror.

Dependências: Fase 2, modelo de rascunho na API/web e regras do pipeline.

Critérios de aceite:

- reabrir a mesma página não cria duplicatas silenciosas;
- rascunho exibe URL original, dados extraídos e estado de conversão;
- nada é enviado ao WhatsApp sem revisão/configuração já existente;
- dados extraídos incorretamente podem ser editados na plataforma.

Commit sugerido: `feat(extension): capturar ofertas como rascunho`.

Saída esperada: ponte segura entre pesquisa no navegador e pipeline de ofertas.

### Fase 4 — Multi-marketplace e campanhas

Objetivo: tornar a extensão uma camada comum para ML, Shopee e Amazon.

Por que nesta posição: só vale generalizar depois de validar a experiência ML.

Entregas:

- adaptadores por domínio;
- seleção de `melitat`/tracking ID/campanha;
- visualização de região e identificador utilizado;
- regras de URL e elegibilidade por marketplace;
- testes com fixtures de páginas e URLs, sem depender da rede.

Dependências: Fase 3 e contratos de conversão de cada marketplace.

Critérios de aceite:

- marketplace não suportado não injeta UI;
- cada resultado identifica a conta/campanha usada;
- falha de credencial não cai silenciosamente em outra conta;
- todos os conversores seguem o padrão `success` sem throw de negócio.

Commit sugerido: `feat(extension): suportar campanhas multi-marketplace`.

Saída esperada: uma experiência de operação consistente, sem acoplar a extensão a um marketplace específico.

### Fase 5 — Operação assistida e distribuição

Objetivo: consolidar alertas, diagnósticos e decidir se haverá distribuição externa.

Por que nesta posição: distribuição aumenta responsabilidade de segurança, suporte e política.

Entregas:

- página de diagnóstico exportável sem segredos;
- métricas de conversão e falhas por versão da extensão;
- atualizações e migrações de storage;
- testes de permissões e revisão de host permissions;
- documentação de privacidade;
- decisão entre uso interno, distribuição privada ou Chrome Web Store.

Critérios de aceite:

- revogar pareamento invalida a extensão;
- desinstalar/reinstalar não deixa segredo recuperável;
- política de privacidade descreve cookies e finalidade;
- permissões justificadas por funcionalidade;
- release pode ser revertido.

Commit sugerido: `chore(extension): preparar distribuicao e suporte operacional`.

Saída esperada: produto operável e auditável, não apenas um script carregado manualmente.

## 7. Contratos de API a considerar

### Reutilizar agora

- `GET /api/ml/affiliates`
- `PUT /api/ml/affiliates/:mlUserId`
- `POST /api/ml/affiliates/:mlUserId/validate-cookies`
- `POST /api/ml/convert`

### Adicionar quando a fase exigir

`POST /api/extension/pair`

- entrada: código de uso único ou fluxo de autenticação da plataforma;
- saída: identificador da instalação e usuário vinculado;
- não retornar tokens ML para a extensão.

`GET /api/extension/me`

- retorna usuário, afiliado ML padrão, estado de sessão e permissões da instalação;
- nunca retorna `sessionCookies`, `accessToken` ou `refreshToken`.

`POST /api/extension/session/sync`

- entrada: `mlUserId`, `sessionCookies` e metadados mínimos;
- grava criptografado e dispara validação;
- resposta: estado sanitizado, `melitat`, nickname e timestamp.

`POST /api/extension/offers/drafts`

- entrada: URL original, dados extraídos, marketplace e campanha;
- operação idempotente por fingerprint da URL + usuário;
- resposta: id do rascunho e estado de conversão.

Esses endpoints devem aplicar autenticação, rate limit, ownership do usuário, auditoria redigida e proteção contra replay do pareamento.

## 8. Estratégia de testes

### Unidade/local

- normalização de domínio e URL;
- deduplicação de cookies sem verificar valores;
- serialização do payload;
- redaction de logs;
- seleção de afiliado vinculado;
- classificação de estados da API;
- extratores HTML/DOM com fixtures;
- idempotência/fingerprint de rascunho.

### Integração API

- sincronização de cookie aceita apenas usuário/afiliado pertencente;
- cookie é criptografado no banco;
- resposta nunca contém cookie;
- sessão expirada retorna estado acionável;
- conversão respeita conta e campanha selecionadas.

### E2E Chrome

- instalação/carregamento da extensão em perfil de teste;
- popup com API indisponível;
- pareamento;
- sincronização explícita;
- sessão válida/expirada;
- menu contextual em produto ML;
- clipboard e fallback visual;
- ausência de scripts em domínios não suportados.

### Manual obrigatório

- conferir permissões efetivas em `chrome://extensions`;
- conferir Network: nenhum cookie bruto em URL, query string ou log;
- conferir aba ativa não é redirecionada sem autorização;
- conferir reload da extensão preserva apenas preferências não sensíveis;
- revogar sessão ML e repetir diagnóstico.

## 9. Decisões ainda abertas

1. O primeiro release será somente interno ou pretende publicação na Chrome Web Store?
2. O pareamento deve usar login existente da plataforma, código de uso único ou ambos?
3. A extensão deve suportar apenas Mercado Livre no primeiro ciclo ou já incluir Shopee/Amazon na interface?
4. “Salvar oferta” deve criar rascunho na plataforma ou apenas copiar um payload para o pipeline atual?
5. Qual deve ser o comportamento quando houver múltiplos afiliados ML vinculados ao mesmo usuário?
6. Devemos manter JavaScript simples na extensão ou migrar para TypeScript + bundler depois de validar o fluxo?

## 10. Verificação desta implementação

Verificações específicas da extensão passaram nesta worktree:

- `bun test tests/pure.test.js` — 5 testes, 16 assertions;
- `node --check popup.js`;
- `node --check options.js`;
- `node --check service-worker.js`;
- `node --check lib/pure.js`;
- validação JSON do `manifest.json` e `package.json`;
- busca sem ocorrências de preview ou log de cookie bruto.

`bun run typecheck` e `bun run build` do monorepo foram executados após `bun install`, mas permanecem bloqueados por erros pré-existentes fora da extensão, principalmente `featureFlags` não exportado no schema, testes/exports divergentes e tipos de autenticação em `apps/api`. Esses erros não apontam para os arquivos alterados da extensão.

## 11. Recomendação de primeiro incremento

Implementar Fase 0 + o núcleo da Fase 1 antes de qualquer overlay ou scraping adicional:

1. service worker e cliente API;
2. pareamento/ownership;
3. remover preview de cookie;
4. sincronização explícita + validação no backend;
5. afiliado padrão automático;
6. badge de saúde e reimportação guiada;
7. testes de segurança e README atualizado.

Esse incremento resolve a dor atual, reduz risco de vazamento e prepara a extensão para conversão contextual sem comprometer o pipeline.

## Fontes e observações de pesquisa

Foi iniciada uma pesquisa multi-fonte sobre extensões Chrome MV3, automação de afiliados, permissões, padrões de conversão e riscos de cookies. A documentação oficial de Chrome Extensions deve prevalecer sobre qualquer recomendação genérica, especialmente para permissões, `activeTab`, `optional_host_permissions`, service workers e publicação. A pesquisa também deve confirmar os termos vigentes dos marketplaces antes de qualquer distribuição externa.
