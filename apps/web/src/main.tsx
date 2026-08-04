import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { installAuthInterceptor } from './lib/auth-interceptor.ts';

// Interceptor de fetch: renovação proativa + refresh no 401.
installAuthInterceptor();
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import '@omestre/ui/globals.css';

// Prevent flash of wrong theme — restore from localStorage before React renders
(function () {
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch {}
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
