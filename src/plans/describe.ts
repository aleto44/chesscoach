// A plan in words from the engine's line, without the coach: what the student's side does over its
// next few moves (a piece rerouted, a pawn break, a rook to an open file, castling), worked out by
// looking at the moves and the board. Rough on purpose: it names the idea and draws it; the coach
// can explain the why on request (plans/session.ts explainPlan).
import { Chess, type Move, type Square } from "chess.js";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import type { Color } from "../store";

const NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const side = (c: Color) => (c === "white" ? "w" : "b");
/** Black's moves are written "...Nf6", as everywhere else in the app. */
export const moveText = (san: string, color: Color) => (color === "black" ? `...${san}` : san);

export interface PlanText {
  title: string;
  text: string;
  shapes: DrawShape[];
}

/** The student's moves (and the replies between them) along a UCI line, up to `count` of theirs. */
function playLine(fen: string, pv: string[], count: number): { moves: Move[]; mine: Move[] } {
  const chess = new Chess(fen);
  const moves: Move[] = [];
  const mine: Move[] = [];
  for (const uci of pv) {
    if (mine.length >= count) break;
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      moves.push(m);
      if (moves.length % 2 === 1) mine.push(m);
      // A capture by the student usually ends the quiet part of the plan.
      if (moves.length % 2 === 1 && m.captured) break;
    } catch {
      break;
    }
  }
  return { moves, mine };
}

/** Squares a piece reaches from `sq` in `fen` with its own side to move (pins ignored). */
function reach(fen: string, sq: Square, color: Color): number {
  const parts = fen.split(" ");
  parts[1] = side(color);
  parts[3] = "-";
  try {
    return new Chess(parts.join(" ")).moves({ square: sq, verbose: true }).length;
  } catch {
    return 0;
  }
}

function fileHasPawn(chess: Chess, file: string, color: "w" | "b"): boolean {
  for (let r = 1; r <= 8; r++) {
    const p = chess.get(`${file}${r}` as Square);
    if (p?.type === "p" && p.color === color) return true;
  }
  return false;
}

/** Enemy pawns the pawn on `sq` attacks. */
function pawnTargets(chess: Chess, sq: Square, color: Color): Square[] {
  const dir = color === "white" ? 1 : -1;
  const f = sq.charCodeAt(0);
  const r = Number(sq[1]) + dir;
  return [f - 1, f + 1]
    .filter((x) => x >= 97 && x <= 104 && r >= 1 && r <= 8)
    .map((x) => `${String.fromCharCode(x)}${r}` as Square)
    .filter((s) => {
      const p = chess.get(s);
      return p?.type === "p" && p.color !== side(color);
    });
}

/** The idea behind the first move of `pv` for `color`, with its follow-up drawn. */
export function describePlan(fen: string, pv: string[], color: Color): PlanText | null {
  const { mine } = playLine(fen, pv, 3);
  const first = mine[0];
  if (!first) return null;
  // Green for the move itself, blue for the follow-up moves of the plan.
  const shapes: DrawShape[] = mine.map((m, i) => ({ orig: m.from as Key, dest: m.to as Key, brush: i === 0 ? "green" : "blue" }));
  const mv = (m: Move) => moveText(m.san, color);
  const follow = mine.length > 1 ? ` The engine follows up with ${mine.slice(1).map(mv).join(", then ")}.` : "";
  const after = new Chess(fen);
  after.move(first.san);
  const piece = NAMES[first.piece];

  if (first.san.startsWith("O-O")) {
    return { title: "Get the king safe", text: `${mv(first)}: the king gets out of the middle and the rook joins the game.${follow}`, shapes };
  }

  // The same piece moving again: a regrouping.
  const route = [first];
  for (const m of mine.slice(1)) if (m.from === route[route.length - 1].to) route.push(m);
  if (first.piece !== "p" && route.length >= 2) {
    const path = [first.from, ...route.map((m) => m.to)].join("–");
    const end = route[route.length - 1].to;
    return {
      title: `Reroute the ${piece}`,
      text: `The ${piece} on ${first.from} isn't doing much there. It heads for ${end} (${path}), starting with ${mv(first)}.${follow}`,
      shapes,
    };
  }

  if (first.piece === "p") {
    const hits = pawnTargets(after, first.to as Square, color);
    if (hits.length)
      return {
        title: `Pawn break with ${mv(first)}`,
        text: `${mv(first)} hits the pawn on ${hits.join(" and ")} and opens lines for your pieces.${follow}`,
        shapes: [...shapes, ...hits.map((h) => ({ orig: h as Key, brush: "red" }))],
      };
    const king = after.findPiece({ type: "k", color: side(color) === "w" ? "b" : "w" })[0];
    if (king && Math.abs(king.charCodeAt(0) - first.to.charCodeAt(0)) <= 1 && "abcfgh".includes(king[0]))
      return { title: "Pawn storm", text: `${mv(first)} goes for the king on ${king}: pawns pry its shelter open.${follow}`, shapes };
    return { title: `Gain space with ${mv(first)}`, text: `${mv(first)} takes squares away from the opponent's pieces and gives yours room behind it.${follow}`, shapes };
  }

  if (first.piece === "r" || (first.piece === "q" && first.from[0] !== first.to[0])) {
    const file = first.to[0];
    const mineOn = fileHasPawn(after, file, side(color));
    const theirsOn = fileHasPawn(after, file, side(color) === "w" ? "b" : "w");
    if (!mineOn)
      return {
        title: `${piece[0].toUpperCase() + piece.slice(1)} to the ${theirsOn ? "half-open" : "open"} ${file}-file`,
        text: `${mv(first)} puts the ${piece} on the ${file}-file, where ${theirsOn ? "it presses on the pawn in front of it" : "nothing blocks it"}.${follow}`,
        shapes,
      };
  }

  if (first.piece === "k")
    return { title: "Bring the king in", text: `${mv(first)}: with fewer pieces left, the king is a fighting piece.${follow}`, shapes };

  const was = reach(fen, first.from as Square, color);
  const now = reach(after.fen(), first.to as Square, color);
  const gain = now - was >= 3 ? ` It goes from ${was} squares to ${now}.` : "";
  return {
    title: `Improve the ${piece}`,
    text: `${mv(first)} puts the ${piece} on a better square.${gain}${follow}`,
    shapes,
  };
}

/** The positions `count` plies into a UCI line, for comparing where two lines settle. */
export function lineEnd(fen: string, pv: string[], plies = 6): string {
  const chess = new Chess(fen);
  for (const uci of pv.slice(0, plies)) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
  }
  return chess.fen();
}
