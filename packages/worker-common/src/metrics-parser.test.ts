/**
 * Testes do parser de métricas Prometheus (text format).
 *
 * parsePromCounter() é usado pelo healthcheck para somar counters
 * expostos pelos workers.
 */
import { describe, expect, it } from 'bun:test';
import { parsePromCounter } from './metrics-parser.ts';

describe('parsePromCounter', () => {
  describe('counter sem labels', () => {
    it('extrai valor de counter simples', () => {
      const text = `# HELP foo_total Total
# TYPE foo_total counter
foo_total 42`;
      expect(parsePromCounter(text, 'foo_total')).toBe(42);
    });

    it('extrai valor numérico grande', () => {
      const text = 'foo_total 1234567890';
      expect(parsePromCounter(text, 'foo_total')).toBe(1234567890);
    });

    it('extrai valor decimal', () => {
      const text = 'foo_total 3.14';
      expect(parsePromCounter(text, 'foo_total')).toBe(3.14);
    });

    it('extrai valor em notação científica', () => {
      const text = 'foo_total 1.5e3';
      expect(parsePromCounter(text, 'foo_total')).toBe(1500);
    });

    it('extrai valor negativo', () => {
      const text = 'foo_total -7';
      expect(parsePromCounter(text, 'foo_total')).toBe(-7);
    });

    it('retorna 0 quando o counter não existe no texto', () => {
      const text = 'other_counter 99';
      expect(parsePromCounter(text, 'foo_total')).toBe(0);
    });

    it('retorna 0 para texto vazio', () => {
      expect(parsePromCounter('', 'foo_total')).toBe(0);
    });

    it('ignora comentários', () => {
      const text = `# HELP foo_total Help text
# TYPE foo_total counter
foo_total 5`;
      expect(parsePromCounter(text, 'foo_total')).toBe(5);
    });
  });

  describe('counter com labels', () => {
    it('extrai valor de counter com labels simples', () => {
      const text = `foo_total{instance="a"} 10`;
      expect(parsePromCounter(text, 'foo_total')).toBe(10);
    });

    it('soma múltiplas séries com labels diferentes', () => {
      const text = `foo_total{instance="a"} 10
foo_total{instance="b"} 5
foo_total{instance="c"} 7`;
      expect(parsePromCounter(text, 'foo_total')).toBe(22);
    });

    it('soma counter sem labels + counter com labels', () => {
      const text = `foo_total 100
foo_total{instance="a"} 10
foo_total{instance="b"} 5`;
      expect(parsePromCounter(text, 'foo_total')).toBe(115);
    });

    it('extrai valor de counter com labels múltiplos', () => {
      const text = `foo_total{marketplace="shopee",status="active"} 50`;
      expect(parsePromCounter(text, 'foo_total')).toBe(50);
    });
  });

  describe('escape de caracteres especiais no nome', () => {
    it('escapa pontos no nome do counter', () => {
      const text = 'foo.bar.total 7';
      expect(parsePromCounter(text, 'foo.bar.total')).toBe(7);
    });

    it('escapa underscore (já não-especial, não deve quebrar)', () => {
      const text = 'pipeline_messages_received_total 42';
      expect(parsePromCounter(text, 'pipeline_messages_received_total')).toBe(42);
    });

    it('não confunde counter cujo nome é prefixo de outro', () => {
      const text = `foo_total 10
foo_total_extra 99`;
      // foo_total deve pegar só 10 (o 99 tem label/labels diferentes e
      // o regex exige nome{...} ou fim de linha logo após o nome)
      expect(parsePromCounter(text, 'foo_total')).toBe(10);
    });
  });

  describe('tolerância a dados malformados', () => {
    it('ignora linhas com valor não-numérico', () => {
      const text = `foo_total abc
foo_total 10
foo_total xyz`;
      expect(parsePromCounter(text, 'foo_total')).toBe(10);
    });

    it('parseia texto com CRLF (Windows line endings)', () => {
      const text = 'foo_total 5\r\nbar_total 3\r\n';
      expect(parsePromCounter(text, 'foo_total')).toBe(5);
      expect(parsePromCounter(text, 'bar_total')).toBe(3);
    });
  });
});
