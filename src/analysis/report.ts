// The game report shown after the analysis: accuracy (lichess's per-move curve, chess.com-like totals), a rough game rating,
// label counts and a verdict per phase, for each side. Pure functions over the stored annotations.
import { sideToMove, type Line } from "../chess/line";
import { whiteWinPercent } from "../engine/live";
import type { Color } from "../store";
import { labelOf, type MoveAnnotation, type MoveClass, type MoveLabel, type Phase } from "./review";

/** Display order, best to worst. */
export const LABELS: MoveLabel[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

export interface SideReport {
  /** 0–100, null without analyzed moves. */
  accuracy: number | null;
  /** A rough chess.com-scale rating for how this game was played. */
  rating: number | null;
  counts: Record<MoveLabel, number>;
  /** A verdict on each phase from the average move accuracy in it; null = no moves in it. */
  phases: Record<Phase, MoveLabel | null>;
}

export interface GameReport {
  white: SideReport;
  black: SideReport;
  /** White's winning chances (0–100) after each ply, index 0 = the start position. */
  winPercents: number[];
}

/** White's view, centipawns (mates are ±(10000 − distance), which this maps to ~0 or ~100). */
const win = (cp: number) => whiteWinPercent({ cp });
/** Winning chances (points) a move gave away, mover's view, from White's-view evals. */
const winDrop = (before: number, after: number, mover: Color) =>
  Math.max(0, mover === "white" ? win(before) - win(after) : win(after) - win(before));

/**
 * lichess's curve from what a move threw away (lossPoints, ≈ winning-chance points) to how much
 * of the position it kept, 0–100, with a 1-point bonus for engine noise.
 */
export function moveAccuracy(loss: number): number {
  if (loss <= 0) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const stdDev = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/**
 * lichess: how volatile the position was around each move (std dev of winning chances over a
 * window), so a mistake in a sharp position weighs more. One weight per move.
 */
function volatility(wins: number[]): number[] {
  const size = Math.max(2, Math.min(8, Math.floor((wins.length - 1) / 10)));
  const windows: number[][] = [];
  for (let k = 0; k < Math.min(size, wins.length) - 2; k++) windows.push(wins.slice(0, size));
  for (let k = 0; k + size <= wins.length; k++) windows.push(wins.slice(k, k + size));
  return windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));
}

/**
 * The volatility-weighted mean (lichess's first half). Lichess also averages in the harmonic mean,
 * which lets one blunder sink the whole game (a side that played well and then walked into mate
 * scored ~40 where chess.com says ~74); chess.com's accuracy doesn't, so neither does this.
 */
function aggregate(items: { acc: number; weight: number }[]): number | null {
  if (!items.length) return null;
  return items.reduce((s, x) => s + x.acc * x.weight, 0) / items.reduce((s, x) => s + x.weight, 0);
}

/**
 * Accuracy to a chess.com rating, from typical accuracies at each level there (beginners in the
 * 50s, ~800 mid-60s, ~1600 high-70s, masters 90+). A ballpark: one game is little evidence.
 */
const RATING_BY_ACCURACY: [accuracy: number, rating: number][] = [
  [40, 100],
  [55, 400],
  [65, 800],
  [72, 1200],
  [78, 1600],
  [84, 2000],
  [89, 2400],
  [93, 2800],
  [97, 3200],
];

export function ratingFor(accuracy: number): number {
  const t = RATING_BY_ACCURACY;
  if (accuracy <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    const [[a0, r0], [a1, r1]] = [t[i - 1], t[i]];
    if (accuracy <= a1) return Math.round((r0 + ((accuracy - a0) / (a1 - a0)) * (r1 - r0)) / 50) * 50;
  }
  return t[t.length - 1][1];
}

/**
 * The rating leaves out book moves and moves made while more than 4 pawns up that stay so: when
 * the opponent keeps hanging pieces, taking them is easy and reads as near-perfect play. A move
 * that throws such a lead away still counts.
 */
const WON_CP = 400;
/** Fewer such moves than this and the rating uses all of them instead. */
const MIN_RATED_MOVES = 8;
/**
 * One game is weak evidence, so with an opponent of known rating (the bot) the estimate is pulled
 * halfway toward the level the game was played at and kept within this much of it.
 */
const MAX_FROM_ANCHOR = 600;

function gameRating(accuracy: number, anchor: number | null): number {
  const raw = ratingFor(accuracy);
  if (anchor === null) return raw;
  const pulled = (raw + anchor) / 2;
  const clamped = Math.max(anchor - MAX_FROM_ANCHOR, Math.min(anchor + MAX_FROM_ANCHOR, pulled));
  return Math.max(100, Math.round(clamped / 50) * 50);
}

const VERDICTS: [minAccuracy: number, verdict: MoveLabel][] = [
  [92, "best"],
  [85, "excellent"],
  [75, "good"],
  [62, "inaccuracy"],
  [48, "mistake"],
  [0, "blunder"],
];
const rank = (l: MoveLabel) => VERDICTS.findIndex(([, v]) => v === l);

/**
 * A phase's verdict icon from its accuracy, no better than "mistake" if it had a blunder, or
 * "inaccuracy" if it had a mistake (misses count by their size): an average alone would let a
 * few good moves hide them.
 */
function phaseVerdict(accuracy: number, classes: MoveClass[]): MoveLabel {
  let v = VERDICTS.find(([min]) => accuracy >= min)![1];
  const cap = classes.includes("blunder") ? "mistake" : classes.includes("mistake") ? "inaccuracy" : null;
  if (cap && rank(v) < rank(cap)) v = cap;
  return v;
}

/**
 * Null until every move of the game has been analyzed. `anchor`: the rating the game was played
 * at, when known (the bot's), for the game rating.
 */
export function gameReport(line: Line, annotations: (MoveAnnotation | null)[], anchor: number | null): GameReport | null {
  if (line.sans.length === 0 || annotations.length < line.sans.length || annotations.some((a) => !a)) return null;
  const notes = annotations as MoveAnnotation[];
  // The start position's eval is stored with the first move (absent in older analyses).
  const evals = [notes[0].evalBefore ?? 20, ...notes.map((a) => a.evalAfter)];
  const winPercents = evals.map(win);
  const weights = volatility(winPercents);

  const side = (color: Color): SideReport => {
    const counts = Object.fromEntries(LABELS.map((l) => [l, 0])) as Record<MoveLabel, number>;
    const all: { acc: number; weight: number }[] = [];
    const byPhase: Record<Phase, { items: typeof all; classes: MoveClass[] }> = {
      opening: { items: [], classes: [] },
      middlegame: { items: [], classes: [] },
      endgame: { items: [], classes: [] },
    };
    const rated: typeof all = [];
    notes.forEach((a, i) => {
      if (sideToMove(line.fens[i]) !== color) return;
      const label = labelOf(a);
      counts[label]++;
      // Winning chances only, as lichess and chess.com: the centipawn part of lossFromEvals is for
      // naming mistakes in lost positions, not for scoring them.
      const acc = moveAccuracy(a.class === "best" ? 0 : winDrop(evals[i], evals[i + 1], color));
      const item = { acc, weight: weights[i] ?? 1 };
      all.push(item);
      const pov = (cp: number) => (color === "white" ? cp : -cp);
      const easy = pov(evals[i]) > WON_CP && pov(evals[i + 1]) > WON_CP;
      if (label !== "book" && !easy) rated.push(item);
      byPhase[a.phase].items.push(item);
      byPhase[a.phase].classes.push(a.class);
    });
    const accuracy = aggregate(all);
    const forRating = aggregate(rated.length >= MIN_RATED_MOVES ? rated : all);
    const verdict = (p: Phase) => {
      const acc = aggregate(byPhase[p].items);
      return acc === null ? null : phaseVerdict(acc, byPhase[p].classes);
    };
    return {
      accuracy,
      rating: forRating === null ? null : gameRating(forRating, anchor),
      counts,
      phases: { opening: verdict("opening"), middlegame: verdict("middlegame"), endgame: verdict("endgame") },
    };
  };
  return { white: side("white"), black: side("black"), winPercents };
}
