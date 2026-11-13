import { useSettings } from "../settings";
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

/** The board on screen is a rated game's: nothing layered over it (a trainer, the analysis board). */
function ratedOnScreen(): boolean {
  const over = usePuzzle.getState() || useDrill.getState() || useEndgame.getState() || useOpening.getState() || useGuess.getState() || usePlan.getState() || useAnalysis.getState();
  return isLocked() && !over && useNav.getState().view === "board";
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
