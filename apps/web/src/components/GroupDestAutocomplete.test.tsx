import { describe, it, expect, mock } from 'bun:test';
import { renderToString } from 'react-dom/server';
let state = {
  groups: [
    { jid: 'a@g.us', name: 'Alpha', isAdmin: true, pictureUrl: 'https://example.com/a.png' },
    { jid: 'b@g.us', name: 'Beta', isAdmin: false, pictureUrl: null },
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

  it('informa quando existem grupos, mas o usuário não administra nenhum', () => {
    state = {
      groups: [{ jid: 'b@g.us', name: 'Beta', isAdmin: false, pictureUrl: null }],
      loading: false,
      error: null,
      refresh: () => {},
    };
    expect(
      renderToString(<GroupDestAutocomplete token="x" value={[]} onChange={() => {}} />),
    ).toContain('Você precisa ser administrador do grupo');
  });

  it('tags selecionadas mostram avatar (img com pictureUrl) e apenas o nome, sem JID', () => {
    state = {
      groups: [
        { jid: 'a@g.us', name: 'Alpha', isAdmin: true, pictureUrl: 'https://example.com/a.png' },
      ],
      loading: false,
      error: null,
      refresh: () => {},
    };
    const html = renderToString(
      <GroupDestAutocomplete token="x" value={[state.groups[0]!]} onChange={() => {}} />,
    );
    // Nome aparece na tag.
    expect(html).toContain('Alpha');
    // O JID não aparece na tag.
    expect(html).not.toContain('a@g.us');
    // A foto aparece como <img src=...>.
    expect(html).toContain('<img');
    expect(html).toContain('https://example.com/a.png');
  });

  it('tags selecionadas sem pictureUrl usam o avatar de inicial', () => {
    state = {
      groups: [{ jid: 'a@g.us', name: 'Achadinhos', isAdmin: true, pictureUrl: null }],
      loading: false,
      error: null,
      refresh: () => {},
    };
    const html = renderToString(
      <GroupDestAutocomplete token="x" value={[state.groups[0]!]} onChange={() => {}} />,
    );
    expect(html).toContain('Achadinhos');
    expect(html).not.toContain('<img');
    expect(html).toContain('>A<');
  });
});
