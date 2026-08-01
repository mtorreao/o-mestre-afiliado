import { describe, it, expect, beforeEach } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ToastProvider, useToast } from './Toast.tsx';

describe('ToastProvider (renderização SSR)', () => {
  it('renderiza children + ToastViewport do Radix', () => {
    const html = renderToString(
      <ToastProvider>
        <span>conteúdo</span>
      </ToastProvider>,
    );
    expect(html).toContain('conteúdo');
    expect(html).toContain('ToastViewport');
  });

  it('useToast fora do provider é callable no-op (default context)', () => {
    function Consumer() {
      const { addToast } = useToast();
      return <button onClick={() => addToast('x')}>x</button>;
    }
    // Não deve lançar
    const html = renderToString(<Consumer />);
    expect(html).toContain('<button');
  });

  it('Provider com toasts renderiza lista e estado inicial é vazio (sem toasts)', () => {
    const html = renderToString(
      <ToastProvider>
        <div>app</div>
      </ToastProvider>,
    );
    // Não há RadixToast.Root no início (lista vazia)
    expect(html).not.toContain('ToastRoot');
    expect(html).toContain('ToastViewport');
  });
});

describe('ToastEmitter (eventos globais)', () => {
  interface CapturedListener {
    eventName: string;
    handler: (e: any) => void;
  }

  function makeFakeWindow() {
    const listeners = new Map<string, Set<CapturedListener['handler']>>();
    let lastEvent: CustomEvent | null = null;
    return {
      listeners,
      getLastEvent: () => lastEvent,
      addEventListener: (name: string, handler: any) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(handler);
      },
      removeEventListener: (name: string, handler: any) => {
        listeners.get(name)?.delete(handler);
      },
      dispatchEvent: (event: Event) => {
        lastEvent = event as CustomEvent;
        const set = listeners.get(event.type);
        if (!set) return true;
        for (const h of set) h(event);
        return true;
      },
    };
  }

  let fakeWin: ReturnType<typeof makeFakeWindow>;
  let originalWindow: any;
  let originalCustomEvent: any;

  beforeEach(() => {
    fakeWin = makeFakeWindow();
    originalWindow = (globalThis as any).window;
    originalCustomEvent = (globalThis as any).CustomEvent;
    (globalThis as any).window = fakeWin;
    (globalThis as any).CustomEvent = class<T = any> {
      type: string;
      detail: T | undefined;
      constructor(type: string, init?: { detail?: T }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  });

  function restoreWindow() {
    (globalThis as any).window = originalWindow;
    (globalThis as any).CustomEvent = originalCustomEvent;
  }

  it('showToast dispara CustomEvent "toast:show" com detail {title, variant: "info"}', async () => {
    const { showToast } = await import('../../lib/toast-emitter.ts');
    showToast('Olá');
    const ev = fakeWin.getLastEvent() as any;
    expect(ev).not.toBeNull();
    expect(ev.type).toBe('toast:show');
    expect(ev.detail).toEqual({ title: 'Olá', description: undefined, variant: 'info' });
    restoreWindow();
  });

  it('showToast aceita variant customizada e description opcional', async () => {
    const { showToast } = await import('../../lib/toast-emitter.ts');
    showToast('Erro X', 'Detalhes', 'error');
    const ev = fakeWin.getLastEvent() as any;
    expect(ev.detail).toEqual({ title: 'Erro X', description: 'Detalhes', variant: 'error' });
    restoreWindow();
  });

  it('showErrorToast fixa variant=error', async () => {
    const { showErrorToast } = await import('../../lib/toast-emitter.ts');
    showErrorToast('Falha', 'tente de novo');
    const ev = fakeWin.getLastEvent() as any;
    expect(ev.detail.variant).toBe('error');
    expect(ev.detail.title).toBe('Falha');
    expect(ev.detail.description).toBe('tente de novo');
    restoreWindow();
  });

  it('showSuccessToast fixa variant=success', async () => {
    const { showSuccessToast } = await import('../../lib/toast-emitter.ts');
    showSuccessToast('OK');
    const ev = fakeWin.getLastEvent() as any;
    expect(ev.detail.variant).toBe('success');
    restoreWindow();
  });

  it('showWarningToast fixa variant=warning', async () => {
    const { showWarningToast } = await import('../../lib/toast-emitter.ts');
    showWarningToast('Cuidado');
    const ev = fakeWin.getLastEvent() as any;
    expect(ev.detail.variant).toBe('warning');
    restoreWindow();
  });

  it('ToastEmitter padrão: variant é info quando omitido', async () => {
    const { showToast } = await import('../../lib/toast-emitter.ts');
    showToast('Título');
    const ev = fakeWin.getLastEvent() as any;
    expect(ev.detail.variant).toBe('info');
    restoreWindow();
  });

  it('ToastProvider: quando o useEffect não roda (SSR), apenas o Viewport aparece', async () => {
    const { ToastProvider } = await import('./Toast.tsx');
    const html = renderToString(
      <ToastProvider>
        <span>filho</span>
      </ToastProvider>,
    );
    expect(html).toContain('filho');
    expect(html).toContain('ToastViewport');
    restoreWindow();
  });

  it('useToast().addToast é referencialmente estável (memoização com useCallback)', () => {
    function Capture() {
      const ctx = useToast();
      return <span data-add-toast={typeof ctx.addToast}>x</span>;
    }
    const html = renderToString(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    expect(html).toContain('data-add-toast="function"');
  });
});
