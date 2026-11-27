// How the frontend reaches Chess Coach's server (server/, docs/server-migration.md): HTTP for
// commands and server-sent events for what the server announces. Every window is a client of it,
// and every one loads this page from the server: the phone's web app and the desktop app (a Tauri
// window opened at the server's address, docs/deployment.md).
import { create } from "zustand";
import { mark } from "./perf";

declare global {
  interface Window {
    /** Set by the desktop app from %USERPROFILE%\.chesscoach\server.json (src-tauri/src/lib.rs). */
    __CC_SERVER__?: { url?: string; token?: string } | null;
  }
}

/** Inside the desktop app (the Tauri window), as opposed to a phone's browser. */
export const isShell = "__CC_SHELL__" in window || "__TAURI_INTERNALS__" in window;
/** For jobs only one device should run (backfills, auto-import): the desktop app runs them. */
export const isTauri = isShell;
/** A phone (or any browser): touch first, the page comes from the server, installable as an app. */
export const isPhone = !isShell;
/** Every window talks to the server over HTTP now. */
export const isRemote = true;
export const hasBackend = () => true;
/** Must match the server's API_VERSION (server/src/remote.rs). */
export const API_VERSION = 2;

const SERVER_KEY = "cc-server";
const TOKEN_KEY = "cc-token";
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * The server's address. A phone's page comes from the server, so it's the page's own origin ("").
 * The desktop app uses the address saved in Settings or given by server.json, which is where its
 * page comes from too. Under `npm run dev` in a browser, Vite passes /api on to the server.
 */
export function serverUrl(): string {
  if (!isShell) return "";
  return (stored(SERVER_KEY) ?? window.__CC_SERVER__?.url ?? "").replace(/\/+$/, "");
}
const token = () => stored(TOKEN_KEY) ?? window.__CC_SERVER__?.token ?? null;
const api = (path: string) => `${serverUrl()}${path}`;
const authHeaders = (): Record<string, string> => {
  const t = token();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** Desktop app: points it at a server (and forgets the old token, which belongs to that server). */
export function setServer(url: string) {
  try {
    localStorage.setItem(SERVER_KEY, url.trim().replace(/\/+$/, ""));
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage off: server.json still works.
  }
}

/** Whether this device holds a token or cookie the server accepts. */
export const usePairing = create<{ status: "unknown" | "paired" | "unpaired" }>(() => ({ status: "unknown" }));

/** Stable per window, so a reload keeps owning the coach. */
export const clientId = (() => {
  const prefix = isShell ? "desktop" : "phone";
  try {
    const saved = sessionStorage.getItem("cc-client");
    if (saved) return saved;
    const id = `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("cc-client", id);
    return id;
  } catch {
    return `${prefix}-${Math.random().toString(36).slice(2)}`;
  }
})();

/** The server couldn't be reached (or failed): trying again may work. */
export class Unreachable extends Error {}

/** Whether the server answered the last call (offline.ts works from its pack when not). */
export const useConnection = create<{ reachable: boolean }>(() => ({ reachable: true }));
const reachable = (r: boolean) => {
  if (useConnection.getState().reachable === r) return;
  useConnection.setState({ reachable: r });
  if (!r) probe();
};

let probing: number | null = null;
/**
 * While the server is away, asks it every few seconds whether it's back (/api/ping, which the
 * service worker leaves alone), so the status and the outbox catch up without the student acting.
 */
function probe() {
  if (probing !== null) return;
  probing = window.setInterval(async () => {
    try {
      const res = await fetch(api("/api/ping"), { cache: "no-store" });
      if (res.status >= 500) return;
    } catch {
      return;
    }
    window.clearInterval(probing!);
    probing = null;
    reachable(true);
  }, 5000);
}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isShell && !serverUrl() && !import.meta.env.DEV) {
    usePairing.setState({ status: "unpaired" });
    throw new Error("No server address yet.");
  }
  let res: Response;
  try {
    res = await fetch(api(`/api/invoke/${cmd}`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client": clientId, ...authHeaders() },
      body: JSON.stringify(args),
    });
  } catch (e) {
    reachable(false);
    throw new Unreachable(`${cmd}: can't reach the server (${e})`);
  }
  // A proxy in front (Tailscale serve) answers 502 when the server itself is away.
  reachable(res.status !== 502 && res.status !== 503 && res.status !== 504);
  if (res.status >= 500) throw new Unreachable(`${cmd} failed (${res.status})`);
  if (res.status === 401) {
    usePairing.setState({ status: "unpaired" });
    throw new Error("This device isn't paired with the server.");
  }
  if (!res.ok) throw new Error((await res.text()) || `${cmd} failed (${res.status})`);
  if (res.headers.get("Content-Type")?.startsWith("application/octet-stream")) return (await res.arrayBuffer()) as T;
  return (await res.json()) as T;
}

type Handler = (e: { payload: any }) => void;
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;

let opened = false;
/**
 * Tells listeners of "resync" that this device may have missed what the server announced: the
 * stream was opened again (asleep, or the server restarted, which forgets the backlog) or the
 * page came back to the foreground. They reread what they keep (settings, puzzle rating, drills).
 */
function resync() {
  handlers.get("resync")?.forEach((h) => h({ payload: null }));
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && opened && resync());

function connect() {
  source?.close();
  const t = token();
  const auth = t ? `&token=${encodeURIComponent(t)}` : "";
  source = new EventSource(api(`/api/events?client=${encodeURIComponent(clientId)}${auth}`));
  source.onopen = () => {
    mark("live updates connected");
    if (opened) resync();
    opened = true;
  };
  source.onmessage = (e) => {
    try {
      const { event, payload } = JSON.parse(e.data);
      handlers.get(event)?.forEach((h) => h({ payload }));
    } catch (err) {
      console.warn("bad event", err);
    }
  };
  // The browser retries on its own (sending Last-Event-ID so nothing is lost), except after a
  // 401, which closes the stream for good.
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) checkPairing();
  };
}

export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => handlers.get(event)?.delete(handler);
}

/** Opens a link outside the app. The desktop program sends any page it's asked to leave for to the browser. */
export function openUrl(url: string) {
  if (isShell) return location.assign(url);
  window.open(url, "_blank", "noopener");
}

/** Asks the server whether this device is paired and, once it is, opens the event stream. */
export async function checkPairing(): Promise<boolean> {
  try {
    const info = await invoke<{ apiVersion: number }>("server_info");
    await invoke("db_drill_counts");
    useServerVersion.setState({ apiVersion: info.apiVersion });
  } catch {
    if (usePairing.getState().status === "unpaired") return false;
    // The server is off or unreachable; try again shortly.
    window.setTimeout(checkPairing, 5000);
    return false;
  }
  usePairing.setState({ status: "paired" });
  if (!source || source.readyState === EventSource.CLOSED) connect();
  return true;
}

/**
 * The server's API version, once it answered. A desktop app built for another version says so
 * (TopBar) rather than writing what the server doesn't expect.
 */
export const useServerVersion = create<{ apiVersion: number | null }>(() => ({ apiVersion: null }));

export async function pair(code: string): Promise<void> {
  const res = await fetch(api("/api/pair"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error((await res.text()) || `Pairing failed (${res.status})`);
  const { token: t } = (await res.json()) as { token: string };
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    // A phone still has the cookie.
  }
  await checkPairing();
}
