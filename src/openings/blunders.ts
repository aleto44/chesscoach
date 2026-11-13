// Now and then the opening trainer's opponent drops the book for a mistake, to check the student is
// looking at the board and not only reciting moves. The mistakes are worked out ahead of time by
// scripts/find-traps.mjs (traps.ts): moves Maia says players of a rating really make in the line's
// positions, which Stockfish says lose at least a pawn. So the opponent plays one at once, and only
// where one exists.
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { storedEval } from "../coach/insight";
import { getReviewEngine } from "../engine/stockfish";
import type { TrainingLine } from "./training";
import { TRAPS } from "./traps";

/** How often a line gets a mistake from the opponent (when it has a position with one). */
export const BLUNDER_CHANCE = 1; // TEMP for testing the Maia traps; normally 0.2
/** A mistake Maia gives less than this chance at the student's rating isn't one people play there. */
const MIN_P = 0.03;
/** The ratings find-traps.mjs works traps out for (chess.com scale). */
const BANDS = [800, 1000, 1200, 1400, 1600, 1800, 2000];
const DEPTH = 14;

/** A stored mistake, as find-traps.mjs writes it. */
export interface Trap {
  san: string;
  /** The punishment, SAN and UCI, and the student's eval after it (centipawns, mates as ±(10000 − distance)). */
  best: string;
  bestUci: string;
  eval: number;
  /** How likely a player of each rating band is to play the mistake (0–1), where it's 3% or more. */
  p: Record<string, number>;
}

export interface Blunder {
  /** The opponent's move, SAN, and the position it left the student. */
  san: string;
  fen: string;
  /** The punishment, SAN and as an arrow, and what it's worth to the student. */
  best: string;
  bestMove: { from: Key; to: Key };
  bestEval: number;
  /** How likely Maia thinks a player of the student's rating is to play it (0–1). */
  p: number;
}

/** A position without the move counters, as traps.ts is keyed. */
export const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

const bandOf = (rating: number) => String(BANDS.reduce((a, b) => (Math.abs(b - rating) < Math.abs(a - rating) ? b : a)));

/** The traps a player of `rating` falls into in this position. */
const trapsAt = (fen: string, rating: number) =>
  (TRAPS[positionKey(fen)] ?? []).filter((t) => (t.p[bandOf(rating)] ?? 0) >= MIN_P);

/** One of `items`, the likelier ones more often. */
function weighted<T>(items: T[], weight: (t: T) => number): T | null {
  const total = items.reduce((n, t) => n + weight(t), 0);
  let r = Math.random() * total;
  return items.find((t) => (r -= weight(t)) <= 0) ?? items[items.length - 1] ?? null;
}

/**
 * Whether this session gets a mistake, and where: the position (positionKey) on the line, from ply
 * `start`, where the opponent will play it. Positions whose traps are fallen into more often come up more.
 */
export function planTrap(line: TrainingLine, student: "white" | "black", start: number, rating: number): string | null {
  if (Math.random() >= BLUNDER_CHANCE) return null;
  const chess = new Chess();
  const spots: { key: string; p: number }[] = [];
  line.moves.forEach((san, ply) => {
    const fen = chess.fen();
    if (ply >= start && (chess.turn() === "w" ? "white" : "black") !== student) {
      const p = trapsAt(fen, rating).reduce((n, t) => n + t.p[bandOf(rating)], 0);
      if (p) spots.push({ key: positionKey(fen), p });
    }
    chess.move(san);
  });
  return weighted(spots, (s) => s.p)?.key ?? null;
}

/** The opponent's mistake in this position for a player of `rating`, or null when it has none. */
export function trapAt(fen: string, rating: number): Blunder | null {
  const t = weighted(trapsAt(fen, rating), (x) => x.p[bandOf(rating)]);
  if (!t) return null;
  const after = new Chess(fen);
  after.move(t.san);
  return {
    san: t.san,
    fen: after.fen(),
    best: t.best,
    bestMove: { from: t.bestUci.slice(0, 2) as Key, to: t.bestUci.slice(2, 4) as Key },
    bestEval: t.eval,
    p: t.p[bandOf(rating)],
  };
}

/**
 * What the student's reply kept of the mistake (centipawns for the student), and whether that counts
 * as punishing it. The stored punishment needs no engine.
 */
export async function judgePunish(b: Blunder, playedFen: string, playedSan: string, student: "white" | "black"): Promise<{ eval: number; ok: boolean }> {
  if (playedSan === b.best) return { eval: b.bestEval, ok: true };
  const chess = new Chess(playedFen);
  let white = 0;
  if (chess.isCheckmate()) white = chess.turn() === "w" ? -10000 : 10000;
  else {
    const [line] = await getReviewEngine().analyze(playedFen, 1, DEPTH);
    white = line ? storedEval(line) : 0;
  }
  const cp = student === "white" ? white : -white;
  // Most of the gain kept: a free queen taken as a pawn isn't punishing it, and with a pawn won,
  // a quiet move that lets it go isn't either.
  const ok = cp >= b.bestEval - Math.max(60, b.bestEval * 0.25) || cp >= 9000;
  return { eval: cp, ok };
}
