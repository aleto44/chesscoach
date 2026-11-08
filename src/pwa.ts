// Phone install support: the service worker only runs where the browser allows one (https, or
// localhost), which is what Tailscale's https address is for.
import { isRemote } from "./backend";

export function registerServiceWorker() {
  if (!isRemote || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker not registered", e));
  // The page opened from the phone's copy and the computer has a newer one: swap to it the next
  // time the app is in the background, rather than under the student's fingers.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type !== "page-updated") return;
    const swap = () => document.visibilityState === "hidden" && location.reload();
    document.addEventListener("visibilitychange", swap);
  });
}
