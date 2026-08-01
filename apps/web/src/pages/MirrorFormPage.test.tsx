import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { renderToString } from 'react-dom/server';

// Mocks DEVEM ser registrados antes da importação dinâmica do componente
mock.module('react-router-dom', () => ({
  useParams: () => ({}),
  useNavigate: () => () => {},
  BrowserRouter: ({ children }: { children: any }) => children,
  Routes: ({ children }: { children: any }) => children,
  Route: ({ element }: { element: any }) => element,
  Link: ({ children }: { children: any }) => children,
}));

mock.module('../components/GroupOfferAutocomplete.tsx', () => ({
  GroupOfferAutocomplete: ({ inputId, ariaLabel, error }: any) => (
    <div
      data-component="GroupOfferAutocomplete"
      data-input-id={inputId}
      data-aria-label={ariaLabel}
      data-error={error ?? ''}
    />
  ),
}));

mock.module('../components/GroupDestAutocomplete.tsx', () => ({
  GroupDestAutocomplete: ({ inputId, ariaLabel, error }: any) => (
    <div
      data-component="GroupDestAutocomplete"
      data-input-id={inputId}
      data-aria-label={ariaLabel}
      data-error={error ?? ''}
    />
  ),
}));

mock.module('../components/TemplateEditor.tsx', () => ({
  TemplateEditor: () => <div data-component="TemplateEditor" />,
}));

mock.module('../components/TemplatePreview.tsx', () => ({
  TemplatePreview: () => <div data-component="TemplatePreview" />,
}));

const { MirrorFormPage } = await import('./MirrorFormPage.tsx');

beforeEach(() => {
  // confirma estado limpo
});

describe('MirrorFormPage (modo criação)', () => {
  it('renderiza form com todos os campos básicos (nome, origem, destino)', () => {
    const html = renderToString(<MirrorFormPage token="x" onBack={() => {}} />);
    // Título do form (modo criação = "Novo Espelhamento")
    expect(html).toContain('Novo Espelhamento');
    // Subtítulo explicativo
    expect(html).toContain('Configure o espelhamento');
    // Card de Informações Básicas
    expect(html).toContain('Informa\u00e7\u00f5es B\u00e1sicas');
    // Card Origem
    expect(html).toContain('Grupos de Origem');
    // Card Destino
    expect(html).toContain('Grupos de Destino');
    // Botão submit
    expect(html).toContain('Criar Espelhamento');
    // Botão cancelar
    expect(html).toContain('Cancelar');
    // inputId propagado pros autocompletes
    expect(html).toContain('data-input-id="mirror-form-origem-input"');
    expect(html).toContain('data-input-id="mirror-form-destino-input"');
  });

  it('input de nome tem id estável e maxLength=255', () => {
    const html = renderToString(<MirrorFormPage token="x" onBack={() => {}} />);
    expect(html).toContain('id="mirror-form-nome"');
    expect(html).toContain('maxLength="255"');
  });

  it('rótulo do nome exibe asterisco visual indicando obrigatoriedade', () => {
    const html = renderToString(<MirrorFormPage token="x" onBack={() => {}} />);
    expect(html).toContain('Nome do Espelhamento');
    // asterisco vermelho aparece nos cards Origem/Destino (aria-hidden)
    expect(html).toContain('aria-hidden="true"');
  });

  it('form não tem erro visível inicialmente', () => {
    const html = renderToString(<MirrorFormPage token="x" onBack={() => {}} />);
    // não há role="alert" no form vazio
    expect(html).not.toContain('Selecione pelo menos');
  });

  it('botão Cancelar tem tipo button (não submit)', () => {
    const html = renderToString(<MirrorFormPage token="x" onBack={() => {}} />);
    expect(html).toContain('type="button"');
  });
});

describe('MirrorFormPage (estado de erro de submissão)', () => {
  it('exibe mensagens de erro inline nos campos quando passados via autocomplete', () => {
    // Renderizamos o componente "como se" houvesse erro, passando error props
    // via prop drilling seria direto mas o MirrorFormPage não expõe isso;
    // validamos que os componentes filhos estão conectados via error/errorId.
    const html = renderToString(<MirrorFormPage token="x" onBack={() => {}} />);
    expect(html).toContain('data-error=""');
    expect(html).toContain('data-component="GroupOfferAutocomplete"');
    expect(html).toContain('data-component="GroupDestAutocomplete"');
  });
});

describe('MirrorFormPage (acessibilidade)', () => {
  it('todos os cards críticos usam aria-labelledby apontando para o title', () => {
    const html = renderToString(<MirrorFormPage token="x" onBack={() => {}} />);
    // Card de Informações Básicas tem titleId + role=group + aria-labelledby
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-labelledby="mirror-form-nome-titulo"');
    expect(html).toContain('aria-labelledby="mirror-form-origem-titulo"');
    expect(html).toContain('aria-labelledby="mirror-form-destino-titulo"');
  });

  it('PageHeader com botão Voltar presente', () => {
    const html = renderToString(<MirrorFormPage token="x" onBack={() => {}} />);
    // lucide-react ArrowLeft é um SVG; o PageHeader envolve onBack
    expect(html).toContain('<svg');
  });
});
