const CACHE_NAME = 'nexa-cache-v6';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];
const isCodespacesPreview = /^[a-z0-9-]+-5173\.app\.github\.dev$/i.test(self.location.hostname);

if (isCodespacesPreview) {
  self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

  self.addEventListener('activate', event => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('nexa-cache-')).map(key => caches.delete(key)));
      const clients = await self.clients.matchAll({ type: 'window' });
      await Promise.all(clients.map(client => client.navigate(client.url).catch(() => {})));
      await self.registration.unregister();
    })());
  });

  self.addEventListener('fetch', event => {
    if (event.request.method === 'GET') event.respondWith(fetch(event.request));
  });
} else {
  self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
  });

  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
  });

  self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) return;
    const pathname = requestUrl.pathname;
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/auth' || pathname.startsWith('/auth/')) return;

    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached && event.request.mode !== 'navigate') return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return cached || await caches.match('/index.html');
      }
    })());
  });
}
