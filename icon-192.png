const CACHE_NAME = 'encomendas-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Instalação: Cacheia os recursos básicos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Ativação: Limpa caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Estratégia Network First com fallback para Cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Permite apenas protocolos HTTP e HTTPS para evitar erros com extensões do Chrome, etc.
  if (!url.protocol.startsWith('http')) return;

  // NÃO cachear chamadas de API ou Supabase
  if (url.pathname.startsWith('/api') || url.hostname.includes('supabase.co')) {
    return;
  }

  // Apenas métodos GET
  if (request.method !== 'GET') return;

  // Tratamento especial para solicitações de navegação (HTML de páginas do React Router)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Se falhar a navegação (offline), serve o index.html como fallback para o React Router
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Se a resposta for válida, coloca no cache e retorna
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Se falhar (offline), busca no cache
        return caches.match(request);
      })
  );
});
