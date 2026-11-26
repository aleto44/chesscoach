import { create } from "zustand";

/**
 * Draw mode: the top bar's pencil. While it's on, a plain press on any board draws (a tap circles a
 * square, a drag draws an arrow) instead of moving pieces; that's how phones draw. Pressing anywhere
 * off the boards, or the pencil again, turns it off and keeps the drawings; the next ordinary tap
 * on the board clears them, as a click does on desktop.
 */
export const useDrawMode = create<{ on: boolean }>(() => ({ on: false }));

export function setDrawMode(on: boolean) {
  useDrawMode.setState({ on });
}

// Off as soon as a press lands anywhere but a board or the pencil itself (which toggles on its own).
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!useDrawMode.getState().on) return;
    const at = e.target as Element | null;
    if (at?.closest?.(".cg-wrap, .draw-button")) return;
    setDrawMode(false);
  },
  { capture: true },
);

/** The pencil next to the mic. */
export function DrawButton() {
  const on = useDrawMode((s) => s.on);
  return (
    <button
      className={`icon draw-button ${on ? "on" : ""}`}
      onClick={() => setDrawMode(!on)}
      title={on ? "Draw mode on: tap a square for a circle, drag for an arrow. Tap here or off the board to stop." : "Draw on the board"}
      aria-label="Draw on the board"
      aria-pressed={on}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <path
          d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5 4 20z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M13.5 7l3 3" stroke={on ? "var(--panel, #fff)" : "currentColor"} strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
