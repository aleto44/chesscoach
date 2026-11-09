// Which screen the left column shows: the home menu, a section's menu, or the game board.
// Puzzle and drill sessions sit on top of whichever screen started them (their own stores).
import { create } from "zustand";
import { stopDrills, useDrill } from "./analysis/drillSession";
import { stopPuzzles, usePuzzle } from "./puzzles/session";
import { stopEndgame, useEndgame } from "./endgames/session";
import { stopOpening, useOpening } from "./openings/session";
import { stopGuess, useGuess } from "./guess/session";
import { openTangent, useStore } from "./store";
import { closeAnalysis, useAnalysis } from "./analysis/layer";

export type View =
  | "home"
  | "games"
  | "school"
  | "drills"
  | "drill-history"
  | "openings"
  | "puzzles"
  | "puzzle-history"
  | "profile"
  | "weaknesses"
  | "ratings"
  | "endgames"
  | "guess"
  | "board";

export const VIEW_TITLE: Record<View, string> = {
  home: "Home",
  games: "Games",
  school: "School",
  drills: "Drills",
  openings: "Opening training",
  "drill-history": "Drill history",
  puzzles: "Puzzles",
  "puzzle-history": "Puzzle history",
  profile: "Profile",
  weaknesses: "Weaknesses",
  ratings: "Rating history",
  endgames: "Endgame trainer",
  guess: "Guess the move",
  board: "Board",
};

/** The section a screen belongs to, for the top bar's trail (Home › Puzzles › Puzzle history). */
const PARENT: Partial<Record<View, View>> = {
  games: "home",
  school: "home",
  drills: "school",
  openings: "school",
  puzzles: "home",
  board: "games",
  "drill-history": "drills",
  "puzzle-history": "puzzles",
  profile: "home",
  weaknesses: "profile",
  ratings: "profile",
  endgames: "school",
  guess: "school",
};

/**
 * The screen survives a reload: a phone drops the page when the student switches apps for a
 * while, and coming back to the home menu lost their place.
 */
const VIEW_KEY = "cc-view";
function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v && v in VIEW_TITLE) return v as View;
  } catch {
    // Private mode: start at home.
  }
  return "home";
}

/**
 * `peek`: a coach scenario is open over a puzzle, drill or trainer session, which keeps running
 * underneath; returning from the scenario goes back to it.
 */
export const useNav = create<{ view: View; peek: boolean }>(() => ({ view: savedView(), peek: false }));
useNav.subscribe(({ view }) => {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private mode: nothing to keep.
  }
});

/** Going anywhere leaves a running puzzle or drill session. */
export function go(view: View) {
  closeAnalysis();
  stopPuzzles();
  stopDrills();
  stopEndgame();
  stopOpening();
  stopGuess();
  useNav.setState({ view, peek: false });
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
  if (useAnalysis.getState()) return closeAnalysis();
  if (peeking()) return openTangent(null);
  if (usePuzzle.getState()) return stopPuzzles();
  if (useDrill.getState()) return stopDrills();
  if (useEndgame.getState()) return stopEndgame();
  if (useOpening.getState()) return stopOpening();
  if (useGuess.getState()) return stopGuess();
  const parent = PARENT[useNav.getState().view];
  if (parent) go(parent);
}

/** A puzzle, drill, endgame or guess-the-move session is on the board. */
export const anySession = () => !!(usePuzzle.getState() || useDrill.getState() || useEndgame.getState() || useOpening.getState() || useGuess.getState());

/** A coach scenario is on the board over a running session. */
export const peeking = () => useNav.getState().peek && anySession() && !!useStore.getState().active;

/** Shows a coach scenario over the running session, without stopping it. */
export function peekScenario(tangentId: string) {
  closeAnalysis();
  useNav.setState({ peek: true });
  openTangent(tangentId);
}

/** What the student goes back to from a scenario opened over a session, for its buttons. */
export function sessionName(): string | null {
  if (usePuzzle.getState()) return "puzzle";
  if (useDrill.getState()) return "drill";
  if (useOpening.getState()) return "opening trainer";
  if (useEndgame.getState()) return "endgame trainer";
  if (useGuess.getState()) return "guess the move";
  return null;
}

/** The coach can open side boards or draw arrows from any screen; show the board when it does. */
export function initNav() {
  useStore.subscribe((s, prev) => {
    // Leaving the scenario (Return, Escape) ends the peek: the session shows again.
    if (!s.active && prev.active && useNav.getState().peek) useNav.setState({ peek: false });
    const coachShowing = (s.active && s.active !== prev.active) || (s.arrows && s.arrows !== prev.arrows);
    // The coach's board goes on top of an open analysis board.
    if (coachShowing) closeAnalysis();
    if (coachShowing && !anySession()) go("board");
  });
}
