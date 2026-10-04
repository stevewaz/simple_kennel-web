// Offline app shell for Simple Kennel (web).
//
// Flutter's generated service worker no longer caches anything, so without this the page
// can't be opened with no connection. The kennel's *data* is already on the device (Isar);
// this worker only keeps the app's own files so the app can start offline.
//
// Strategy: network-first for this site's own files, falling back to the last good copy
// when the network fails or is too slow. Online it always serves fresh files (so a new
// deploy shows up on the next load); offline it serves what was last fetched. Requests to
// other origins (Firebase, Google) are never touched.
'use strict';

const CACHE = 'kennel-shell-v1';
const SLOW_MS = 4000;

// Fetched up front so the app can start offline even before every screen has been visited.
// Everything else (canvaskit, fonts, icons) is cached as it is first used.
const CORE = [
  './',
  'index.html',
  'flutter_bootstrap.js',
  'main.dart.js',
  'manifest.json',
  'isar_plus.js',
  'isar_plus.wasm',
  'favicon.png',
  'icons/Icon-192.png',
  'icons/Icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing file must not abort the whole install.
      .then((cache) => Promise.all(CORE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('kennel-shell-') && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  });
  network.catch(() => {}); // handled below; avoids an unhandled rejection if the cache wins

  // A slow connection: after SLOW_MS use the saved copy if there is one, else keep waiting.
  const slow = new Promise((resolve) => {
    setTimeout(async () => resolve((await lookup(cache, request)) || network), SLOW_MS);
  });

  try {
    return await Promise.race([network, slow]);
  } catch (error) {
    // Network failed outright (offline): serve the last good copy.
    const saved = await lookup(cache, request);
    if (saved) return saved;
    throw error;
  }
}

async function lookup(cache, request) {
  const exact = await cache.match(request, { ignoreSearch: true });
  if (exact) return exact;
  // Opening the app at any URL inside the site (e.g. after a reload) gets the app shell.
  if (request.mode === 'navigate') return cache.match('index.html');
  return undefined;
}
