/* Service worker: offline shell.
   Same-origin files are NETWORK-FIRST with revalidation (so a fresh launch shows the latest deploy when
   online) and fall back to the cache when offline or slow. cdnjs libraries (jsPDF) are cache-first.
   VERSION must match APP_VERSION in app.js; bump both on every deploy. */
const VERSION = '0.5';
const CACHE = `he-shell-v${VERSION}`;
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'sw-activated', version: VERSION }));
  })());
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'skip-waiting') self.skipWaiting(); });

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, err => { clearTimeout(t); reject(err); });
  });
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      try {
        const res = await withTimeout(fetch(req, { cache: 'no-cache' }), NETWORK_TIMEOUT_MS);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const cached = await cache.match(req, { ignoreSearch: true });
        return cached || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
      }
    }));
  } else if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(req)) || fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; })));
  }
});
