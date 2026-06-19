import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

async function init() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = await res.json();
      (window as any).__SUPABASE_CONFIG__ = config;
      console.log('[Supabase] Configuração injetada dinamicamente:', config.supabaseUrl ? 'Sucesso' : 'Vazio');
    }
  } catch (err) {
    console.warn('[Supabase] Erro ao carregar configuração dinâmica, usando fallback estático:', err);
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

init();

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Registra o Service Worker do PWA para fornecer suporte offline e instalação nativa no Android
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('[PWA] Service Worker registrado com sucesso no escopo:', registration.scope);
      })
      .catch(error => {
        console.error('[PWA] Falha ao registrar o Service Worker:', error);
      });
  });
}
