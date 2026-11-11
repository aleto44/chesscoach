import { Chess } from "chess.js";
import type { Key } from "chessground/types";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** A sequence of moves from a start position. fens[i] is the position after i moves. */
export interface Line {
  startFen: string;
  sans: string[];
  fens: string[];
  lastMoves: [Key, Key][];
  notes: string[];
}

export function emptyLine(startFen = START_FEN): Line {
  return { startFen, sans: [], fens: [startFen], lastMoves: [], notes: [] };
}

/** Plays SAN moves from startFen, or explains exactly which move failed. */
export function buildLine(
  startFen: string,
  sans: string[],
  notes: string[] = [],
): { line: Line } | { error: string } {
  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch (e) {
    return { error: `Invalid start FEN "${startFen}": ${(e as Error).message}` };
  }
  const line = emptyLine(chess.fen());
  for (const [i, raw] of sans.entries()) {
    const san = raw.trim().replace(/^\d+\.(\.\.)?\s*/, "");
    const before = chess.fen();
    try {
      const m = chess.move(san);
      line.sans.push(m.san);
      line.fens.push(chess.fen());
      line.lastMoves.push([m.from as Key, m.to as Key]);
      line.notes.push(notes[i] ?? "");
    } catch {
      const where = moveLabel(before, san);
      return {
        error:
          `Move ${i + 1} (${where}) is illegal in ${before}. ` +
          `Legal moves there: ${new Chess(before).moves().join(", ")}. Nothing was shown; fix the line and call again.`,
      };
    }
  }
  return { line };
}

/** Plays a board move (from/to) at `ply`, dropping anything after it. Queens unless told otherwise. */
export function playAt(
  line: Line,
  ply: number,
  from: Key,
  to: Key,
  promotion = "q",
): { line: Line; san: string } | null {
  const chess = new Chess(line.fens[ply]);
  let m;
  try {
    m = chess.move({ from, to, promotion });
  } catch {
    return null;
  }
  return {
    san: m.san,
    line: {
      startFen: line.startFen,
      sans: [...line.sans.slice(0, ply), m.san],
      fens: [...line.fens.slice(0, ply + 1), chess.fen()],
      lastMoves: [...line.lastMoves.slice(0, ply), [m.from as Key, m.to as Key]],
      notes: [...line.notes.slice(0, ply), ""],
    },
  };
}

/** "6.Nf3" or "6...e6" for the move about to be played from `fen`. */
export function moveLabel(fen: string, san: string): string {
  const [, turn, , , , full] = fen.split(" ");
  return turn === "w" ? `${full}.${san}` : `${full}...${san}`;
}

/** Numbered move text for plies [from, to) of a line, e.g. "5...e6 6.Nf3 Nd7". */
export function formatMoves(line: Pick<Line, "fens" | "sans">, from = 0, to = line.sans.length): string {
  const parts: string[] = [];
  for (let i = from; i < to; i++) {
    const [, turn, , , , full] = line.fens[i].split(" ");
    if (turn === "w") parts.push(`${full}.${line.sans[i]}`);
    else parts.push(i === from ? `${full}...${line.sans[i]}` : line.sans[i]);
  }
  return parts.join(" ");
}

/**
 * What text about `line` speaks from, for SquareText: the position before its last move, then the
 * few before that (a message may name the opponent's move before it, or a reply came since).
 */
export function lastMoveContext(line: Pick<Line, "fens">, upTo = line.fens.length - 1): { at?: string; earlier: string[] } {
  const i = Math.max(0, upTo - 1);
  return { at: line.fens[i], earlier: line.fens.slice(Math.max(0, i - 3), i).reverse() };
}

export function sideToMove(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "w" ? "white" : "black";
}

export function legalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of new Chess(fen).moves({ verbose: true })) {
    const list = dests.get(m.from as Key) ?? [];
    list.push(m.to as Key);
    dests.set(m.from as Key, list);
  }
  return dests;
}
