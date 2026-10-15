// sw.js — precache the app shell so the cached reading, the action plan and the
// facility list open instantly and offline (NFR-04). API calls and map tiles are
// NOT cached here: the app caches readings in localStorage with their age, and
// OSM tiles stay in the browser's own HTTP cache (tile usage policy, §9.4).
const VERSION = 'bscv-v0.1.0';
const SHELL = [
  './', 'index.html', 'manifest.json',
  'css/app.css',
  'js/app.js', 'js/api.js', 'js/decide.js', 'js/storage.js', 'js/today.js', 'js/forecast.js', 'js/plan.js', 'js/nearby.js',
  'data/guidance.json', 'data/zips.json', 'data/facilities.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'fonts/nunito-latin-400-normal.woff2', 'fonts/nunito-latin-600-normal.woff2', 'fonts/nunito-latin-800-normal.woff2', 'fonts/nunito-latin-900-normal.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Only same-origin shell files are served from the cache (stale-while-revalidate).
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
