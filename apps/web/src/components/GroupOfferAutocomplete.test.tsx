/**
 * Teste de regressão do GroupOfferAutocomplete.
 *
 * BUG REPRODUZIDO: o componente retornava cedo (sem renderizar o input
 * combobox) quando useWhatsAppGroups estava em loading, em erro, ou
 * retornava 0 grupos. Quebrava:
 *   - Teste E2E 5.0: input #mirror-form-origem-input deve existir sempre
 *   - Teste E2E 6.0: foco no input → listbox abre
 *   - UX: usuário não conseguia digitar nada durante loading
 *
 * RED: falha antes do fix; GREEN: passa depois.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { renderToString } from 'react-dom/server';

// Mock do hook — controla o estado retornado em cada teste
let mockHookResult: {
  groups: { jid: string; name: string }[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
} = {
  groups: [],
  loading: false,
  refreshing: false,
  error: null,
  refresh: () => {},
};

mock.module('../hooks/useWhatsAppGroups.ts', () => ({
  useWhatsAppGroups: () => mockHookResult,
}));

// Importação DEPOIS do mock (Bun honrará o mock)
const { GroupOfferAutocomplete } = await import('./GroupOfferAutocomplete.tsx');

const baseProps = {
  token: 'fake',
  value: [],
  onChange: () => {},
  inputId: 'mirror-form-origem-input',
  ariaLabel: 'Buscar grupo de origem',
};

beforeEach(() => {
  mockHookResult = {
    groups: [],
    loading: false,
    refreshing: false,
    error: null,
    refresh: () => {},
  };
});

describe('GroupOfferAutocomplete (a11y / render sempre do input)', () => {
  it('renderiza o input combobox durante loading', () => {
    mockHookResult.loading = true;
    const html = renderToString(<GroupOfferAutocomplete {...baseProps} />);

    // Input combobox deve existir mesmo durante loading
    expect(html).toContain('id="mirror-form-origem-input"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');

    // Mensagem de loading deve estar presente (dentro do componente, não em vez do input)
    expect(html).toContain('Carregando grupos');
  });

  it('renderiza o input combobox quando fetchError ocorre', () => {
    mockHookResult.error = 'Erro de conexão';
    const html = renderToString(<GroupOfferAutocomplete {...baseProps} />);

    expect(html).toContain('id="mirror-form-origem-input"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('Erro de conexão');
  });

  it('renderiza o input combobox quando groups.length === 0', () => {
    mockHookResult.groups = [];
    const html = renderToString(<GroupOfferAutocomplete {...baseProps} />);

    expect(html).toContain('id="mirror-form-origem-input"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('Nenhum grupo encontrado');
  });

  it('renderiza o input combobox quando há grupos disponíveis', () => {
    mockHookResult.groups = [
      { jid: 'a@g.us', name: 'Grupo A' },
      { jid: 'b@g.us', name: 'Grupo B' },
    ];
    const html = renderToString(<GroupOfferAutocomplete {...baseProps} />);

    expect(html).toContain('id="mirror-form-origem-input"');
    expect(html).toContain('role="combobox"');
  });

  it('liga aria-invalid/aria-describedby quando error prop é fornecido', () => {
    mockHookResult.groups = [{ jid: 'a@g.us', name: 'Grupo A' }];
    const html = renderToString(
      <GroupOfferAutocomplete
        {...baseProps}
        error="Selecione pelo menos 1 grupo de origem"
        errorId="mirror-form-origem-error"
      />,
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="mirror-form-origem-error"');
  });
});
