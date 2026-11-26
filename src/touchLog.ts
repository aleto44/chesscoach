import { hasBackend, invoke, isRemote } from "./backend";

/**
 * A touch log for phone-only bugs, which scripted touches can't reproduce (Chrome's own gestures
 * decide when a touch is cancelable or cancelled). Open the app once with `?touchlog` to turn it
 * on, `?touchlog=0` to turn it off; it stays on per device until then. It shows on screen and is
 * also sent to the computer, which (debug builds) appends it to `phone-debug.log` in the project.
 */
const KEY = "touchLog";

/**
 * Dev builds: set to true to have every phone send its log to the computer, with nothing on
 * screen (an installed app has no address bar for `?touchlog`). Phones reload by themselves on
 * the change. Off otherwise: it sends every touch.
 */
const SEND_FROM_PHONES = false;

/** Lines waiting to go to the computer. */
let outbox: string[] = [];
let sending = false;
const device = `${matchMedia("(pointer: coarse)").matches ? "phone" : "desktop"}-${Math.random().toString(36).slice(2, 6)}`;
function send() {
  if (sending || !outbox.length || !hasBackend()) return;
  const lines = outbox;
  outbox = [];
  sending = true;
  invoke("dev_log", { device, lines })
    .catch(() => (outbox = [...lines, ...outbox].slice(-500)))
    .finally(() => (sending = false));
}

export function initTouchLog() {
  const flag = new URLSearchParams(location.search).get("touchlog");
  if (flag !== null) localStorage.setItem(KEY, flag === "0" ? "" : "1");
  // `?touchlog` shows it on screen (and sends it); SEND_FROM_PHONES sends it without.
  const onScreen = !!localStorage.getItem(KEY);
  if (!onScreen && !(SEND_FROM_PHONES && import.meta.env.DEV && isRemote)) return;

  const pre = document.createElement("pre");
  pre.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;max-height:38vh;overflow:hidden;margin:0;padding:4px;" +
    "font:10px/1.25 monospace;background:rgba(0,0,0,.75);color:#9f9;z-index:99999;pointer-events:none;white-space:pre-wrap";
  if (onScreen) document.body.appendChild(pre);
  const lines: string[] = [];
  const t0 = performance.now();
  const log = (s: string) => {
    const line = `${((performance.now() - t0) / 1000).toFixed(2)} ${s}`;
    lines.push(line);
    outbox.push(line);
    if (lines.length > 28) lines.shift();
    pre.textContent = lines.join("\n");
  };
  (window as unknown as { touchLog: typeof log }).touchLog = log;
  window.setInterval(send, 400);
  // Which code this device is running, and on what.
  const main = Array.from(document.querySelectorAll<HTMLScriptElement>("script[type=module]"), (s) => s.src).find((s) => s.includes("main"));
  log(`START ${main ?? "?"} sw=${navigator.serviceWorker?.controller ? "yes" : "no"} ${innerWidth}x${innerHeight} ${navigator.userAgent}`);
  window.addEventListener("error", (e) => log(`ERROR ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => log(`REJECTED ${String(e.reason)}`));
  document.addEventListener("visibilitychange", () => log(`visibility ${document.visibilityState}`));

  const where = (el: EventTarget | null) => {
    const e = el as HTMLElement | null;
    if (!e?.tagName) return "?";
    return e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "");
  };
  const ids = (l: TouchList) => Array.from(l, (t) => t.identifier).join(",");
  for (const ev of ["touchstart", "touchend", "touchcancel"] as const)
    document.addEventListener(
      ev,
      (e) =>
        log(
          `${ev.slice(5)} ch=${ids(e.changedTouches)} all=${ids(e.touches)} ` +
            `canc=${+e.cancelable} prev=${+e.defaultPrevented} ${where(e.target)}`,
        ),
      { capture: true, passive: true },
    );
  // Bubble-phase copy: whether the board's own handlers claimed it.
  document.addEventListener("touchstart", (e) => log(`  ↳ start prev=${+e.defaultPrevented}`), { passive: true });
  for (const ev of ["pointerdown", "pointerup", "pointercancel"] as const)
    document.addEventListener(ev, (e) => log(`${ev} id=${e.pointerId} ${e.pointerType} ${where(e.target)}`), { capture: true, passive: true });
  for (const ev of ["contextmenu", "selectstart", "dragstart", "mousedown", "click"] as const)
    document.addEventListener(ev, (e) => log(`${ev} prev=${+e.defaultPrevented} ${where(e.target)}`), { capture: true });
}

/** Logs a line when the touch log is on (board moves, so they line up with the touches). */
export function touchNote(s: string) {
  (window as unknown as { touchLog?: (s: string) => void }).touchLog?.(s);
}
