import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    // Em desenvolvimento (Preview do AI Studio), desativar e desregistrar SWs existentes para evitar travamentos de iframe/reload
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().then((unregistered) => {
          if (unregistered) {
            console.log('[PWA] Service Worker desregistrado em ambiente de desenvolvimento:', registration.scope);
          }
        });
      }
    });
  } else {
    // Em produção (PWA na Vercel / Live), registrar normalmente o Service Worker
    const registerSW = () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('[PWA] Service Worker registrado com sucesso:', registration.scope);
        })
        .catch((error) => {
          console.error('[PWA] Falha ao registrar Service Worker:', error);
        });
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
    }
  }
}