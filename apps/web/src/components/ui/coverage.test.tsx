import { describe, it, expect } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Badge } from './Badge.tsx';
import { Loading, LoadingSkeleton } from './Loading.tsx';
import { FilterBar } from './FilterBar.tsx';
import { Checkbox } from './Checkbox.tsx';
import { Switch } from './Switch.tsx';
import { Tabs } from './Tabs.tsx';
import { Dialog } from './Dialog.tsx';
import { BottomSheet } from './BottomSheet.tsx';
import { MobileFilterBar } from './MobileFilterBar.tsx';
import { Select } from './Select.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { ThemeProvider } from '../../hooks/useTheme.tsx';
import { ToastProvider } from './Toast.tsx';

describe('componentes UI', () => {
  it('renderiza variantes e conteúdo de Badge', () => {
    for (const variant of ['success', 'warning', 'error', 'info', 'neutral'] as const) {
      const html = renderToString(<Badge variant={variant}>Estado</Badge>);
      expect(html).toContain('Estado');
      expect(html).toContain('badge');
    }
  });

  it('renderiza Loading com tamanhos e texto opcionais', () => {
    expect(renderToString(<Loading size="sm" text="Carregando" />)).toContain('Carregando');
    expect(renderToString(<Loading size="lg" />)).not.toContain('Carregando');
    const skeleton = renderToString(<LoadingSkeleton lines={4} className="custom" />);
    expect((skeleton.match(/LoadingSkeleton/g) ?? []).length).toBeGreaterThan(0);
    expect((skeleton.match(/animation-delay/g) ?? []).length).toBe(4);
  });

  it('renderiza FilterBar e item com largura e crescimento', () => {
    const html = renderToString(
      <FilterBar title="Filtros" action={<button>Limpar</button>}>
        <FilterBar.Item width="200px" grow={1}>
          Campo
        </FilterBar.Item>
      </FilterBar>,
    );
    expect(html).toContain('Filtros');
    expect(html).toContain('Limpar');
    expect(html).toContain('Campo');
    expect(html).toContain('flex:1 0 200px');
  });

  it('renderiza controles acessíveis com estado e disabled', () => {
    expect(
      renderToString(<Checkbox id="c" label="Aceito" checked onCheckedChange={() => {}} />),
    ).toContain('Aceito');
    expect(
      renderToString(
        <Switch id="s" label="Auto" checked={false} onCheckedChange={() => {}} disabled />,
      ),
    ).toContain('Auto');
  });

  it('renderiza tabs e conteúdo correspondente', () => {
    const html = renderToString(
      <Tabs
        tabs={[
          { value: 'one', label: 'Um' },
          { value: 'two', label: 'Dois' },
        ]}
        value="one"
        onValueChange={() => {}}
      >
        <div>Primeiro</div>
        <div>Segundo</div>
      </Tabs>,
    );
    expect(html).toContain('Um');
    expect(html).toContain('Primeiro');
  });

  it('renderiza dialogs e bottom sheet fechados e abertos', () => {
    expect(
      renderToString(
        <Dialog open title="Confirmar" description="Detalhes" onOpenChange={() => {}}>
          Conteúdo
        </Dialog>,
      ),
    ).toBe('');
    expect(
      renderToString(
        <BottomSheet open title="Filtros" onOpenChange={() => {}}>
          Campos
        </BottomSheet>,
      ),
    ).toContain('slideUp');
    expect(
      renderToString(
        <BottomSheet open onOpenChange={() => {}}>
          Padrão
        </BottomSheet>,
      ),
    ).toContain('fadeIn');
  });

  it('renderiza MobileFilterBar e Select com erro, placeholder e opções', () => {
    const mobile = renderToString(
      <MobileFilterBar label="Buscar" actions={<button>Aplicar</button>}>
        Campos
      </MobileFilterBar>,
    );
    expect(mobile).toContain('Buscar');
    expect(mobile).toContain('Buscar');
    const select = renderToString(
      <Select
        label="Status"
        value=""
        placeholder="Escolha"
        options={[{ value: 'ok', label: 'Ativo' }]}
        error="Obrigatório"
        onValueChange={() => {}}
      />,
    );
    expect(select).toContain('Status');
    expect(select).toContain('Obrigatório');
  });

  it('renderiza ToastProvider e expõe children', () => {
    const html = renderToString(
      <ToastProvider>
        <span>Conteúdo</span>
      </ToastProvider>,
    );
    expect(html).toContain('Conteúdo');
    expect(html).toContain('ToastViewport');
  });

  it('renderiza ThemeToggle pelo provider padrão', () => {
    const html = renderToString(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(html).toContain('theme-toggle-btn');
  });
});
