// Is a newer version deployed? (docs/deployment.md) The server says which frontend and which
// desktop program are live (/api/version); this page knows which frontend it is (VITE_UI_VERSION,
// set by the deploy) and the desktop app says which program it is (window.__CC_SHELL__). Only a
// change to the device's own part offers an update: a server-only deploy needs nothing.
import { create } from "zustand";
import { isShell, listen, serverUrl } from "./backend";

declare global {
  interface Window {
    /** Set by the desktop program (src-tauri/src/lib.rs): which build of it this is. */
    __CC_SHELL__?: { version?: string } | null;
  }
}

/** The frontend this page was built as; "dev" under `npm run dev`, which never asks to update. */
export const UI_VERSION: string = import.meta.env.VITE_UI_VERSION || "dev";

type Deployed = { commit?: string; subject?: string; ui?: string; shell?: string };

export const useUpdate = create<{
  /** The page is older than the deployed frontend: a reload brings the new one. */
  page: boolean;
  /** The desktop program itself changed: it has to restart (and rebuild) to update. */
  program: boolean;
  deployed: Deployed | null;
}>(() => ({ page: false, program: false, deployed: null }));

export async function checkForUpdate() {
  let v: Deployed;
  try {
    const res = await fetch(`${serverUrl()}/api/version`, { cache: "no-store" });
    if (!res.ok) return;
    v = await res.json();
  } catch {
    return; // Offline: nothing to compare with.
  }
  const shell = window.__CC_SHELL__?.version;
  useUpdate.setState({
    deployed: v,
    page: UI_VERSION !== "dev" && !!v.ui && v.ui !== UI_VERSION,
    program: isShell && !!shell && shell !== "dev" && !!v.shell && v.shell !== shell,
  });
}

/**
 * Checks at startup, whenever the event stream comes back (a deploy restarts the server, so every
 * client reconnects right after one) and every 10 minutes in case that was missed.
 */
export function watchForUpdates() {
  // Opening the app gets the newest page: the service worker hands out its kept copy first, so a
  // stale one found right at startup reloads by itself (once per version, so it can't loop).
  void checkForUpdate().then(() => {
    const { page, program, deployed } = useUpdate.getState();
    if (!page || program || !deployed?.ui) return;
    try {
      if (sessionStorage.getItem("cc-reloaded-for") === deployed.ui) return;
      sessionStorage.setItem("cc-reloaded-for", deployed.ui);
    } catch {
      return;
    }
    void applyUpdate();
  });
  void listen("resync", () => void checkForUpdate());
  window.setInterval(() => void checkForUpdate(), 10 * 60_000);
}

/** The address the desktop program watches for: leaving the page there restarts it (lib.rs). */
const RELAUNCH = "https://relaunch.chesscoach.invalid/";

/**
 * Brings the update in. A new program means restarting it (it fetches and builds the new one
 * first). A new page only needs a reload, past the service worker's kept copy: fetching the page
 * through it stores the server's current one, which the reload then gets.
 */
export async function applyUpdate() {
  if (useUpdate.getState().program) {
    location.href = RELAUNCH;
    return;
  }
  try {
    await fetch(location.pathname + location.search, { cache: "reload" });
  } catch {
    // Reload anyway: the service worker falls back to the server.
  }
  location.reload();
}
