/**
 * Testes unitários para o template-parser.
 *
 * Cobertura:
 *   - evaluateCondition: =, !=, formato inválido
 *   - processConditionals: sem condicional, branch único, múltiplos branches,
 *     else, nested, sem match, condicional vazio, texto misturado
 *   - buildEvalContext
 */
import { describe, it, expect } from 'bun:test';
import {
  evaluateCondition,
  processConditionals,
  buildEvalContext,
  translateCondition,
  translateHumanConditionals,
  processConditionalsHuman,
} from '../template-parser.ts';

// ─── buildEvalContext ───────────────────────────────────────────────────

describe('buildEvalContext', () => {
  it('cria contexto com marketplace, source_group e target_group', () => {
    const ctx = buildEvalContext('shopee', 'Grupo A', 'Grupo B');
    expect(ctx).toEqual({
      marketplace: 'shopee',
      source_group: 'Grupo A',
      target_group: 'Grupo B',
    });
  });
});

// ─── evaluateCondition ──────────────────────────────────────────────────

describe('evaluateCondition', () => {
  it('avalia = como true quando campo corresponde', () => {
    const ctx = { marketplace: 'shopee' };
    expect(evaluateCondition('marketplace = shopee', ctx)).toBe(true);
  });

  it('avalia = como false quando campo não corresponde', () => {
    const ctx = { marketplace: 'shopee' };
    expect(evaluateCondition('marketplace = mercadolivre', ctx)).toBe(false);
  });

  it('avalia != como true quando campo difere', () => {
    const ctx = { marketplace: 'shopee' };
    expect(evaluateCondition('marketplace != mercadolivre', ctx)).toBe(true);
  });

  it('avalia != como false quando campo igual', () => {
    const ctx = { marketplace: 'shopee' };
    expect(evaluateCondition('marketplace != shopee', ctx)).toBe(false);
  });

  it('ignora espaços extras na condição', () => {
    const ctx = { marketplace: 'shopee' };
    expect(evaluateCondition('  marketplace  =  shopee  ', ctx)).toBe(true);
  });

  it('retorna false para formato inválido', () => {
    const ctx = { marketplace: 'shopee' };
    expect(evaluateCondition('invalid', ctx)).toBe(false);
  });

  it('retorna false para campo inexistente no contexto', () => {
    const ctx = { marketplace: 'shopee' };
    expect(evaluateCondition('unknown_field = value', ctx)).toBe(false);
  });
});

// ─── processConditionals ────────────────────────────────────────────────

describe('processConditionals', () => {
  it('retorna texto inalterado quando não há condicionais', () => {
    const result = processConditionals(
      'Texto simples sem condicionais.',
      { marketplace: 'shopee' },
    );
    expect(result).toBe('Texto simples sem condicionais.');
  });

  it('retorna branch verdadeiro quando condição casa', () => {
    const template = '{? marketplace = shopee}Conteúdo Shopee{/}';
    const result = processConditionals(template, { marketplace: 'shopee' });
    expect(result).toBe('Conteúdo Shopee');
  });

  it('remove branch quando condição não casa (sem else)', () => {
    const template = '{? marketplace = mercadolivre}Conteúdo ML{/}';
    const result = processConditionals(template, { marketplace: 'shopee' });
    expect(result).toBe('');
  });

  it('retorna else ({:}) quando condição não casa', () => {
    const template = '{? marketplace = mercadolivre}ML{:}Padrão{/}';
    const result = processConditionals(template, { marketplace: 'shopee' });
    expect(result).toBe('Padrão');
  });

  it('seleciona branch correto entre múltiplos', () => {
    const template = [
      '{? marketplace = shopee}',
      'Shopee',
      '{: marketplace = mercadolivre}',
      'ML',
      '{: marketplace = amazon}',
      'Amazon',
      '{:}',
      'Outro',
      '{/}',
    ].join('');
    expect(processConditionals(template, { marketplace: 'shopee' })).toBe('Shopee');
    expect(processConditionals(template, { marketplace: 'mercadolivre' })).toBe('ML');
    expect(processConditionals(template, { marketplace: 'amazon' })).toBe('Amazon');
    expect(processConditionals(template, { marketplace: 'magalu' })).toBe('Outro');
  });

  it('processa condicionais aninhadas', () => {
    const template = [
      '{? marketplace = shopee}',
      'Shopee: ',
      '{? source_group = VIP}',
      'VIP',
      '{:}',
      'Normal',
      '{/}',
      '{/}',
    ].join('');
    const result = processConditionals(template, {
      marketplace: 'shopee',
      source_group: 'VIP',
    });
    expect(result).toBe('Shopee: VIP');
  });

  it('mantém texto ao redor de condicionais', () => {
    const template = 'Antes {? marketplace = shopee}Shopee{/} Depois';
    const result = processConditionals(template, { marketplace: 'shopee' });
    expect(result).toBe('Antes Shopee Depois');
  });

  it('processa múltiplos blocos condicionais independentes', () => {
    const template = [
      '{? marketplace = shopee}🛒{/}',
      ' ',
      '{? marketplace = mercadolivre}📦{/}',
    ].join('');
    const result = processConditionals(template, { marketplace: 'shopee' });
    expect(result).toBe('🛒 ');
  });

  it('trata {? malformado (sem fecha }) como texto literal', () => {
    const template = '{? marketplace = shopee}conteúdo';
    const result = processConditionals(template, { marketplace: 'shopee' });
    // O parser não encontra {/} e considera malformado, tratando como literal
    expect(result).toBe(template);
  });

  it('retorna vazio para bloco vazio com condição verdadeira', () => {
    const template = '{? marketplace = shopee}{/}';
    const result = processConditionals(template, { marketplace: 'shopee' });
    expect(result).toBe('');
  });

  it('condicional com {?} sem chave não quebra (considera false)', () => {
    const template = '{?}Sim{:}Nao{/}';
    const result = processConditionals(template, { marketplace: 'shopee' });
    // A condição vazia não corresponde a nenhum formato conhecido → false → vai pro else
    expect(result).toBe('Nao');
  });
});

// ─── Sintaxe humanizada ────────────────────────────────────────────────

describe('translateCondition', () => {
  it('traduz "X for igual a Y" para "X = Y"', () => {
    expect(translateCondition("marketplace for igual a 'shopee'")).toBe('marketplace = shopee');
  });

  it('traduz "X for diferente de Y" para "X != Y"', () => {
    expect(translateCondition("marketplace for diferente de 'mercadolivre'")).toBe('marketplace != mercadolivre');
  });

  it('traduz "X for Y" (shorthand) para "X = Y"', () => {
    expect(translateCondition("source_group for 'VIP'")).toBe('source_group = VIP');
  });

  it('passa condição técnica inalterada', () => {
    expect(translateCondition('marketplace = shopee')).toBe('marketplace = shopee');
  });
});

describe('translateHumanConditionals', () => {
  it('converte {se ...} para {? ...}', () => {
    const input = '{se marketplace for igual a shopee}Shopee{/}';
    expect(translateHumanConditionals(input)).toBe('{? marketplace = shopee}Shopee{/}');
  });

  it('converte {se ...} para {? ...} com aspas simples', () => {
    const input = "{se marketplace for igual a 'shopee'}Shopee{/}";
    expect(translateHumanConditionals(input)).toBe('{? marketplace = shopee}Shopee{/}');
  });

  it('converte {senão se ...} para {: ...}', () => {
    const input = '{se marketplace for shopee}S{senão se marketplace for mercadolivre}M{/}';
    const result = translateHumanConditionals(input);
    expect(result).toContain('{? marketplace = shopee}');
    expect(result).toContain('{: marketplace = mercadolivre}');
  });

  it('converte {senão} para {:}', () => {
    const input = '{se marketplace for shopee}S{senão}N{/}';
    expect(translateHumanConditionals(input)).toBe('{? marketplace = shopee}S{:}N{/}');
  });

  it('converte {fim} para {/}', () => {
    const input = '{se marketplace for shopee}S{fim}';
    expect(translateHumanConditionals(input)).toBe('{? marketplace = shopee}S{/}');
  });

  it('processa inline: {se X então A senão B}', () => {
    const input = "{se marketplace for igual a 'shopee' então 🛒 senão 📦}";
    expect(translateHumanConditionals(input)).toBe('{? marketplace = shopee}🛒{:}📦{/}');
  });

  it('processa inline sem senão', () => {
    const input = "{se marketplace for igual a 'shopee' então 🛒}";
    expect(translateHumanConditionals(input)).toBe('{? marketplace = shopee}🛒{/}');
  });

  it('processa inline com placeholder {link_convertido} no true content', () => {
    const input = "{se marketplace for igual a 'shopee' então {link_convertido} senão 📦}";
    const result = translateHumanConditionals(input);
    expect(result).toBe('{? marketplace = shopee}{link_convertido}{:}📦{/}');
  });

  it('processa inline com placeholder {link_convertido} no false content', () => {
    const input = "{se marketplace for igual a 'shopee' então 🛒 senão {link_convertido}}";
    const result = translateHumanConditionals(input);
    expect(result).toBe('{? marketplace = shopee}🛒{:}{link_convertido}{/}');
  });

  it('processa inline com placeholders em ambos os branches', () => {
    const input = "{se marketplace for igual a 'shopee' então {texto_original} senão {link_convertido}}";
    const result = translateHumanConditionals(input);
    expect(result).toBe('{? marketplace = shopee}{texto_original}{:}{link_convertido}{/}');
  });

  it('processa inline com texto e placeholder misturados', () => {
    const input = "{se marketplace for igual a 'shopee' então 🛒 {link_convertido} senão 📦 {texto_original}}";
    const result = translateHumanConditionals(input);
    expect(result).toBe('{? marketplace = shopee}🛒 {link_convertido}{:}📦 {texto_original}{/}');
  });

  it('não confunde entao dentro de placeholder com keyword então', () => {
    const input = "{se marketplace for igual a 'shopee' então {algum_então_x} senão 📦}";
    const result = translateHumanConditionals(input);
    expect(result).toBe('{? marketplace = shopee}{algum_então_x}{:}📦{/}');
  });
});

describe('processConditionalsHuman', () => {
  it('processa {se marketplace for igual a shopee}', () => {
    const template = '{se marketplace for igual a shopee}Shopee{:}Outro{fim}';
    expect(processConditionalsHuman(template, { marketplace: 'shopee' })).toBe('Shopee');
    expect(processConditionalsHuman(template, { marketplace: 'mercadolivre' })).toBe('Outro');
  });

  it('processa inline {se X então A senão B}', () => {
    const template = "{se marketplace for igual a 'shopee' então 🛒 senão 📦}";
    expect(processConditionalsHuman(template, { marketplace: 'shopee' })).toBe('🛒');
    expect(processConditionalsHuman(template, { marketplace: 'amazon' })).toBe('📦');
  });

  it('mantém compatibilidade com sintaxe técnica ({?})', () => {
    const template = '{? marketplace = shopee}Técnica{:}Fallback{/}';
    expect(processConditionalsHuman(template, { marketplace: 'shopee' })).toBe('Técnica');
  });

  it('processa bloco completo com múltiplos branches em português', () => {
    const template = [
      '{se marketplace for igual a shopee}',
      '🛒 Shopee',
      '{senão se marketplace for igual a mercadolivre}',
      '📦 ML',
      '{senão}',
      '🔗 Outro',
      '{fim}',
    ].join('');
    expect(processConditionalsHuman(template, { marketplace: 'shopee' })).toBe('🛒 Shopee');
    expect(processConditionalsHuman(template, { marketplace: 'mercadolivre' })).toBe('📦 ML');
    expect(processConditionalsHuman(template, { marketplace: 'amazon' })).toBe('🔗 Outro');
  });

  it('processa inline com placeholder {link_convertido} e avalia condição', () => {
    const template = "{se marketplace for igual a 'shopee' então 🛒 {link_convertido} senão 📦 {link_convertido}}";
    // O placeholder não é resolvido aqui, apenas o condicional é processado
    const ctx = { marketplace: 'shopee' };
    expect(processConditionalsHuman(template, ctx)).toBe('🛒 {link_convertido}');
  });
});
