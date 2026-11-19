// AI in School: lets phones install the library as an app and read released issues offline.
// Pages and code come fresh from the network when online; issue files (encrypted) are kept for offline reading.
const CACHE = 'ainl-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'crest.js', 'share.js', 'tips.js', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || e.request.cache === 'no-store') return;   // update checks go straight to GitHub
  if (/\/img\/.+\.bin$/.test(u.pathname)) {   // page images never change: cache first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return res; })));
    return;
  }
  e.respondWith(fetch(e.request).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); } return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
