/* Service worker: gemmer appens filer, så den også virker uden internet.
 * Strategi: svar straks fra cachen og hent en frisk version i baggrunden
 * (stale-while-revalidate), så opdateringer slår igennem ved næste åbning. */
var CACHE = 'stemmeapparat-v2';
var FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/audio.js',
  'js/tunings.js',
  'js/pitch.js',
  'js/app.js',
  'js/drone.js',
  'js/metronome.js',
  'js/chords.js',
  'js/ear.js',
  'js/practice.js',
  'js/nav.js',
  'js/pwa.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (cached) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () { return cached; });
      return cached || fresh;
    });
  }));
});
