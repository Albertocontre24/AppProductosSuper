const C = 'super-v7', F = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg', 'fonts/BarlowCondensed-600.woff2', 'fonts/BarlowCondensed-800.woff2', 'firebase-config.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(F))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));
