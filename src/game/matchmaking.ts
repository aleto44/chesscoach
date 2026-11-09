// Play Rated: a pretend matchmaking queue. The student picks only the clock; the opponent is a Maia
// near their rating, a little stronger or weaker each time the way a real pool hands out pairings,
// and Elo (rating.ts eloChange) makes an upset worth more than a win against a weaker player.
import { MAIA_MAX_RATING } from "../store";
import type { TimeControl } from "../store";

/** Maia's range, chess.com scale: the floor of the slider up to where Stockfish takes over. */
const MAIA_RANGE = { min: 400, max: MAIA_MAX_RATING };
/** How far a pairing usually lands from the student's rating, and the furthest it goes. */
const SPREAD = 90;
const MAX_GAP = 250;

/** Roughly normal (sum of three uniforms), so most pairings are close and a few are a stretch. */
function gap(): number {
  const u = (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
  return Math.max(-MAX_GAP, Math.min(MAX_GAP, u * SPREAD));
}

/** The opponent's rating for a student at `rating`, rounded to 5 like a real lobby's numbers look. */
export function matchOpponent(rating: number): number {
  const r = Math.round((rating + gap()) / 5) * 5;
  return Math.max(MAIA_RANGE.min, Math.min(MAIA_RANGE.max, r));
}

/** The clock picked last time in Play Rated, so the next game is one click. */
const KEY = "cc-rated-clock";
export function savedRatedClock(): TimeControl | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return JSON.parse(v) as TimeControl | null;
  } catch {
    // Private mode or junk: fall through.
  }
  return { initial: 600, increment: 0 };
}
export function saveRatedClock(tc: TimeControl | null) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tc));
  } catch {
    // Private mode: not kept.
  }
}
