/**
 * Service worker for the Override card builder PWA (offline + installable).
 *
 * Strategy:
 *   - Navigations: network-first (always try the fresh app), fall back to the
 *     cached shell when offline.
 *   - Static assets + data (indexes, unit files, icons): cache-first, populated
 *     on first fetch — so once you've visited, it works offline, and the big
 *     RAT/unit data is cached as you use it.
 *
 * Bump CACHE to invalidate after a deploy.
 */
// The version below is stamped per build (scripts/inline.mjs) so every deploy
// uses a fresh cache name — old caches (incl. stale MUL data) clear on activate.
const CACHE = "override-__SW_VERSION__";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
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
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
