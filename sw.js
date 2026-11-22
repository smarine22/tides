// Offline support: keep the app's files on the phone. Bump VERSION whenever any file changes
// (tools/build.py does this automatically), so phones pick up the new tide data.
const VERSION = "tides-20261122-154558";
const FILES = ["./", "index.html", "tides-data.js", "tide.js", "app.js", "unlock.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// network first (so updates arrive when online), fall back to the stored copy when offline.
// Only good responses are used or stored: if the site is later taken down (404), the phone
// keeps using its saved copy instead of overwriting it with the error page.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const stored = () => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"));
  e.respondWith(fetch(e.request).then((r) => {
    if (!r.ok) return stored().then((c) => c || r);
    const c = r.clone(); caches.open(VERSION).then((cc) => cc.put(e.request, c)); return r;
  }).catch(stored));
});
