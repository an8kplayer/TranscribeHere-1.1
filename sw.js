const CACHE_NAME = "transcribehere-v3";

const FILES_TO_CACHE = [
  "index.html",
  "exam.html",
  "result.html",
  "kc-matters.html",
  "ramdhari-khand-1.html",
  "style.css",
  "script.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  // Network-first for HTML/JS/CSS so deployments are not trapped behind
  // an old service-worker cache. Fall back to cache when offline.
  const url = new URL(event.request.url);
  const isAppAsset =
    url.origin === self.location.origin &&
    /\.(html|js|css|json)$/i.test(url.pathname);

  if (isAppAsset) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
