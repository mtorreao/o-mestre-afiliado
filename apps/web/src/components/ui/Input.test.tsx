/**
 * Teste de acessibilidade do componente Input.
 *
 * RED: falha antes do fix; GREEN: passa depois.
 *
 * Cobertura mínima: quando `error` é fornecido, o input deve ter:
 * - aria-invalid="true"
 * - aria-describedby apontando para o id da mensagem de erro
 * - a mensagem de erro renderizada com role="alert"
 */

import { describe, it, expect } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Input } from './Input.tsx';

describe('Input (a11y)', () => {
  it('define aria-invalid="true" e aria-describedby quando há erro', () => {
    const html = renderToString(
      <Input id="mirror-form-nome" label="Nome do Espelhamento" error="O nome é obrigatório" />,
    );

    // O input renderizado deve ter aria-invalid="true"
    expect(html).toContain('aria-invalid="true"');

    // Deve referenciar o id do erro via aria-describedby
    expect(html).toContain('aria-describedby="mirror-form-nome-error"');

    // A mensagem de erro deve estar presente e ter role="alert"
    expect(html).toContain('id="mirror-form-nome-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('O nome é obrigatório');
  });

  it('NÃO define aria-invalid quando não há erro', () => {
    const html = renderToString(<Input id="mirror-form-nome" label="Nome do Espelhamento" />);

    // aria-invalid deve estar ausente (React remove undefined)
    expect(html).not.toContain('aria-invalid');

    // aria-describedby também deve estar ausente
    expect(html).not.toContain('aria-describedby');
  });

  it('aceita error=null sem propagar aria-invalid', () => {
    const html = renderToString(<Input id="x" label="X" error={null} />);
    expect(html).not.toContain('aria-invalid');
  });
});
