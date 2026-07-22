/**
 * ToastEmitter — Event-based global toast dispatch
 *
 * Permite que qualquer código (inclusive utils que não são hooks)
 * dispare toasts sem depender do contexto React.
 *
 * O ToastProvider escuta os eventos 'toast:show' e renderiza.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastEventDetail {
  title: string;
  description?: string;
  variant: ToastVariant;
}

const TOAST_EVENT = 'toast:show';

export function showToast(title: string, description?: string, variant: ToastVariant = 'info'): void {
  window.dispatchEvent(
    new CustomEvent<ToastEventDetail>(TOAST_EVENT, {
      detail: { title, description, variant },
    }),
  );
}

export function showErrorToast(title: string, description?: string): void {
  showToast(title, description, 'error');
}

export function showSuccessToast(title: string, description?: string): void {
  showToast(title, description, 'success');
}

export function showWarningToast(title: string, description?: string): void {
  showToast(title, description, 'warning');
}
