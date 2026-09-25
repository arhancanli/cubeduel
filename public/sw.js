/*
 * cubeduel's service worker: what lets the timer and the keyboard cube open
 * with no connection, once they have been visited.
 *
 * Deliberately small, because a service worker that caches the wrong thing
 * serves it forever:
 *   - /api/* is never touched. Ratings, races, sign-in and sync are always live.
 *   - Pages are network-first: online, you always get the current page; the
 *     saved copy is only for when the network is gone.
 *   - /_next/static/ files are content-hashed and never change, so they are
 *     served from the cache once saved.
 *   - A new CACHE name drops every old copy on the next visit.
 */
const CACHE = "cubeduel-v1";
const SHELL = ["/timer", "/play", "/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("/timer")).then((hit) => hit || Response.error()),
        ),
    );
  }
});
