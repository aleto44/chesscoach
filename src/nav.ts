// Which screen the left column shows: the home menu, a section's menu, or the game board.
// Puzzle and drill sessions sit on top of whichever screen started them (their own stores).
import { create } from "zustand";
import { stopDrills, useDrill } from "./analysis/drillSession";
import { stopPuzzles, usePuzzle } from "./puzzles/session";
import { useStore } from "./store";

export type View = "home" | "games" | "drills" | "drill-history" | "puzzles" | "puzzle-history" | "board";

export const VIEW_TITLE: Record<View, string> = {
  home: "Home",
  games: "Games",
  drills: "Drills",
  "drill-history": "Drill history",
  puzzles: "Puzzles",
  "puzzle-history": "Puzzle history",
  board: "Board",
};

/** The section a screen belongs to, for the top bar's trail (Home › Puzzles › Puzzle history). */
const PARENT: Partial<Record<View, View>> = {
  games: "home",
  drills: "home",
  puzzles: "home",
  board: "games",
  "drill-history": "drills",
  "puzzle-history": "puzzles",
};

export const useNav = create<{ view: View }>(() => ({ view: "home" }));

/** Going anywhere leaves a running puzzle or drill session. */
export function go(view: View) {
  stopPuzzles();
  stopDrills();
  useNav.setState({ view });
}
export const goHome = () => go("home");

/** Home first, the current screen last. */
export function trail(view: View): View[] {
  const out: View[] = [];
  for (let v: View | undefined = view; v; v = PARENT[v]) out.unshift(v);
  return out;
}

/** Up one level: out of a puzzle or drill session first, then to the screen's parent. */
export function back() {
  if (usePuzzle.getState()) return stopPuzzles();
  if (useDrill.getState()) return stopDrills();
  const parent = PARENT[useNav.getState().view];
  if (parent) go(parent);
}

/** The coach can open side boards or draw arrows from any screen; show the board when it does. */
export function initNav() {
  useStore.subscribe((s, prev) => {
    const coachShowing = (s.active && s.active !== prev.active) || (s.arrows && s.arrows !== prev.arrows);
    if (coachShowing && !usePuzzle.getState() && !useDrill.getState()) go("board");
  });
}
