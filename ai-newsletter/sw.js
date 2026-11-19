// ERGS AI has moved to /ergs-ai/. This worker clears the old cache, removes itself and sends open windows to the new address.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('https://popcorn483.github.io/ergs-ai/');
})()));
self.addEventListener('fetch', () => {});
