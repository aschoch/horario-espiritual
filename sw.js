/* Service worker: offline shell. Same-origin files are served stale-while-revalidate (instant load,
   updates land on the next launch). cdnjs libraries (jsPDF) are cached on first use.
   Bump CACHE on every deploy that changes app files. */
const CACHE = 'he-shell-v0.3';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await network) || cache.match('./index.html');
    }));
  } else if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(req)) || fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; })));
  }
});
