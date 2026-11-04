// Phone install support: the service worker only runs where the browser allows one (https, or
// localhost), which is what Tailscale's https address is for.
import { isRemote } from "./backend";

export function registerServiceWorker() {
  if (!isRemote || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker not registered", e));
}
