import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { getGroupInitial, shouldShowGroupImage } from './GroupAvatar-pure.ts';
import { GroupAvatar } from './GroupAvatar.tsx';

describe('getGroupInitial', () => {
  it('devolve primeira letra do nome em maiúscula', () => {
    expect(getGroupInitial('achadinhos')).toBe('A');
    expect(getGroupInitial('Ofertas VIP')).toBe('O');
  });

  it('preserva acentos e devolve em maiúscula', () => {
    expect(getGroupInitial('çairé')).toBe('Ç');
    expect(getGroupInitial('São Paulo')).toBe('S');
    // toUpperCase não normaliza acentos; Á permanece Á.
    expect(getGroupInitial('Ágora')).toBe('Á');
  });

  it('cai para ? quando vazio', () => {
    expect(getGroupInitial('')).toBe('?');
    expect(getGroupInitial('   ')).toBe('?');
  });

  it('ignora emoji/símbolo inicial e pega a primeira letra', () => {
    expect(getGroupInitial('🔥 Promoções')).toBe('P');
  });
});

describe('shouldShowGroupImage', () => {
  it('false sem url', () => {
    expect(shouldShowGroupImage(null, false)).toBe(false);
    expect(shouldShowGroupImage(undefined, false)).toBe(false);
    expect(shouldShowGroupImage('', false)).toBe(false);
  });

  it('true quando tem url e sem erro', () => {
    expect(shouldShowGroupImage('https://example.com/a.png', false)).toBe(true);
  });

  it('false após erro de carga', () => {
    expect(shouldShowGroupImage('https://example.com/a.png', true)).toBe(false);
  });
});

describe('GroupAvatar (renderização SSR)', () => {
  it('renderiza <img> com src da pictureUrl', () => {
    const html = renderToString(
      <GroupAvatar name="Achadinhos #103" pictureUrl="https://example.com/a.jpg" size={20} />,
    );
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/a.jpg"');
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
  });

  it('cai para span com inicial quando pictureUrl é null', () => {
    const html = renderToString(<GroupAvatar name="Achadinhos" pictureUrl={null} size={20} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('>A<');
  });

  it('cai para ? quando nome está vazio', () => {
    const html = renderToString(<GroupAvatar name="" pictureUrl={null} size={20} />);
    expect(html).toContain('>?<');
  });
});
