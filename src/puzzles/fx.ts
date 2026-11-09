// Puzzle feedback: the badge on the square just played, the board's flash, a sound and (on phones)
// a buzz. Kept out of the puzzle session so a reload doesn't replay an old cue.
import type { Key } from "chessground/types";
import { create } from "zustand";
import { buzz } from "../haptics";
import { play } from "../sound";

export type CueKind = "correct" | "wrong" | "solved" | "failed";

export interface Cue {
  kind: CueKind;
  /** The square the badge sits on (none for a solution the student asked to see). */
  square: Key | null;
  /** The position the badge belongs to: it goes away once the board moves on. */
  fen: string;
  /** Bumped on every cue, so the same kind twice in a row still animates. */
  id: number;
}

export const usePuzzleFx = create<Cue | null>(() => null);

const SOUND = { correct: "puzzle-correct", wrong: "puzzle-wrong", solved: "puzzle-solved", failed: null } as const;
/**
 * Phone buzzes, kept small. Every move already taps (haptics.ts moveTap, from sound.ts); these are
 * the puzzle's own cues on top.
 * The end of a puzzle (solved or not) is buzzed by the session when it finishes.
 */
const BUZZ: Record<CueKind, number[] | null> = {
  correct: null,
  wrong: [45, 40, 45],
  solved: null,
  failed: null,
};
export const BUZZ_OPPONENT = [12];
export const BUZZ_END = [18, 50, 18];

let next = 0;

export function cue(kind: CueKind, square: Key | null, fen: string) {
  usePuzzleFx.setState({ kind, square, fen, id: ++next }, true);
  const sound = SOUND[kind];
  if (sound) play(sound);
  const pattern = BUZZ[kind];
  if (pattern) buzz(pattern);
}

export { buzz, canVibrate } from "../haptics";

/**
 * A theme earned a star (a sparkle) or moved up a tier (a fanfare and a longer buzz). Timed to
 * the moment the bar fills on the puzzle screen.
 */
export function celebrate(tier: boolean) {
  window.setTimeout(() => {
    play(tier ? "puzzle-tier" : "puzzle-star");
    buzz(tier ? [25, 50, 25, 50, 60] : [20, 50, 30]);
  }, 1050);
}

export const clearCue = () => usePuzzleFx.setState(null, true);
