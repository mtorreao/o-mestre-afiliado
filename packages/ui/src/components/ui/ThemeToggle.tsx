/**
 * ThemeToggle — Button to switch between light and dark themes
 *
 * Uses the useTheme hook. Renders a Sun icon in dark mode (to switch to light)
 * and a Moon icon in light mode (to switch to dark).
 */
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.tsx';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle-btn"
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={isDark ? 'Tema claro' : 'Tema escuro'}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
