import { describe, it, expect, mock } from 'bun:test';
import { renderToString } from 'react-dom/server';
let state = {
  groups: [
    { jid: 'a@g.us', name: 'Alpha' },
    { jid: 'b@g.us', name: 'Beta' },
  ],
  loading: false,
  error: null as string | null,
  refresh: () => {},
};
mock.module('../hooks/useWhatsAppGroups.ts', () => ({ useWhatsAppGroups: () => state }));
const { GroupDestAutocomplete } = await import('./GroupDestAutocomplete.tsx');
describe('GroupDestAutocomplete', () => {
  it('renderiza combobox e grupos selecionados', () => {
    const html = renderToString(
      <GroupDestAutocomplete
        token="x"
        value={[state.groups[0]!]}
        onChange={() => {}}
        inputId="dest"
        ariaLabel="Destino"
      />,
    );
    expect(html).toContain('id="dest"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('Alpha');
  });
  it('renderiza loading, erro e vazio', () => {
    state = { ...state, loading: true };
    expect(
      renderToString(<GroupDestAutocomplete token="x" value={[]} onChange={() => {}} />),
    ).toContain('Carregando grupos');
    state = { ...state, loading: false, error: 'Falha' };
    expect(
      renderToString(<GroupDestAutocomplete token="x" value={[]} onChange={() => {}} />),
    ).toContain('Falha');
    state = { groups: [], loading: false, error: null, refresh: () => {} };
    expect(
      renderToString(<GroupDestAutocomplete token="x" value={[]} onChange={() => {}} />),
    ).toContain('Nenhum grupo encontrado');
  });
});
