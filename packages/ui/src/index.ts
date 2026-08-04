/**
 * @omestre/ui — Design system compartilhado entre apps.
 *
 * Tokens CSS (tokens.css) + componentes React (components/ui/) + hooks
 * de tema/media-query (hooks/). Importe como:
 *
 *   import { Button, Card, Input } from '@omestre/ui';
 *   import '@omestre/ui/globals.css';   // reset + tokens + Radix styles
 *
 * Tema: `data-theme='dark'` no <html> ativa dark mode (ver tokens.css).
 */

// ─── Componentes ─────────────────────────────────────────────────────────
export { ThemeToggle } from './components/ui/ThemeToggle.tsx';
export { Button } from './components/ui/Button.tsx';
export { Input } from './components/ui/Input.tsx';
export { Card } from './components/ui/Card.tsx';
export { Badge } from './components/ui/Badge.tsx';
export { Select } from './components/ui/Select.tsx';
export { Dialog } from './components/ui/Dialog.tsx';
export { Tabs } from './components/ui/Tabs.tsx';
export { Loading, LoadingSkeleton } from './components/ui/Loading.tsx';
export { ToastProvider, useToast } from './components/ui/Toast.tsx';
export { Checkbox } from './components/ui/Checkbox.tsx';
export { Switch } from './components/ui/Switch.tsx';
export { BottomSheet } from './components/ui/BottomSheet.tsx';
export { FilterBar } from './components/ui/FilterBar.tsx';
export { MobileFilterBar } from './components/ui/MobileFilterBar.tsx';

// ─── Hooks ───────────────────────────────────────────────────────────────
export { ThemeProvider, useTheme } from './hooks/useTheme.tsx';
export { useMediaQuery } from './hooks/useMediaQuery.ts';
export {
  resolveInitialTheme,
  resolveNextTheme,
  coerceTheme,
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  type Theme,
} from './hooks/useTheme-pure.ts';

// ─── Toast emitter (event-based, fora de hooks) ──────────────────────────
export {
  showToast,
  showErrorToast,
  showSuccessToast,
  showWarningToast,
} from './lib/toast-emitter.ts';
export type { ToastVariant, ToastEventDetail } from './lib/toast-emitter.ts';
