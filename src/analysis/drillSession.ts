// A drill session: works through due cards on the main board, graded locally by Stockfish.
// "Mistake" and "coach" cards: any move within 30cp of the engine's best counts. "Opening" cards:
// the student plays their repertoire line from memory while the app plays the other side.
import type { Key } from "chessground/types";
import { create } from "zustand";
import { Chess } from "chess.js";
import { buildLine, playAt, sideToMove, type Line } from "../chess/line";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import { dueDrills, gradeDrill, retireDrill, type Drill } from "./drills";

const TOLERANCE_CP = 30;

export interface DrillState {
  queue: Drill[];
  index: number;
  /** The drill's moves so far, from its start position. */
  line: Line | null;
  status: "solving" | "checking" | "right" | "wrong" | "done";
  /** What went wrong / right, shown under the board. */
  message: string;
  /** Best (green) and played (red) moves to draw after grading. */
  shapes: { orig: Key; dest: Key; brush: string }[];
  startedAt: number;
  /** Next review date of the drill just graded. */
  nextDue: string | null;
  correct: number;
}

export const useDrill = create<DrillState | null>(() => null);

const current = () => {
  const s = useDrill.getState();
  return s && s.queue[s.index];
};

function emptyAt(fen: string): Line {
  return { startFen: fen, sans: [], fens: [fen], lastMoves: [], notes: [] };
}

export async function startDrills(all = false) {
  const queue = await dueDrills(30, all);
  useDrill.setState({ queue, index: 0, line: null, status: "done", message: "", shapes: [], startedAt: 0, nextDue: null, correct: 0 }, true);
  if (queue.length) begin(0);
}

export function stopDrills() {
  useDrill.setState(null, true);
}

function begin(index: number) {
  const s = useDrill.getState()!;
  const drill = s.queue[index];
  if (!drill) {
    useDrill.setState({ index, status: "done", line: null, shapes: [], message: "" });
    return;
  }
  useDrill.setState({ index, line: emptyAt(drill.fen), status: "solving", message: "", shapes: [], startedAt: Date.now(), nextDue: null });
  autoplay();
}

export const nextDrill = () => begin(useDrill.getState()!.index + 1);

export async function retireCurrent() {
  const drill = current();
  if (drill) await retireDrill(drill.id);
  nextDrill();
}

/** Opening drills: play the other side's moves of the line. */
function autoplay() {
  const s = useDrill.getState();
  const drill = current();
  if (!s || !drill || drill.kind !== "opening" || s.status !== "solving" || !s.line) return;
  const ply = s.line.sans.length;
  if (ply >= drill.line.length) return finish(true, drill.line[drill.line.length - 1] ?? "", "Line complete.");
  if (sideToMove(s.line.fens[ply]) === drill.color) return;
  window.setTimeout(() => {
    const now = useDrill.getState();
    if (!now || now.index !== s.index || now.line !== s.line || now.status !== "solving") return;
    const built = buildLine(drill.fen, drill.line.slice(0, ply + 1));
    if ("line" in built) {
      useDrill.setState({ line: built.line });
      autoplay();
    }
  }, 350);
}

const toCp = (l: EngineLine | undefined, side: "white" | "black") => {
  if (!l) return 0;
  const white = l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0);
  return side === "white" ? white : -white;
};

export async function drillMove(from: Key, to: Key, promotion?: string) {
  const s = useDrill.getState();
  const drill = current();
  if (!s || !drill || s.status !== "solving" || !s.line) return;
  const ply = s.line.sans.length;
  const fen = s.line.fens[ply];
  if (sideToMove(fen) !== drill.color) return;
  const played = playAt(s.line, ply, from, to, promotion);
  if (!played) return;
  useDrill.setState({ line: played.line });

  if (drill.kind === "opening") {
    const expected = drill.line[ply];
    if (played.san === expected) {
      autoplay();
      return;
    }
    const exp = new Chess(fen).move(expected);
    useDrill.setState({ shapes: [{ orig: exp.from as Key, dest: exp.to as Key, brush: "green" }] });
    return finish(false, played.san, `Your repertoire plays ${expected} here.`);
  }

  // Mistake / coach drills: one move, judged by the engine.
  useDrill.setState({ status: "checking" });
  const uci = from + to + (played.san.match(/=([QRBN])/)?.[1].toLowerCase() ?? "");
  const answer = drill.answerUci;
  const answerSan = answer ? new Chess(fen).move({ from: answer.slice(0, 2), to: answer.slice(2, 4), promotion: answer[4] }).san : null;
  let correct = uci === answer;
  let bestUci = answer;
  if (!correct) {
    const engine = getReviewEngine();
    const [best] = await engine.analyze(fen, 1, 14);
    const [after] = await engine.analyze(played.line.fens[ply + 1], 1, 13);
    const loss = toCp(best, drill.color) - toCp(after, drill.color);
    correct = loss <= TOLERANCE_CP || toCp(after, drill.color) >= 9000;
    bestUci = best?.pv[0] ?? answer;
  }
  const bestSan = bestUci
    ? new Chess(fen).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san
    : answerSan;
  const shapes = bestUci && bestUci !== uci ? [{ orig: bestUci.slice(0, 2) as Key, dest: bestUci.slice(2, 4) as Key, brush: "green" }] : [];
  useDrill.setState({ shapes });
  finish(
    correct,
    played.san,
    correct
      ? uci === answer || !answerSan || played.san === bestSan
        ? `${played.san} is the engine's choice.`
        : `${played.san} works too (the engine's first choice is ${bestSan}).`
      : `${played.san} isn't it. Better: ${bestSan}.`,
  );
}

async function finish(correct: boolean, played: string, message: string) {
  const s = useDrill.getState()!;
  const drill = current()!;
  useDrill.setState({ status: correct ? "right" : "wrong", message, correct: s.correct + (correct ? 1 : 0) });
  try {
    const nextDue = await gradeDrill(drill.id, correct, played, Date.now() - s.startedAt);
    if (useDrill.getState()?.index === s.index) useDrill.setState({ nextDue });
  } catch (e) {
    console.error("grading failed", e);
  }
}

/** What the coach sees for "Ask the coach" from a drill. */
export function drillContext(): { title: string; fen: string } | null {
  const s = useDrill.getState();
  const drill = current();
  if (!s?.line || !drill) return null;
  return { title: drill.title, fen: s.line.fens[s.line.sans.length] };
}

export function drillQuestion(): string {
  const s = useDrill.getState()!;
  const drill = current()!;
  const line = s.line!;
  const start = drill.fen;
  const moves = line.sans.join(" ");
  if (drill.kind === "opening") {
    return `In my repertoire drill "${drill.title}" (line: ${drill.line.join(" ")}), I played ${moves}. ${s.message} Why is the repertoire move better here? Keep it short.`;
  }
  return `Drill position (FEN ${start}, ${drill.color} to move): I played ${line.sans[0]}. ${s.message} Explain the idea behind the better move, briefly.`;
}
