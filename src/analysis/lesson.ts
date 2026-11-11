// What a mistake drill teaches, worked out once when the drill is made (or, for drills made before
// lessons, once afterwards on the computer): why the game move was bad, what the best move does,
// and the theme. A drill session only works out why a *different* wrong answer is bad; everything
// else it shows comes from here, so a right answer teaches as much as a wrong one, and the reasons
// don't change from one attempt to the next.
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import { explainMove, type ExplainedLine, type Explanation } from "./explain";
import type { Mark } from "./positional";

/**
 * Bumped when the reasoning in explain.ts changes enough that stored lessons should be worked out
 * again: the computer redoes older ones in the background (backfillLessons). 3: an unguarded square
 * is only a reason when the reply wins material or checks, and the better move's themes count only
 * when it's shown on its own.
 */
export const LESSON_VERSION = 3;

/** Deeper than a live explanation (14): steadier lines, and it runs in the background. */
export const LESSON_DEPTH = 18;

/** A line as stored: the moves and captions; positions, labels and squares are rebuilt on load. */
interface PackedLine {
  startFen: string;
  sans: string[];
  notes: string[];
  /** Per move, the squares it attacks (0 for none). */
  targets: (Key[] | 0)[];
  verdict: string;
  evalText: string;
  win: number;
  marks?: Mark[];
}

export interface PackedLesson {
  v: number;
  /** The move played in the game and the best move, UCI. */
  gameUci: string;
  bestUci: string;
  played: PackedLine;
  alternatives: PackedLine[];
  rest: Omit<Explanation, "played" | "better" | "alternatives">;
}

const packLine = (l: ExplainedLine): PackedLine => ({
  startFen: l.startFen,
  sans: l.steps.map((s) => s.san),
  notes: l.steps.map((s) => s.note),
  targets: l.steps.map((s) => s.targets ?? 0),
  verdict: l.verdict,
  evalText: l.evalText,
  win: l.win,
  ...(l.marks?.length ? { marks: l.marks } : {}),
});

function unpackLine(p: PackedLine): ExplainedLine {
  const chess = new Chess(p.startFen);
  const steps: ExplainedLine["steps"] = [];
  for (let i = 0; i < p.sans.length; i++) {
    const [, turn, , , , full] = chess.fen().split(" ");
    const m = chess.move(p.sans[i]);
    const targets = p.targets[i];
    steps.push({
      san: m.san,
      label: `${full}${turn === "w" ? "." : "..."}${m.san}`,
      from: m.from as Key,
      to: m.to as Key,
      fen: chess.fen(),
      note: p.notes[i] ?? "",
      ...(targets ? { targets } : {}),
    });
  }
  return { startFen: p.startFen, steps, verdict: p.verdict, evalText: p.evalText, win: p.win, ...(p.marks ? { marks: p.marks } : {}) };
}

export function packLesson(gameUci: string, bestUci: string, ex: Explanation): string {
  const { played, better: _better, alternatives, ...rest } = ex;
  const packed: PackedLesson = { v: LESSON_VERSION, gameUci, bestUci, played: packLine(played), alternatives: alternatives.map(packLine), rest };
  return JSON.stringify(packed);
}

/** A drill's stored lesson as an explanation of the game move (null if missing or unreadable). */
export function unpackLesson(json: string | null | undefined): (Explanation & { gameUci: string; bestUci: string }) | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as PackedLesson;
    // An older version still reads fine until it's redone; a placeholder ({"v": n}) has no lines.
    if (!p.played) return null;
    const alternatives = p.alternatives.map(unpackLine);
    return { ...p.rest, played: unpackLine(p.played), alternatives, better: alternatives[0] ?? null, gameUci: p.gameUci, bestUci: p.bestUci };
  } catch (e) {
    console.warn("unreadable drill lesson", e);
    return null;
  }
}

/** A line's eval as stored evals are (White's view, mates as ±(10000 − distance)). */
const stored = (l: EngineLine | undefined) =>
  !l ? 0 : l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0);

/**
 * Works out what the position teaches: the game move against the best move, deeply. `evals` are
 * the review's (White's view), so the numbers agree with it; searched when not given.
 */
export async function computeLesson(
  fen: string,
  gameUci: string,
  bestUci: string,
  evals?: { before: number; after: number },
): Promise<{ json: string; ex: Explanation }> {
  let e = evals;
  if (!e) {
    const engine = getReviewEngine();
    const [best] = await engine.analyze(fen, 1, LESSON_DEPTH);
    const after = new Chess(fen);
    after.move({ from: gameUci.slice(0, 2), to: gameUci.slice(2, 4), promotion: gameUci[4] });
    const [reply] = after.isGameOver() ? [] : await engine.analyze(after.fen(), 1, LESSON_DEPTH);
    e = { before: stored(best), after: after.isCheckmate() ? (after.turn() === "w" ? -9999 : 9999) : stored(reply) };
  }
  const ex = await explainMove({ fenBefore: fen, uci: gameUci, bestUci, evalBefore: e.before, evalAfter: e.after, depth: LESSON_DEPTH });
  return { json: packLesson(gameUci, bestUci, ex), ex };
}

/** Whether a lesson has something concrete to teach (a theme), not just "the position gets better". */
export const teaches = (ex: Explanation) => ex.themes.length > 0;
