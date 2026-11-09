// Every rating the student sees is on the chess.com scale (see .github/copilot-instructions.md).
// Lichess numbers (puzzles, Maia's training data) are converted here, both ways.

/** chess.com rapid next to the Lichess rating that's roughly the same level. */
const LICHESS_SCALE: [chessCom: number, lichess: number][] = [
  [400, 900],
  [1000, 1400],
  [1500, 1750],
  [2000, 2100],
  [2500, 2500],
];

/** Piecewise-linear between the table's points, continuing the end segments past the ends. */
function convert(rating: number, from: 0 | 1, to: 0 | 1): number {
  const s = LICHESS_SCALE;
  let i = 1;
  while (i < s.length - 1 && rating > s[i][from]) i++;
  const [a, b] = [s[i - 1], s[i]];
  return a[to] + ((rating - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
}

/** A chess.com-scale rating as the Lichess rating of about the same strength. */
export const toLichess = (chessCom: number) => Math.round(convert(chessCom, 0, 1));
/** A Lichess rating (a puzzle's, the student's puzzle rating) as the chess.com rating shown to the student. */
export const fromLichess = (lichess: number) => Math.round(convert(lichess, 1, 0));

/** The student's game rating before they set one (Settings); START_RATING in src-tauri/src/db.rs. */
export const START_RATING = 1200;

/**
 * Elo for a rated game: score 1 / 0.5 / 0. The computer applies it when the game ends
 * (elo_change in src-tauri/src/db.rs); this copy previews it in the new-game dialog.
 */
export function eloChange(player: number, opponent: number, score: number, gamesSoFar: number): number {
  const expected = 1 / (1 + 10 ** ((opponent - player) / 400));
  const k = gamesSoFar < 10 ? 32 : 16;
  return Math.round(k * (score - expected));
}

/** The student has a rating per clock, like chess.com (RATING_POOLS in src-tauri/src/db.rs). */
export type RatingPool = "bullet" | "blitz" | "rapid";
export const RATING_POOLS: RatingPool[] = ["bullet", "blitz", "rapid"];
export const POOL_LABEL: Record<RatingPool, string> = { bullet: "Bullet", blitz: "Blitz", rapid: "Rapid" };

/**
 * Which rating a clock counts toward: chess.com's split by expected length (base + 40 moves of
 * increment), under 3 minutes bullet, under 10 blitz, else rapid. No clock counts as rapid.
 * Mirrors rating_pool in src-tauri/src/db.rs, which does the rating.
 */
export function ratingPool(tc: { initial: number; increment: number } | null): RatingPool {
  if (!tc) return "rapid";
  const t = tc.initial + 40 * tc.increment;
  return t < 180 ? "bullet" : t < 600 ? "blitz" : "rapid";
}

/** One pool of db_player_rating: the rating and the games behind it. */
export interface PoolRating {
  rating: number;
  /** Rated games that have changed it. */
  games: number;
  /** False until the student sets it in Settings (rapid started at START_RATING, the others at rapid). */
  set: boolean;
  /** [before, after] for the last rated games in this pool, oldest first. */
  history: [number, number][];
}

/** db_player_rating: every pool, and which one the last rated game was in. */
export interface PlayerRating {
  pools: Record<RatingPool, PoolRating>;
  latest: RatingPool | null;
}

/** "+12", "−8", "±0". */
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
