/**
 * Toast — Notificações via Radix Toast
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import * as RadixToast from '@radix-ui/react-toast';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';
interface ToastData { id: string; title: string; description?: string; variant: ToastVariant; }

const ToastContext = createContext<{ addToast: (title: string, description?: string, variant?: ToastVariant) => void }>({ addToast: () => {} });
export const useToast = () => useContext(ToastContext);

const iconMap = { success: CheckCircle, error: AlertCircle, warning: AlertTriangle, info: Info };
const colorMap = { success: 'var(--color-success)', error: 'var(--color-error)', warning: 'var(--color-warning)', info: 'var(--color-primary)' };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const addToast = useCallback((title: string, description?: string, variant: ToastVariant = 'info') => {
    setToasts((prev) => [...prev, { id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title, description, variant }]);
  }, []);
  const removeToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {toasts.map((toast) => {
          const Icon = iconMap[toast.variant];
          const accentColor = colorMap[toast.variant];
          return (
            <RadixToast.Root key={toast.id} className="ToastRoot" open onOpenChange={() => removeToast(toast.id)} duration={5000} style={{ borderLeft: `4px solid ${accentColor}` }}>
              <RadixToast.Title className="ToastTitle" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Icon size={16} style={{ color: accentColor, flexShrink: 0 }} /> {toast.title}
              </RadixToast.Title>
              {toast.description && <RadixToast.Description className="ToastDescription">{toast.description}</RadixToast.Description>}
              <RadixToast.Action asChild altText="Fechar">
                <button onClick={() => removeToast(toast.id)} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0.2rem', borderRadius: 'var(--radius-sm)', display: 'flex' }} aria-label="Close">
                  <X size={14} />
                </button>
              </RadixToast.Action>
            </RadixToast.Root>
          );
        })}
        <RadixToast.Viewport className="ToastViewport" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
