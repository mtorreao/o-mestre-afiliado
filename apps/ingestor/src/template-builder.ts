/**
 * Constrói a mensagem final do espelho a partir de um template e do
 * contexto da oferta.
 *
 * Se houver template configurado:
 *  1. Avalia condicionais humanas ({se X então A senão B})
 *  2. Resolve placeholders ({link_convertido}, {marketplace_nome}, etc.)
 *  3. Trunca para 4000 chars (limite do WhatsApp)
 *
 * Sem template configurado:
 *  - Substitui a URL original pela convertida no texto bruto
 *  - Trunca para 4000 chars
 *
 * As partes testáveis (truncar, e substituir a URL no texto) foram
 * extraídas para funções PURAS (`truncateMessage`,
 * `replaceOriginalUrlInText`) — sem I/O, 100% cobertas por testes.
 */
import type { TemplateContext } from '@omestre/shared';
import { buildEvalContext, processConditionalsHuman, resolvePlaceholders } from '@omestre/shared';

const MAX_MESSAGE_LENGTH = 4000;
const TRUNCATE_SUFFIX = '...';

/**
 * Trunca uma mensagem para o limite do WhatsApp (4000 chars).
 * Se exceder, corta `MAX_MESSAGE_LENGTH - 50` e anexa `...`.
 * Strings menores ou iguais ao limite são retornadas inalteradas.
 */
export function truncateMessage(text: string, maxLength: number = MAX_MESSAGE_LENGTH): string {
  if (text.length > maxLength) {
    return text.slice(0, maxLength - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
  }
  return text;
}

/**
 * Substitui a URL original pela convertida dentro do texto.
 * Retorna o texto original inalterado se `convertedUrl` for nulo/undefined
 * ou se a URL original não estiver presente no texto.
 */
export function replaceOriginalUrlInText(
  text: string,
  originalUrl: string | null | undefined,
  convertedUrl: string | null | undefined,
): string {
  if (!convertedUrl || !originalUrl) return text;
  return text.replace(originalUrl, convertedUrl);
}

/**
 * Monta o texto final enviado pelo Dispatcher para o grupo destino.
 */
export function buildTemplateMessage(ctx: TemplateContext, template: string | null): string {
  if (template) {
    const evalCtx = buildEvalContext(ctx.marketplace, ctx.sourceGroupName, ctx.targetGroupName);
    let result = processConditionalsHuman(template, evalCtx);
    result = resolvePlaceholders(result, ctx);
    return truncateMessage(result);
  }

  const text = replaceOriginalUrlInText(ctx.originalText, ctx.originalUrl, ctx.convertedUrl);
  return truncateMessage(text);
}
