/* Mon Patrimoine — service worker de la version en ligne
   Réseau d'abord (toujours la dernière version), copie locale si pas de réseau.
   Ne touche jamais aux appels externes (cours, groupe, sauvegarde). */
const CACHE = 'mon-patrimoine-v1';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html')) || Response.error();
    }
  })());
});
