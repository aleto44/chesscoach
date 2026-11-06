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
  if (e.request.mode === "navigate") return e.respondWith(page(e));
  e.respondWith(immutable(url.pathname) ? cacheFirst(e.request) : networkFirst(e.request));
});

/** How long reopening the app waits for the computer before showing the page it had last time. */
const PAGE_WAIT = 1200;

/**
 * The page itself: the computer's current one when it answers quickly, else the last one kept,
 * so coming back to the app after the phone dropped it doesn't sit on a blank screen while the
 * network wakes up. The fresh page is still kept for next time.
 */
async function page(e) {
  const fresh = fetch(e.request).then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(e.request, res.clone());
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  const kept = await caches.match(e.request);
  if (!kept) return fresh;
  const wait = new Promise((resolve) => setTimeout(() => resolve(kept), PAGE_WAIT));
  return Promise.race([fresh.catch(() => kept), wait]);
}

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
