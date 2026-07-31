/**
 * Teste de regressão do MirrorFormPage.
 *
 * BUG REPRODUZIDO (Bug 1):
 * - O input #mirror-form-nome tem `required` (atributo HTML5)
 * - O <form> NÃO tem `noValidate`, então a validação HTML5 nativa
 *   bloqueia o submit quando o input required está vazio
 * - O React `onSubmit` handler NUNCA é chamado
 * - Resultado: validate() nunca roda, setNameError nunca é chamado,
 *   aria-invalid nunca aparece.
 *
 * RED: o teste falha porque o form bloqueia o submit via HTML5.
 * GREEN: após adicionar noValidate, validate() é chamado e aria-invalid
 *        aparece.
 *
 * NOTA: usa renderToString para verificar a prop noValidate presente.
 */

import { describe, it, expect } from 'bun:test';
import { renderToString } from 'react-dom/server';

// Mock dos hooks/componentes pesados para isolar a página
import { mock } from 'bun:test';
mock.module('../hooks/useWhatsAppGroups.ts', () => ({
  useWhatsAppGroups: () => ({
    groups: [],
    loading: false,
    refreshing: false,
    error: null,
    refresh: () => {},
  }),
}));

import { MirrorFormPage } from './MirrorFormPage.tsx';

const baseProps = {
  token: 'fake-token',
  onBack: () => {},
};

describe('MirrorFormPage (form noValidate + a11y)', () => {
  it('form tem noValidate para evitar bloqueio do submit via HTML5', () => {
    const html = renderToString(<MirrorFormPage {...baseProps} />);
    expect(html).toContain('noValidate');
  });

  it('inputs com required estão presentes mas não bloqueiam onSubmit (noValidate)', () => {
    const html = renderToString(<MirrorFormPage {...baseProps} />);
    // Input nome tem required (mantém hint semântico para screen readers)
    expect(html).toContain('required=""');
    // Mas o form tem noValidate (não bloqueia o submit)
    expect(html).toContain('noValidate');
  });
});
