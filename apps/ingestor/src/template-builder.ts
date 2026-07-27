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
 */
import type { TemplateContext } from '@omestre/shared';
import { buildEvalContext, processConditionalsHuman, resolvePlaceholders } from '@omestre/shared';

const MAX_MESSAGE_LENGTH = 4000;

/**
 * Monta o texto final enviado pelo Dispatcher para o grupo destino.
 */
export function buildTemplateMessage(ctx: TemplateContext, template: string | null): string {
  if (template) {
    const evalCtx = buildEvalContext(ctx.marketplace, ctx.sourceGroupName, ctx.targetGroupName);
    let result = processConditionalsHuman(template, evalCtx);
    result = resolvePlaceholders(result, ctx);
    return truncate(result);
  }

  let text = ctx.originalText;
  if (ctx.convertedUrl) {
    text = text.replace(ctx.originalUrl, ctx.convertedUrl);
  }
  return truncate(text);
}

function truncate(text: string): string {
  if (text.length > MAX_MESSAGE_LENGTH) {
    return text.slice(0, MAX_MESSAGE_LENGTH - 50) + '...';
  }
  return text;
}
