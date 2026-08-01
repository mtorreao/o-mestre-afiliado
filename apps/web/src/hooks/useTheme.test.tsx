import { describe, it, expect } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ThemeProvider, useTheme } from './useTheme.tsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.tsx';

/** Componente que consome o contexto e expõe seu valor (servidor-side). */
function Probe() {
  const { theme, toggleTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-test="theme">{theme}</span>
      <button data-test="toggle" onClick={toggleTheme}>
        toggle
      </button>
      <button data-test="set-dark" onClick={() => setTheme('dark')}>
        set-dark
      </button>
      <button data-test="set-light" onClick={() => setTheme('light')}>
        set-light
      </button>
    </div>
  );
}

describe('useTheme (integração via renderToString)', () => {
  it('ThemeProvider provê tema inicial default ("light") sem storage', () => {
    const html = renderToString(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(html).toContain('data-test="theme">light<');
  });

  it('useTheme fora de ThemeProvider lança erro claro', () => {
    expect(() => renderToString(<Probe />)).toThrow(/useTheme must be used within a ThemeProvider/);
  });

  it('ThemeToggle dentro de ThemeProvider renderiza botão acessível', () => {
    const html = renderToString(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(html).toContain('theme-toggle-btn');
    // default = light mode → label anuncia "Ativar tema escuro"
    expect(html).toContain('Ativar tema escuro');
  });

  it('Probe renderiza handlers de toggle/set sem erro', () => {
    const html = renderToString(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(html).toContain('data-test="toggle"');
    expect(html).toContain('data-test="set-dark"');
    expect(html).toContain('data-test="set-light"');
  });
});
