// Maia-3's input and output, without the model: how a position becomes tokens and the move logits
// become probabilities. Shared by the app (maia.ts) and the trap batch job (scripts/find-traps.mjs).
import type { Chess, Square } from "chess.js";

const PIECES = "pnbrqk";
const FILES = "abcdefgh";
const square = (i: number) => (FILES[i % 8] + (Math.floor(i / 8) + 1)) as Square;
const mirror = (uci: string) =>
  uci[0] + (9 - Number(uci[1])) + uci[2] + (9 - Number(uci[3])) + uci.slice(4);

/** The model's move vocabulary: every from-to pair, then every promotion from the 7th rank to the 8th. */
const MOVE_INDEX = new Map<string, number>();
for (let from = 0; from < 64; from++)
  for (let to = 0; to < 64; to++) MOVE_INDEX.set(square(from) + square(to), MOVE_INDEX.size);
for (const from of FILES)
  for (const to of FILES) for (const p of "qrbn") MOVE_INDEX.set(`${from}7${to}8${p}`, MOVE_INDEX.size);

/**
 * One row of 12 per square (a1 first): the mover's pieces in 0–5, the other side's in 6–11. With
 * Black to move the board is mirrored, so the model always sees itself playing up the board.
 */
export function tokens(chess: Chess): Float32Array {
  const out = new Float32Array(64 * 12);
  const flip = chess.turn() === "b";
  for (let i = 0; i < 64; i++) {
    const piece = chess.get(square(flip ? i ^ 56 : i));
    if (piece) out[i * 12 + PIECES.indexOf(piece.type) + (piece.color === chess.turn() ? 0 : 6)] = 1;
  }
  return out;
}

/** Each legal move's probability from the model's logits, likeliest first (summing to 1). */
export function policyFrom(logits: Float32Array, legal: string[], flip: boolean): { uci: string; p: number }[] {
  const scored = legal.map((uci) => ({ uci, logit: logits[MOVE_INDEX.get(flip ? mirror(uci) : uci)!] }));
  const max = Math.max(...scored.map((m) => m.logit));
  const weights = scored.map((m) => ({ uci: m.uci, p: Math.exp(m.logit - max) })).sort((a, b) => b.p - a.p);
  const total = weights.reduce((t, m) => t + m.p, 0);
  return weights.map((m) => ({ uci: m.uci, p: m.p / total }));
}
