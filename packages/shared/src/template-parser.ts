/**
 * Template Parser — Processa condicionais em templates de mensagem.
 *
 * Sintaxe:
 *   {? marketplace = shopee}
 *     Conteúdo para Shopee...
 *   {: marketplace = mercadolivre}
 *     Conteúdo para ML...
 *   {:}
 *     Conteúdo padrão (else)...
 *   {/}
 *
 * Condicionais podem ser aninhadas.
 * Placeholders não reconhecidos em condições são avaliados como false.
 *
 * Integra com resolvePlaceholders() — primeiro as condicionais são
 * processadas (avaliadas contra o eval context), depois os placeholders
 * restantes são resolvidos.
 */

// ─── Tipos ──────────────────────────────────────────────────────────

/** Contexto para avaliação de condições em templates.
 *  Keys são nomes de placeholders (sem chaves).
 *  Values são os valores resolvidos para comparação. */
export type TemplateEvalContext = Record<string, string>;

// ─── Avaliação de Condições ─────────────────────────────────────────

/**
 * Avalia uma condição simples contra o contexto.
 *
 * Formatos suportados:
 *   field = value    → igualdade exata (case-sensitive)
 *   field != value   → diferença (case-sensitive)
 *
 * @param condition Texto da condição (ex: "marketplace = shopee")
 * @param ctx       Mapa de valores para avaliação
 * @returns true se a condição foi satisfeita
 */
export function evaluateCondition(
  condition: string,
  ctx: TemplateEvalContext,
): boolean {
  const trimmed = condition.trim();

  // Tenta operador !=
  const neqMatch = trimmed.match(/^(\w+)\s*!=\s*(.+)$/);
  if (neqMatch) {
    const [, field, value] = neqMatch;
    return (ctx[field!] ?? '') !== value!.trim();
  }

  // Tenta operador =
  const eqMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
  if (eqMatch) {
    const [, field, value] = eqMatch;
    return (ctx[field!] ?? '') === value!.trim();
  }

  // Formato não reconhecido — trata como false
  return false;
}

// ─── Parsing de Blocos Condicionais ─────────────────────────────────

/**
 * Encontra o {/} correspondente a um {?} na posição startPos.
 * Respeita aninhamento (depth tracking).
 *
 * @returns Posição do caractere '{' do {/} correspondente, ou -1
 */
function findMatchingEnd(input: string, startPos: number): number {
  let depth = 1;
  let i = startPos + 2; // depois de '{?'

  while (i < input.length) {
    if (input[i] === '{' && input[i + 1] === '?') {
      depth++;
      i += 2;
    } else if (input[i] === '{' && input[i + 1] === '/') {
      depth--;
      i += 2;
      if (depth === 0) {
        return i - 2; // posição do '{' do {/}
      }
    } else {
      i++;
    }
  }

  return -1; // não encontrado
}

/**
 * Divide o corpo de um bloco condicional em branches.
 * Cada branch é separada por {:} ou {: condition}.
 * Respeita aninhamento de condicionais ({? ... {/}).
 */
function splitBranches(
  firstCondition: string,
  body: string,
): Array<{ condition: string | null; content: string }> {
  const branches: Array<{ condition: string | null; content: string }> = [];
  let currentCondition: string | null = firstCondition;
  let currentContent = '';
  let depth = 0;
  let i = 0;

  while (i < body.length) {
    // Nested conditional start
    if (body[i] === '{' && body[i + 1] === '?') {
      depth++;
      currentContent += body[i]! + body[i + 1]!;
      i += 2;
      continue;
    }
    // Nested conditional end
    if (body[i] === '{' && body[i + 1] === '/') {
      depth--;
      currentContent += body[i]! + body[i + 1]!;
      i += 2;
      continue;
    }

    // Só processa {:} em depth 0 (fora de condicionais aninhadas)
    if (depth === 0 && body[i] === '{' && body[i + 1] === ':') {
      const closeBrace = body.indexOf('}', i + 2);
      if (closeBrace !== -1) {
        branches.push({ condition: currentCondition, content: currentContent });

        const nextConditionRaw = body.slice(i + 2, closeBrace).trim();
        currentCondition = nextConditionRaw.length > 0 ? nextConditionRaw : null;
        currentContent = '';
        i = closeBrace + 1;
        continue;
      }
    }

    currentContent += body[i]!;
    i++;
  }

  // Último branch
  branches.push({ condition: currentCondition, content: currentContent });

  return branches;
}

/**
 * Processa um bloco condicional: avalia branches e retorna o
 * conteúdo do primeiro branch cuja condição seja verdadeira.
 * Se nenhum for verdadeiro e existir um else ({:}), retorna o else.
 * Processa recursivamente condicionais aninhadas no branch escolhido.
 */
function renderConditionalBlock(
  firstCondition: string,
  body: string,
  ctx: TemplateEvalContext,
): string {
  const branches = splitBranches(firstCondition, body);

  for (const branch of branches) {
    if (branch.condition === null) {
      // Else branch — sempre casa
      return processConditionals(branch.content, ctx);
    }
    if (evaluateCondition(branch.condition, ctx)) {
      return processConditionals(branch.content, ctx);
    }
  }

  return ''; // Nenhum branch casou
}

/**
 * Processa condicionais no texto de forma recursiva.
 *
 * 1. Encontra {? condition} → extrai condição
 * 2. Encontra {/} correspondente → extrai corpo do bloco
 * 3. Renderiza o bloco condicional (avalia branches)
 * 4. Continua o scan para o próximo bloco
 *
 * @param input Texto do template (pode conter múltiplos blocos condicionais)
 * @param ctx   Contexto de avaliação (ex: { marketplace: "shopee" })
 * @returns Texto com condicionais já avaliadas/removidas
 */
export function processConditionals(
  input: string,
  ctx: TemplateEvalContext,
): string {
  let result = '';
  let i = 0;

  while (i < input.length) {
    const ifIndex = input.indexOf('{?', i);
    if (ifIndex === -1) {
      // Não há mais condicionais
      result += input.slice(i);
      break;
    }

    // Texto antes do {?
    result += input.slice(i, ifIndex);

    // Encontra '}' fechando o {? condition}
    const closeBrace = input.indexOf('}', ifIndex + 2);
    if (closeBrace === -1) {
      // Malformado — trata resto como literal
      result += input.slice(ifIndex);
      break;
    }

    // Extrai a condição
    const condition = input.slice(ifIndex + 2, closeBrace).trim();

    // Encontra {/} correspondente (depth-aware)
    const endBlock = findMatchingEnd(input, ifIndex);
    if (endBlock === -1) {
      // Malformado — trata como literal
      result += input.slice(ifIndex, closeBrace + 1);
      i = closeBrace + 1;
      continue;
    }

    // Corpo do bloco: conteúdo entre '}' do {? ...} e o {/}
    const blockBody = input.slice(closeBrace + 1, endBlock);

    // Renderiza o bloco condicional
    result += renderConditionalBlock(condition, blockBody, ctx);

    i = endBlock + 3; // pula o {/}
  }

  return result;
}

/**
 * Constrói o contexto de avaliação a partir dos campos do TemplateContext.
 * Mapeia nomes de placeholders para seus valores brutos (não-resolvidos).
 *
 * @param marketplace    marketplace detectado (shopee, mercadolivre, etc.)
 * @param sourceGroupName nome do grupo de origem
 * @param targetGroupName nome do grupo de destino
 */
export function buildEvalContext(
  marketplace: string,
  sourceGroupName: string,
  targetGroupName: string,
): TemplateEvalContext {
  return {
    marketplace,
    source_group: sourceGroupName,
    target_group: targetGroupName,
  };
}
