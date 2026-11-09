// Phone buzzes: a tap on every move on whichever board is on screen (sound.ts), and the longer
// patterns the puzzle trainer uses for its cues (puzzles/fx.ts).
import { useSettings } from "./settings";

/** Phones only: desktop Chromium has navigator.vibrate too, but nothing to vibrate. */
export const canVibrate = () => "vibrate" in navigator && matchMedia("(pointer: coarse)").matches;

/** When the pattern buzzing now ends (ms, performance.now()): a move's tap mustn't cut it short. */
let busyUntil = 0;

/** A buzz on phones, when the student has it on. */
export function buzz(pattern: number[]) {
  if (!useSettings.getState().haptics || !canVibrate()) return;
  try {
    if (navigator.vibrate(pattern)) busyUntil = performance.now() + pattern.reduce((a, b) => a + b, 0);
  } catch {
    // Some browsers refuse without a recent touch; nothing else depends on it.
  }
}

const MOVE_TAP = [12];

/** The tap for a move: skipped while a longer pattern (a wrong move, a solve) is still going. */
export function moveTap() {
  if (performance.now() < busyUntil) return;
  buzz(MOVE_TAP);
}
