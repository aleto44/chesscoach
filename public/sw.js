// Service worker for the phone app (installed as a PWA from the home server). Games and the coach
// need the computer; this makes the shell load fast and lets the app open without it, where
// puzzles and drills run from the pack the phone keeps (src/offline.ts) with the engine files
// cached here.
const CACHE = "chesscoach-v1";

/**
 * A response from the computer worth using. With the app down, Tailscale serve still answers
 * (502/503/504), and handing that to the page instead of the kept copy left a blank screen.
 */
const usable = (res) => res.ok;
/** Fetches from the computer, failing when it can't really answer, so callers fall back. */
async function reach(req) {
  const res = await fetch(req);
  if (res.status >= 500) throw new Error(`computer answered ${res.status}`);
  return res;
}

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
  const fresh = reach(e.request).then(async (res) => {
    if (usable(res)) await (await caches.open(CACHE)).put(e.request, res.clone());
    return res;
  });
  const kept = await caches.match(e.request);
  if (!kept || !(await assetsKept(kept.clone()))) return fresh.catch(() => kept ?? unreachablePage());
  const before = await kept.clone().text();
  e.waitUntil(
    fresh
      .then(async (res) => {
        if (!usable(res) || (await res.clone().text()) === before) return;
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
  if (usable(res)) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await reach(req);
    if (usable(res)) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    throw err;
  }
}

/**
 * Shown when the computer can't answer and the phone has no copy of the app yet (first open, or
 * the copy was cleared). Tries again by itself, so it turns into the app once the computer is back.
 */
function unreachablePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#24221f"><title>Chess Coach</title>
<style>html,body{margin:0;height:100%;background:#1b1a18;color:#e8e6e3;font:16px/1.4 system-ui,sans-serif}
main{height:100%;display:grid;place-content:center;gap:14px;text-align:center;padding:24px}
.mark{font-size:56px;color:#6fbf7f}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#d9534f;margin-right:6px}
button{font:inherit;padding:10px 20px;border-radius:8px;border:0;background:#6fbf7f;color:#1b1a18}
small{color:#9a968f}</style></head><body><main>
<div class="mark">♞</div><div><span class="dot"></span><b>Can't reach your computer</b></div>
<small>Chess Coach isn't running on it, or it's asleep or off the network.<br>This page opens the app as soon as it answers.</small>
<div><button onclick="location.reload()">Try again</button></div>
</main><script>
setInterval(()=>fetch("/api/ping",{cache:"no-store"}).then(r=>r.status<500&&location.reload()).catch(()=>{}),5000);
</script></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
