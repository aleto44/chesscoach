// Move orders. A book line is a set of moves for each side more than a strict sequence: 3.Nf3 and
// 4.e3 often reach the same position as 3.e3 and 4.Nf3. So the trainer checks the student's moves
// against what's left of the line, matched by piece movement (from/to), not by position in it.
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { sideToMove, type Line } from "../chess/line";
import type { Color } from "../store";
import type { TrainingLine } from "./training";

/** One move of a book line, as played in the line's own order. */
export interface Planned {
  san: string;
  from: Key;
  to: Key;
  promotion?: string;
  color: Color;
  /** Its place in the line (0-based ply). */
  index: number;
}

const plans = new WeakMap<TrainingLine, Planned[]>();

export function plannedOf(line: TrainingLine): Planned[] {
  const hit = plans.get(line);
  if (hit) return hit;
  const chess = new Chess();
  const out: Planned[] = [];
  for (const [index, san] of line.moves.entries()) {
    const color: Color = chess.turn() === "w" ? "white" : "black";
    const m = chess.move(san);
    out.push({ san: m.san, from: m.from as Key, to: m.to as Key, promotion: m.promotion, color, index });
  }
  plans.set(line, out);
  return out;
}

const promoOf = (san: string) => san.match(/=([QRBN])/)?.[1].toLowerCase();

/**
 * What's left of `target` after the moves on the board, and how many board moves aren't in it at
 * all. Each board move uses up the first unused line move of the same side with the same from/to.
 */
export function matchLine(target: TrainingLine, line: Line): { remaining: Planned[]; unmatched: number } {
  const remaining = [...plannedOf(target)];
  let unmatched = 0;
  line.sans.forEach((san, i) => {
    const color = sideToMove(line.fens[i]);
    const [from, to] = line.lastMoves[i];
    const promo = promoOf(san);
    const k = remaining.findIndex((p) => p.color === color && p.from === from && p.to === to && p.promotion === promo);
    if (k >= 0) remaining.splice(k, 1);
    else unmatched++;
  });
  return { remaining, unmatched };
}

/** `color`'s remaining line moves that are legal in `fen`, in the line's order: the first is "the book move". */
export function legalNext(remaining: Planned[], color: Color, fen: string): Planned[] {
  const legal = new Chess(fen).moves({ verbose: true });
  return remaining.filter(
    (p) => p.color === color && legal.some((m) => m.from === p.from && m.to === p.to && m.promotion === p.promotion),
  );
}

/** The SAN of a planned move in the position it's actually played in (captures and checks can differ). */
export function sanIn(fen: string, p: Planned): string {
  try {
    return new Chess(fen).move({ from: p.from, to: p.to, promotion: p.promotion }).san;
  } catch {
    return p.san;
  }
}
