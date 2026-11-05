import type { Color } from "../store";

export type PieceType = "q" | "r" | "b" | "n" | "p";
export const PIECE_VALUES: Record<PieceType | "k", number> = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 };
export const PIECE_NAMES: Record<PieceType, string> = { q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const TYPES: PieceType[] = ["q", "r", "b", "n", "p"];

/** Pieces of each type on the board for each side, from a FEN's placement field. */
export function pieceCounts(fen: string): Record<Color, Record<PieceType, number>> {
  const zero = () => ({ q: 0, r: 0, b: 0, n: 0, p: 0 });
  const counts = { white: zero(), black: zero() };
  for (const ch of fen.split(" ")[0]) {
    const t = ch.toLowerCase() as PieceType;
    if (!TYPES.includes(t)) continue;
    counts[ch === t ? "black" : "white"][t]++;
  }
  return counts;
}

/** Material in pawns (9/5/3/3/1), White minus Black. */
export function materialBalance(fen: string): number {
  const c = pieceCounts(fen);
  return TYPES.reduce((sum, t) => sum + PIECE_VALUES[t] * (c.white[t] - c.black[t]), 0);
}

/**
 * The material imbalance as lichess shows it: for each side, the opponent's pieces it is up
 * (type by type, so a knight for a pawn shows a knight on one side and a pawn on the other), and
 * its lead in points when it has one. Works from any position, promotions included.
 */
export function imbalance(fen: string): Record<Color, { pieces: PieceType[]; lead: number }> {
  const c = pieceCounts(fen);
  const out = { white: { pieces: [] as PieceType[], lead: 0 }, black: { pieces: [] as PieceType[], lead: 0 } };
  for (const t of TYPES) {
    const d = c.white[t] - c.black[t];
    for (let k = 0; k < Math.abs(d); k++) out[d > 0 ? "white" : "black"].pieces.push(t);
  }
  const bal = materialBalance(fen);
  if (bal > 0) out.white.lead = bal;
  if (bal < 0) out.black.lead = -bal;
  return out;
}
