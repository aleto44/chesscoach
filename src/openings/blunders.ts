// Now and then the opening trainer's opponent drops the book for a mistake, to check the student is
// looking at the board and not only reciting moves. The mistakes are worked out ahead of time by
// scripts/find-traps.mjs (traps.ts): moves Maia says players of a rating really make in the line's
// positions, which Stockfish says lose at least a pawn. So the opponent plays one at once, and only
// where one exists. Some come after a detour (Route): a sound move off the book, the student's answer,
// then the mistake.
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { storedEval } from "../coach/insight";
import { getReviewEngine } from "../engine/stockfish";
import { useSettings } from "../settings";
import type { TrainingLine } from "./training";
import { ROUTES, TRAPS } from "./traps";

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
  /** The punishment played out (SAN from `best`, both sides) until the win is on the board. */
  cont?: string[];
}

/**
 * A detour to a trap one step off the book: from a book position the opponent plays `lead` (sound, and
 * common at the bands in `p`), the student is expected to answer `reply`, and the position after that
 * has stored mistakes (TRAPS). Quiet openings hide most of their tactics there rather than on the line.
 */
export interface Route {
  lead: string;
  reply: string;
  p: Record<string, number>;
}

/** The opponent's detour on the board: the answer the student is expected to find, and where the trap is. */
export interface Detour {
  lead: string;
  reply: string;
  /** positionKey of the position after `reply`, where the opponent's mistake comes. */
  trapKey: string;
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
  /** The punishment played out, from `best`: the student finds every other move, the opponent defends. */
  cont: string[];
  /** The ply the punishment starts at (moves on the board once the mistake is played); set by the session. */
  at: number;
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

/** How often a player of `rating` falls into one of this position's traps. */
const trapWeight = (key: string, rating: number) =>
  (TRAPS[key] ?? []).reduce((n, t) => n + ((t.p[bandOf(rating)] ?? 0) >= MIN_P ? t.p[bandOf(rating)] : 0), 0);

/** The detours from this position a player of `rating` takes, each weighted by how often it ends in a mistake. */
function routesAt(fen: string, rating: number): { detour: Detour; weight: number }[] {
  return (ROUTES[positionKey(fen)] ?? []).flatMap((r) => {
    const lead = r.p[bandOf(rating)] ?? 0;
    if (lead < MIN_P) return [];
    try {
      const chess = new Chess(fen);
      chess.move(r.lead);
      chess.move(r.reply);
      const trapKey = positionKey(chess.fen());
      const weight = lead * trapWeight(trapKey, rating);
      return weight ? [{ detour: { lead: r.lead, reply: r.reply, trapKey }, weight }] : [];
    } catch {
      return [];
    }
  });
}

/** How likely the opponent goes wrong from this position: a mistake at once, or after a detour. */
const spotWeight = (fen: string, rating: number) =>
  trapWeight(positionKey(fen), rating) + routesAt(fen, rating).reduce((n, r) => n + r.weight, 0);

/**
 * Whether this session gets a mistake, and where: the position (positionKey) on the line, from ply
 * `start`, where the opponent leaves the book for it (at once or by a detour). Positions whose traps
 * are fallen into more often come up more.
 */
export function planTrap(line: TrainingLine, student: "white" | "black", start: number, rating: number): string | null {
  // How often a line gets a mistake from the opponent (when it has a position with one): the student's setting.
  if (Math.random() >= useSettings.getState().openingBlunders) return null;
  const chess = new Chess();
  const spots: { key: string; p: number }[] = [];
  line.moves.forEach((san, ply) => {
    const fen = chess.fen();
    if (ply >= start && (chess.turn() === "w" ? "white" : "black") !== student) {
      const p = spotWeight(fen, rating);
      if (p) spots.push({ key: positionKey(fen), p });
    }
    chess.move(san);
  });
  return weighted(spots, (s) => s.p)?.key ?? null;
}

/** What the opponent does at a planned trap spot: the mistake itself, or a detour toward one. */
export function trapPlay(fen: string, rating: number): { blunder: Blunder } | { detour: Detour } | null {
  const direct = trapWeight(positionKey(fen), rating);
  const pick = weighted<{ weight: number; detour?: Detour }>([{ weight: direct }, ...routesAt(fen, rating)].filter((c) => c.weight > 0), (c) => c.weight);
  if (!pick) return null;
  if (pick.detour) return { detour: pick.detour };
  const blunder = trapAt(fen, rating);
  return blunder ? { blunder } : null;
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
    cont: t.cont?.length ? t.cont : [t.best],
    at: 0,
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
