/**
 * Testes das funções PURAS em apps/ingestor/src/terms-lists-pure.ts.
 *
 * Cobrem 100% do parse de JSON (válido / inválido / formato errado /
 * normalização / dedupe) e do matching case-insensitive, sem I/O de disco.
 * A orquestração com cache em globalThis + readFileSync vive em
 * `terms-lists.ts` (fora do escopo — depende de fs).
 */
import { describe, expect, it } from 'bun:test';
import { parseTermsFile, matchAnyTerm } from './terms-lists-pure.ts';

describe('parseTermsFile', () => {
  describe('JSON válido', () => {
    it('extrai terms de { terms: [...] }', () => {
      const result = parseTermsFile('{"terms":["vagas","emprego"]}');
      expect(result.ok).toBe(true);
      expect(result.terms).toEqual(['vagas', 'emprego']);
    });

    it('faz trim de cada termo', () => {
      const result = parseTermsFile('{"terms":["  vagas  ","\\temprego\\t"]}');
      expect(result.terms).toEqual(['vagas', 'emprego']);
    });

    it('remove termos vazios (após trim)', () => {
      const result = parseTermsFile('{"terms":["vagas","","  "]}');
      expect(result.terms).toEqual(['vagas']);
    });

    it('remove duplicatas (após trim), preservando ordem', () => {
      const result = parseTermsFile('{"terms":["vagas","emprego","vagas"]}');
      expect(result.terms).toEqual(['vagas', 'emprego']);
    });

    it('coerce entradas não-string via String()', () => {
      const result = parseTermsFile('{"terms":[123, "emprego"]}');
      expect(result.terms).toEqual(['123', 'emprego']);
    });

    it('retorna terms vazio para array vazio', () => {
      const result = parseTermsFile('{"terms":[]}');
      expect(result.ok).toBe(true);
      expect(result.terms).toEqual([]);
    });
  });

  describe('JSON inválido', () => {
    it('retorna ok:false e terms vazio para JSON malformado', () => {
      const result = parseTermsFile('{ terms: [ ');
      expect(result.ok).toBe(false);
      expect(result.terms).toEqual([]);
      expect(result.error).toContain('JSON inválido');
    });

    it('retorna ok:false para string vazia', () => {
      const result = parseTermsFile('');
      expect(result.ok).toBe(false);
      expect(result.terms).toEqual([]);
    });

    it('retorna ok:false para texto não-JSON', () => {
      const result = parseTermsFile('não é json');
      expect(result.ok).toBe(false);
      expect(result.terms).toEqual([]);
    });
  });

  describe('formato inesperado', () => {
    it('retorna ok:false quando não é objeto (ex.: array)', () => {
      const result = parseTermsFile('["vagas","emprego"]');
      expect(result.ok).toBe(false);
      expect(result.terms).toEqual([]);
      expect(result.error).toContain('objeto');
    });

    it('retorna ok:false quando terms ausente', () => {
      const result = parseTermsFile('{"foo":["vagas"]}');
      expect(result.ok).toBe(false);
      expect(result.terms).toEqual([]);
      expect(result.error).toContain('terms');
    });

    it('retorna ok:false quando terms não é array', () => {
      const result = parseTermsFile('{"terms":"vagas"}');
      expect(result.ok).toBe(false);
      expect(result.terms).toEqual([]);
      expect(result.error).toContain('array');
    });
  });
});

describe('matchAnyTerm', () => {
  describe('matching case-insensitive (substring)', () => {
    it('casa termo em qualquer caso', () => {
      expect(matchAnyTerm('Compre VAGAS agora', ['vagas']).matched).toBe(true);
    });

    it('casa substring dentro de palavra maior', () => {
      const result = matchAnyTerm('texto com emprego aqui', ['emprego']);
      expect(result.matched).toBe(true);
      expect(result.term).toBe('emprego');
    });

    it('retorna o primeiro termo que casou', () => {
      const result = matchAnyTerm('tem vagas e emprego', ['emprego', 'vagas']);
      expect(result.matched).toBe(true);
      expect(result.term).toBe('emprego');
    });

    it('texto lowercase também casa', () => {
      expect(matchAnyTerm('compre vagas', ['VAGAS']).matched).toBe(true);
    });
  });

  describe('sem match', () => {
    it('retorna false quando nenhum termo casa', () => {
      const result = matchAnyTerm('oferta imperdível', ['vagas', 'emprego']);
      expect(result.matched).toBe(false);
      expect(result.term).toBeUndefined();
    });

    it('retorna false para lista de termos vazia', () => {
      expect(matchAnyTerm('qualquer texto', []).matched).toBe(false);
    });

    it('retorna false para texto vazio', () => {
      expect(matchAnyTerm('', ['vagas']).matched).toBe(false);
    });

    it('ignora termos vazios dentro da lista', () => {
      expect(matchAnyTerm('qualquer', ['', '  ']).matched).toBe(false);
    });

    it('não casa parcialmente quando termo é maior que o texto', () => {
      expect(matchAnyTerm('vaga', ['vagas']).matched).toBe(false);
    });
  });
});
