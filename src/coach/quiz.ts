// ask_move: the coach puts a position on a side board and waits for the student's move. The app
// grades it (accepted list, or within a tolerance of Stockfish's best) and answers the tool call
// with one line, so the coach doesn't need extra analyze calls. Misses become drills.
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { emptyLine, playAt, sideToMove } from "../chess/line";
import { addDrills } from "../analysis/drills";
import { getEngine, formatScore, type EngineLine } from "../engine/stockfish";
import { addTangent, newId, openTangent, pushChat, setMoveInterceptor, updateChat, useStore, type Tangent } from "../store";

interface Pending {
  chatId: string;
  fen: string;
  accept: string[];
  tolerance: number;
  startedAt: number;
  resolve: (text: string) => void;
}

const pending = new Map<string, Pending>();

const cp = (l: EngineLine | undefined, side: "white" | "black") => {
  if (!l) return 0;
  const white = l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0);
  return side === "white" ? white : -white;
};

function uciSan(fen: string, uci: string | undefined) {
  if (!uci) return "?";
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

export function askMove(opts: { fen: string; prompt: string; title: string; accept: string[]; tolerance: number }) {
  const tangent = addTangent({
    parentId: useStore.getState().active,
    title: opts.title,
    author: "coach",
    line: emptyLine(opts.fen),
    ply: 0,
  });
  const chatId = newId("c");
  pushChat({ kind: "quiz", id: chatId, tangentId: tangent.id, prompt: opts.prompt, status: "waiting" });
  openTangent(tangent.id);
  return new Promise<string>((resolve) => {
    pending.set(tangent.id, { chatId, fen: opts.fen, accept: opts.accept, tolerance: opts.tolerance, startedAt: Date.now(), resolve });
  });
}

export function skipQuiz(tangentId: string) {
  const p = pending.get(tangentId);
  if (!p) return;
  pending.delete(tangentId);
  updateChat(p.chatId, { status: "skipped", result: "Skipped." });
  p.resolve("The student skipped the question. Show them the answer.");
}

/** Abandons open quizzes (new game, coach restart). */
export function cancelQuizzes() {
  for (const id of [...pending.keys()]) skipQuiz(id);
}

async function answer(tangent: Tangent, from: Key, to: Key, promotion?: string): Promise<void> {
  const p = pending.get(tangent.id)!;
  const played = playAt(tangent.line, 0, from, to, promotion);
  if (!played) return;
  pending.delete(tangent.id);
  useStore.setState((s) => ({ tangents: { ...s.tangents, [tangent.id]: { ...tangent, line: played.line, ply: 1 } } }));
  updateChat(p.chatId, { status: "checking" });

  const side = sideToMove(p.fen);
  const engine = getEngine();
  const [best] = await engine.analyze(p.fen, 1, 16);
  const [after] = await engine.analyze(played.line.fens[1], 1, 14);
  const loss = Math.max(0, cp(best, side) - cp(after, side));
  const inList = p.accept.includes(played.san);
  const correct = inList || loss <= p.tolerance || cp(after, side) >= 9000;
  const bestSan = uciSan(p.fen, best?.pv[0]);
  const reply = uciSan(played.line.fens[1], after?.pv[0]);
  const seconds = Math.round((Date.now() - p.startedAt) / 1000);

  const shown = correct
    ? played.san === bestSan
      ? `${played.san}: the engine's top choice.`
      : `${played.san} works (engine's top choice: ${bestSan}).`
    : `${played.san} isn't it. Better: ${bestSan}.`;
  updateChat(p.chatId, { status: correct ? "right" : "wrong", result: shown });

  if (!correct) {
    await addDrills([
      { kind: "coach", title: tangent.title, fen: p.fen, color: side, answerUci: best?.pv[0] ?? null, note: null },
    ]).catch(() => undefined);
  }
  p.resolve(
    `Student played ${played.san} after ${seconds}s. ` +
      (correct ? `Correct${inList ? " (in your accepted list)" : ""}. ` : "Wrong. ") +
      `Engine (White's view): best ${bestSan} ${best ? formatScore(best) : "?"}; after ${played.san} ${after ? formatScore(after) : "?"}` +
      `${cp(after, side) <= -9000 ? ", which allows mate" : loss ? `, ${loss}cp worse` : ""}; the engine's reply would be ${reply}.` +
      (correct ? "" : " Saved as a drill. Explain what the student missed, briefly."),
  );
}

/** Moves on a quiz board answer the quiz instead of branching. */
export function initQuiz() {
  setMoveInterceptor((tangent, from, to, promotion) => {
    if (!pending.has(tangent.id) || tangent.line.sans.length > 0) return false;
    answer(tangent, from, to, promotion);
    return true;
  });
}
