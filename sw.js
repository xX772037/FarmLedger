// Offline support: keep the app's own files on the device so it opens with no signal on the farm.
// Every file the app loads must be listed here (test/offline.test.js checks it), or it won't open offline.
const CACHE = 'farmledger-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg',
  'src/app.js',
  'src/core/account.js', 'src/core/backup.js', 'src/core/dates.js', 'src/core/db.js', 'src/core/entities.js', 'src/core/farm.js', 'src/core/ids.js',
  'src/core/inventory.js', 'src/core/links.js', 'src/core/migrate.js', 'src/core/modules.js', 'src/core/money.js', 'src/core/permissions.js',
  'src/core/reminders.js', 'src/core/schema.js', 'src/core/store.js', 'src/core/ui.js',
  'src/modules/crops/index.js', 'src/modules/herd/index.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// The network when there is signal (so updates arrive), the stored copy when there isn't.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});
