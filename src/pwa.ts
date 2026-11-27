// The service worker (public/sw.js): lets the phone install the app and every client, the desktop
// app included, open without the server. It only runs where the browser allows one (https, or
// localhost), which is what Tailscale's https address is for.
import { isPhone } from "./backend";

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker not registered", e));
  // The page opened from the phone's copy and the server has a newer one: swap to it the next
  // time the app is in the background, rather than under the student's fingers.
  // The desktop asks first instead (src/update.ts, the top bar's Update).
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type !== "page-updated" || !isPhone) return;
    const swap = () => document.visibilityState === "hidden" && location.reload();
    document.addEventListener("visibilitychange", swap);
  });
}
