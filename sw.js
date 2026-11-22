// Offline shell + cache for the OCR engine and Thai/English language data.
const VERSION = 'rs-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'ocr-parse.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-180.png'];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Network first so updates show up; fall back to cache when offline.
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  if (CDN.test(req.url)) {
    // Versioned CDN files never change: cache first.
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  }
  // Everything else (Google sign-in, Drive API) goes straight to the network.
});
