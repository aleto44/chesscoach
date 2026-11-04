// Service worker for the phone app (installed as a PWA from the home server). The app needs the
// computer for games, the coach and the database, so this only makes the shell load fast and
// lets the app open (and say it can't reach the computer) when it's off.
const CACHE = "chesscoach-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Hashed build output and the engine files never change under the same URL.
const immutable = (path) => /^\/(assets|stockfish|maia3|icons)\//.test(path);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(immutable(url.pathname) ? cacheFirst(e.request) : networkFirst(e.request));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    throw err;
  }
}
