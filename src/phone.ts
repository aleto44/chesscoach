// Phone layout (the app served by the home server on a narrow screen; see the 760px media
// queries in styles.css). The desktop layout never uses any of this.
import { useEffect, useState } from "react";
import { create } from "zustand";

const QUERY = "(max-width: 760px)";

export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/**
 * How much of the screen the coach's sheet covers on a phone: "tab" is minimized to a small tab
 * in the corner, "closed" is the bar with the message box.
 */
export type Sheet = "tab" | "closed" | "half" | "full";

/** Minimized stays minimized across reloads. */
const TAB_KEY = "cc-coach-tab";
const startSheet = (): Sheet => {
  try {
    return localStorage.getItem(TAB_KEY) === "1" ? "tab" : "closed";
  } catch {
    return "closed";
  }
};
export const useSheet = create<{ sheet: Sheet }>(() => ({ sheet: startSheet() }));
useSheet.subscribe(({ sheet }) => {
  try {
    localStorage.setItem(TAB_KEY, sheet === "tab" ? "1" : "0");
  } catch {
    // Private mode: not remembered.
  }
});

/**
 * Keeps --topbar-h and --sheet-h (the top bar, and the coach's bar or tab at the bottom when it
 * isn't open) up to date, so a screen can fit itself exactly between them (the puzzle page).
 */
export function useChromeHeights(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const measure = () => {
      const top = document.querySelector(".topbar");
      if (top) root.style.setProperty("--topbar-h", `${Math.round(top.getBoundingClientRect().height)}px`);
      // An open sheet covers the page on purpose; keep the closed bar's height meanwhile.
      const sheet = useSheet.getState().sheet;
      if (sheet === "half" || sheet === "full") return;
      const bottom = document.querySelector(sheet === "tab" ? ".phone-coach-tab" : ".chat.sheet");
      // From its top edge to the bottom of the screen: the tab floats above a margin.
      // offsetTop, not the bounding box: it ignores the tab's slide-in animation.
      const covered = bottom instanceof HTMLElement ? Math.max(0, window.innerHeight - bottom.offsetTop) : 0;
      root.style.setProperty("--sheet-h", `${Math.round(covered)}px`);
    };
    const ro = new ResizeObserver(measure);
    const mo = new MutationObserver(() => {
      ro.disconnect();
      for (const el of document.querySelectorAll(".topbar, .chat.sheet, .phone-coach-tab")) ro.observe(el);
      measure();
    });
    mo.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
    for (const el of document.querySelectorAll(".topbar, .chat.sheet, .phone-coach-tab")) ro.observe(el);
    const unsub = useSheet.subscribe(() => requestAnimationFrame(measure));
    measure();
    return () => {
      ro.disconnect();
      mo.disconnect();
      unsub();
    };
  }, [enabled]);
}

/**
 * Keeps --board-bottom (where the board ends, in page coordinates) up to date, so the half-open
 * sheet starts right under the board.
 */
export function useBoardBottom(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const board = document.querySelector(".board-panel .board-frame");
        const bottom = board ? board.getBoundingClientRect().bottom + window.scrollY : 0;
        if (bottom) root.style.setProperty("--board-bottom", `${Math.round(bottom)}px`);
        else root.style.removeProperty("--board-bottom");
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    // The board appears and goes as screens change.
    const mo = new MutationObserver(measure);
    mo.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--board-bottom");
    };
  }, [enabled]);
}
