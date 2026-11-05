// How the frontend reaches the Rust side: Tauri IPC in the desktop window, or HTTP to the home
// server (src-tauri/src/remote.rs) when the app is opened on a phone. Same commands, same events.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";

declare global {
  interface Window {
    __CC_REMOTE__?: boolean;
  }
}

export const isTauri = "__TAURI_INTERNALS__" in window;
/** Served by the home server, i.e. running on a phone (or any other browser). */
export const isRemote = !isTauri && !!window.__CC_REMOTE__;
export const hasBackend = () => isTauri || isRemote;

/** Remote only: whether this browser holds a pairing cookie the server accepts. */
export const usePairing = create<{ status: "unknown" | "paired" | "unpaired" }>(() => ({ status: "unknown" }));

/** Stable per tab, so a reload keeps owning the coach. */
export const clientId = (() => {
  if (!isRemote) return "desktop";
  try {
    const saved = sessionStorage.getItem("cc-client");
    if (saved) return saved;
    const id = `phone-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("cc-client", id);
    return id;
  } catch {
    return `phone-${Math.random().toString(36).slice(2)}`;
  }
})();

/** The phone couldn't reach the computer (or the server failed): trying again may work. */
export class Unreachable extends Error {}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return tauriInvoke<T>(cmd, args);
  if (!isRemote) throw new Error("No backend: open the app from the desktop window or the home server.");
  let res: Response;
  try {
    res = await fetch(`/api/invoke/${cmd}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client": clientId },
      body: JSON.stringify(args),
    });
  } catch (e) {
    throw new Unreachable(`${cmd}: can't reach your computer (${e})`);
  }
  if (res.status >= 500) throw new Unreachable(`${cmd} failed (${res.status})`);
  if (res.status === 401) {
    usePairing.setState({ status: "unpaired" });
    throw new Error("This device isn't paired with your computer.");
  }
  if (!res.ok) throw new Error((await res.text()) || `${cmd} failed (${res.status})`);
  if (res.headers.get("Content-Type")?.startsWith("application/octet-stream")) return (await res.arrayBuffer()) as T;
  return (await res.json()) as T;
}

type Handler = (e: { payload: any }) => void;
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;

function connect() {
  source?.close();
  source = new EventSource(`/api/events?client=${encodeURIComponent(clientId)}`);
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
  if (isTauri) return tauriListen<T>(event, handler);
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => handlers.get(event)?.delete(handler);
}

export function openUrl(url: string) {
  if (isTauri) return tauriOpenUrl(url);
  window.open(url, "_blank", "noopener");
}

/** Remote only: asks the server whether this device is paired and, once it is, opens the event stream. */
export async function checkPairing(): Promise<boolean> {
  if (!isRemote) return true;
  try {
    await invoke("db_drill_counts");
  } catch {
    if (usePairing.getState().status === "unpaired") return false;
    // The computer is off or unreachable; try again shortly.
    window.setTimeout(checkPairing, 5000);
    return false;
  }
  usePairing.setState({ status: "paired" });
  if (!source || source.readyState === EventSource.CLOSED) connect();
  return true;
}

export async function pair(code: string): Promise<void> {
  const res = await fetch("/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error((await res.text()) || `Pairing failed (${res.status})`);
  await checkPairing();
}
