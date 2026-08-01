/**
 * useTheme — Theme state management with localStorage persistence
 *
 * - Manages 'light' | 'dark' theme
 * - Persists to localStorage key 'theme'
 * - Sets data-theme attribute on <html> element
 * - Exports ThemeProvider context and useTheme hook
 *
 * A lógica de decisão (resolveInitialTheme, resolveNextTheme, THEME_STORAGE_KEY)
 * vive em `useTheme-pure.ts` para cobertura unitária sem mockar DOM/storage.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  resolveInitialTheme,
  resolveNextTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from './useTheme-pure.ts';

function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return resolveInitialTheme(stored);
  }
  return resolveInitialTheme(undefined);
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(THEME_STORAGE_KEY, t);
    applyTheme(t);
  };

  const toggleTheme = () => {
    setTheme(resolveNextTheme(theme));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
