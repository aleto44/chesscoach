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

/** How much of the screen the coach's sheet covers on a phone. */
export type Sheet = "closed" | "half" | "full";
export const useSheet = create<{ sheet: Sheet }>(() => ({ sheet: "closed" }));

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
