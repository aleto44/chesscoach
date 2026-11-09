// Now and then the opening trainer's opponent drops the book for an outright blunder, to check the
// student is looking at the board and not only reciting moves. The engine picks the blunder (a move
// that loses real material against the book move) and judges whether the student cashed in.
import { Chess, type Move, type Square } from "chess.js";
import type { Key } from "chessground/types";
import { storedEval } from "../coach/insight";
import { getReviewEngine } from "../engine/stockfish";

/** How often a line gets a blunder from the opponent. */
export const BLUNDER_CHANCE = 0.2;
/** Not before the opponent's this-many-th ply: the line should be under way first. */
const FIRST_PLY = 3;
/** The blunder has to give the student at least this much over the book move (centipawns, about a minor piece). */
const SWING = 250;
/** …and leave the student at least this much ahead. */
const WINNING = 200;
const SCAN_DEPTH = 10;
const DEPTH = 14;
const MAX_TRIES = 12;

export interface Blunder {
  /** The opponent's move, SAN, and the position it left the student. */
  san: string;
  fen: string;
  /** The engine's punishment, SAN and as an arrow, and what it's worth to the student. */
  best: string;
  bestMove: { from: Key; to: Key };
  bestEval: number;
}

const forStudent = (white: number, color: "white" | "black") => (color === "white" ? white : -white);

async function evalAfter(fen: string, depth: number) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { cp: chess.turn() === "w" ? -10000 : 10000, pv: [] as string[] };
  const [line] = await getReviewEngine().analyze(fen, 1, depth);
  return { cp: line ? storedEval(line) : 0, pv: line?.pv ?? [] };
}

/** Whether this session should get a blunder, and at which ply (the opponent's), given the line's length. */
export function pickBlunderPly(lineLength: number, opponentFirst: boolean): number | null {
  if (Math.random() >= BLUNDER_CHANCE) return null;
  const plies: number[] = [];
  for (let p = FIRST_PLY; p < lineLength; p++) if ((p % 2 === 0) === opponentFirst) plies.push(p);
  return plies.length ? plies[Math.floor(Math.random() * plies.length)] : null;
}

/**
 * Moves a hurried player could make: a piece stepping onto a square the student attacks comes first
 * (that's how pieces get hung), then the rest shuffled. King moves and captures are left out, so the
 * blunder reads as a slip, not a trade.
 */
function candidates(chess: Chess, student: "w" | "b"): Move[] {
  const moves = chess.moves({ verbose: true }).filter((m) => m.piece !== "k" && !m.captured);
  const shuffled = moves.map((m) => ({ m, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.m);
  const hangs = (m: Move) => m.piece !== "p" && chess.isAttacked(m.to as Square, student);
  return [...shuffled.filter(hangs), ...shuffled.filter((m) => !hangs(m))];
}

/**
 * A blunder for the opponent in `fen` instead of `bookSan`, or null when none turns up quickly (then
 * the book move is played as usual).
 */
export async function findBlunder(fen: string, bookSan: string, student: "white" | "black"): Promise<Blunder | null> {
  const chess = new Chess(fen);
  const book = new Chess(fen);
  book.move(bookSan);
  const baseline = forStudent((await evalAfter(book.fen(), SCAN_DEPTH)).cp, student);
  for (const move of candidates(chess, student === "white" ? "w" : "b").slice(0, MAX_TRIES)) {
    const after = new Chess(fen);
    after.move(move.san);
    const scan = forStudent((await evalAfter(after.fen(), SCAN_DEPTH)).cp, student);
    if (scan - baseline < SWING || scan < WINNING) continue;
    // Confirm deeper, and get the punishing move.
    const deep = await evalAfter(after.fen(), DEPTH);
    const cp = forStudent(deep.cp, student);
    const uci = deep.pv[0];
    if (cp - baseline < SWING || cp < WINNING || !uci) continue;
    let best: string;
    try {
      best = new Chess(after.fen()).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    } catch {
      continue;
    }
    return { san: move.san, fen: after.fen(), best, bestMove: { from: uci.slice(0, 2) as Key, to: uci.slice(2, 4) as Key }, bestEval: cp };
  }
  return null;
}

/** What the student's reply kept of the blunder (centipawns for the student), and whether that counts as punishing it. */
export async function judgePunish(b: Blunder, playedFen: string, student: "white" | "black"): Promise<{ eval: number; ok: boolean }> {
  const cp = forStudent((await evalAfter(playedFen, DEPTH)).cp, student);
  // Most of the gain kept: a free queen taken as a pawn isn't punishing it.
  const ok = cp >= b.bestEval - Math.max(100, b.bestEval * 0.25) || cp >= 9000;
  return { eval: cp, ok };
}
