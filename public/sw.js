// Service worker for the phone app (installed as a PWA from the home server). Games and the coach
// need the computer; this makes the shell load fast and lets the app open without it, where
// puzzles and drills run from the pack the phone keeps (src/offline.ts) with the engine files
// cached here.
const CACHE = "chesscoach-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Hashed build output and the engine files never change under the same URL.
const immutable = (path) => /^\/(assets|stockfish|maia3|icons|pieces)\//.test(path);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") return e.respondWith(page(e));
  e.respondWith(immutable(url.pathname) ? cacheFirst(e.request) : networkFirst(e.request));
});

/**
 * The page itself: the one kept from last time, at once, so reopening the app after the phone
 * dropped it doesn't wait on the computer. The computer's current page is fetched alongside and
 * kept for next time; if it changed (the app was updated), the page is told so it can reload
 * while it's in the background (pwa.ts). With nothing usable kept, it waits for the computer.
 */
async function page(e) {
  const fresh = fetch(e.request).then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(e.request, res.clone());
    return res;
  });
  const kept = await caches.match(e.request);
  if (!kept || !(await assetsKept(kept.clone()))) return fresh.catch(() => kept ?? Response.error());
  const before = await kept.clone().text();
  e.waitUntil(
    fresh
      .then(async (res) => {
        if (!res.ok || (await res.clone().text()) === before) return;
        for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "page-updated" });
      })
      .catch(() => {}),
  );
  return kept;
}

/**
 * Whether the build files a kept page loads are all kept too. An old page whose files were
 * dropped can't load them from the computer any more (a newer build replaced them).
 */
async function assetsKept(res) {
  const html = await res.text();
  const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  for (const url of urls) if (!(await caches.match(url))) return false;
  return true;
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
