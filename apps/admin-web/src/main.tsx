import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import '@omestre/ui/globals.css';
import './admin-styles.css';

// Admin Center é dark-first: força data-theme='dark' antes do React renderizar
// (previne flash de tema claro). O tokens.css do @omestre/ui ativa o dark
// via [data-theme='dark'] no <html>.
(function () {
  document.documentElement.setAttribute('data-theme', 'dark');
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
