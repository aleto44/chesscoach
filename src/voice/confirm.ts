import { saveSetting, useSettings } from "../settings";
import { isLocked } from "../store";
import { useNav } from "../nav";
import { usePuzzle } from "../puzzles/session";
import { useDrill } from "../analysis/drillSession";
import { useEndgame } from "../endgames/session";
import { useOpening } from "../openings/session";
import { useGuess } from "../guess/session";
import { usePlan } from "../plans/session";
import { useAnalysis } from "../analysis/layer";

/** Below this the recognizer was guessing at a word, so the move waits for a yes. */
const SURE_CONF = 0.6;

/**
 * The board on screen counts against a rating: a rated game's with nothing layered over it (a
 * trainer, the analysis board), or a rated puzzle's (Rated puzzles; rush and custom sets aren't).
 */
export function ratedOnScreen(): boolean {
  if (useAnalysis.getState() || useNav.getState().view !== "board") return false;
  const puzzle = usePuzzle.getState();
  if (puzzle) return puzzle.set.mode === "rated" && !useDrill.getState();
  const over = useDrill.getState() || useEndgame.getState() || useOpening.getState() || useGuess.getState() || usePlan.getState();
  return isLocked() && !over;
}

/**
 * Whether a heard move waits for the student's yes before it's played: `sure` is the words naming
 * it exactly (voice/parse.ts), `conf` how sure the recognizer was of them.
 */
export function needsConfirm(sure: boolean, conf: number): boolean {
  const mode = useSettings.getState().voiceConfirm;
  const unsure = !sure || conf < SURE_CONF;
  return mode === "always" || unsure || (mode === "rated" && ratedOnScreen());
}

/** Whether rated games' and rated puzzles' voice moves wait for a yes under the current setting. */
export function ratedConfirms(): boolean {
  return useSettings.getState().voiceConfirm !== "unsure";
}

/**
 * The mic's right-click / long-press in a rated game or puzzle: confirmations there on or off. Off still asks
 * when the recognizer was unsure, since a misheard move is never what the student meant.
 */
export function toggleRatedConfirm(): boolean {
  const on = !ratedConfirms();
  void saveSetting("voiceConfirm", on ? "rated" : "unsure");
  return on;
}
