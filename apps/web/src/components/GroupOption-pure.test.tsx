import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { renderGroupOption } from './GroupOption-pure.tsx';

describe('renderGroupOption', () => {
  const base = {
    index: 0,
    listboxId: 'dest',
    highlighted: false,
  };

  it('renderiza role=option e id derivado do listboxId+index', () => {
    const html = renderToString(
      renderGroupOption({
        ...base,
        group: {
          jid: 'a@g.us',
          name: 'Alpha',
          isAdmin: true,
          pictureUrl: 'https://example.com/a.png',
        },
      }),
    );
    expect(html).toContain('role="option"');
    expect(html).toContain('id="dest-option-0"');
  });

  it('marca aria-selected=true quando highlighted', () => {
    const html = renderToString(
      renderGroupOption({
        ...base,
        highlighted: true,
        group: { jid: 'a@g.us', name: 'Alpha' },
      }),
    );
    expect(html).toContain('aria-selected="true"');
  });

  it('inclui o nome do grupo e NÃO inclui o JID visível', () => {
    const html = renderToString(
      renderGroupOption({
        ...base,
        group: { jid: 'a@g.us', name: 'Alpha', isAdmin: true, pictureUrl: null },
      }),
    );
    expect(html).toContain('Alpha');
    expect(html).not.toContain('a@g.us');
  });

  it('renderiza <img> com pictureUrl quando presente', () => {
    const html = renderToString(
      renderGroupOption({
        ...base,
        group: { jid: 'a@g.us', name: 'Alpha', pictureUrl: 'https://example.com/a.png' },
      }),
    );
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it('cai para o fallback de inicial quando sem pictureUrl', () => {
    const html = renderToString(
      renderGroupOption({
        ...base,
        group: { jid: 'a@g.us', name: 'Achadinhos', pictureUrl: null },
      }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('>A<');
  });

  it('aplica background destacado quando highlighted', () => {
    const html = renderToString(
      renderGroupOption({
        ...base,
        highlighted: true,
        group: { jid: 'a@g.us', name: 'Alpha' },
      }),
    );
    expect(html).toContain('background:#334155');
  });
});
