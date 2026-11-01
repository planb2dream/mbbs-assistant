/* Service worker: makes the app work offline.
   It saves (caches) every file listed below on first visit,
   then serves them from the phone with no internet. */
importScripts('./version.js');

var CACHE_NAME = 'mbbs-assistant-' + APP_VERSION;

// EVERY file the app needs must be listed here.
// When you add a new file in a later phase, add it to this list too.
var FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './cases.js',
  './database.js',
  './engines.js',
  './symptoms.json',
  './diseases.json',
  './red-flags.json',
  './packs.json',
  './pack-complaints.json',
  './pack-dermatology.json',
  './version.js',
  './manifest.json',
  './departments.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // cache:'reload' forces a fresh download, not an old browser copy
      return Promise.all(FILES_TO_CACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }));
      }));
    })
  );
  // We do NOT skip waiting here. The app shows an "Update" button,
  // so an update never interrupts a case you are typing.
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) {
        return n.indexOf('mbbs-assistant-') === 0 && n !== CACHE_NAME;
      }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: APP_VERSION });
  }
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never touch other websites

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).catch(function () {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('Offline and not cached', { status: 503 });
      });
    })
  );
});
