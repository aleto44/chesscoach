// Practice-game nudges: after each of the student's moves, a quick local Stockfish check. A clear
// mistake gets a small note offering a takeback, the better move, or the coach. Nothing reaches
// the AI unless the student clicks "Ask the coach".
import type { Key } from "chessground/types";
import { create } from "zustand";
import { Chess } from "chess.js";
import { sideToMove } from "../chess/line";
import { whiteWinPercent } from "../engine/live";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import { useSettings } from "../settings";
import { useStore, type Color } from "../store";

const DEPTH = 12;

export interface Nudge {
  gameId: number | null;
  /** Index of the student's move in game.sans. */
  ply: number;
  san: string;
  severity: "mistake" | "blunder";
  /** The student's winning chances before and after, percent. */
  before: number;
  after: number;
  fenBefore: string;
  bestUci: string | null;
  showBest: boolean;
}

export const useNudge = create<Nudge | null>(() => null);

const win = (l: EngineLine | undefined, side: Color) => {
  if (!l) return 50;
  const w = l.mate !== undefined ? (l.mate > 0 ? 100 : 0) : whiteWinPercent({ cp: l.cp ?? 0 });
  return side === "white" ? w : 100 - w;
};

export function bestSan(n: Nudge): string | null {
  if (!n.bestUci) return null;
  try {
    return new Chess(n.fenBefore).move({ from: n.bestUci.slice(0, 2), to: n.bestUci.slice(2, 4), promotion: n.bestUci[4] }).san;
  } catch {
    return null;
  }
}

export function bestShape(n: Nudge) {
  return n.showBest && n.bestUci
    ? [{ orig: n.bestUci.slice(0, 2) as Key, dest: n.bestUci.slice(2, 4) as Key, brush: "green" }]
    : [];
}

async function check(gameId: number | null, ply: number, fenBefore: string, fenAfter: string, san: string) {
  const side = sideToMove(fenBefore);
  const engine = getReviewEngine();
  const [best] = await engine.analyze(fenBefore, 1, DEPTH);
  const [reply] = await engine.analyze(fenAfter, 1, DEPTH);
  // The reply is from the opponent's side; flip it back to the student's.
  const before = win(best, side);
  const after = 100 - win(reply, side === "white" ? "black" : "white");
  const drop = before - after;
  const mode = useSettings.getState().nudges;
  const severity = drop >= 15 ? "blunder" : drop >= 10 ? "mistake" : null;
  if (!severity || (mode === "blunders" && severity !== "blunder")) return;
  const s = useStore.getState();
  // Only if the game is still where it was (the opponent may have replied: that's fine).
  if (s.gameId !== gameId || s.game.fens[ply] !== fenBefore || s.game.sans[ply] !== san || s.meta.result) return;
  useNudge.setState({ gameId, ply, san, severity, before, after, fenBefore, bestUci: best?.pv[0] ?? null, showBest: false }, true);
}

export function initNudges() {
  useStore.subscribe((s, prev) => {
    const n = useNudge.getState();
    // A new game, a takeback past the move, or the student moving on clears the note.
    if (n && (s.gameId !== n.gameId || s.game.sans[n.ply] !== n.san || s.meta.result)) useNudge.setState(null, true);
    if (s.game === prev.game || s.gameId !== prev.gameId) return;
    const { meta, game } = s;
    if (meta.mode !== "practice" || meta.studentColor === "both" || meta.result) return;
    if (useSettings.getState().nudges === "off") return;
    const ply = game.sans.length - 1;
    if (ply < 0 || game.sans.length !== prev.game.sans.length + 1) return;
    if (sideToMove(game.fens[ply]) !== meta.studentColor) {
      // The opponent replied; a note about the student's previous move stays.
      return;
    }
    if (n) useNudge.setState(null, true);
    check(s.gameId, ply, game.fens[ply], game.fens[ply + 1], game.sans[ply]).catch((e) => console.warn("nudge check failed", e));
  });
}

/** One message for "Ask the coach", with the numbers already computed. */
export function nudgeQuestion(n: Nudge): string {
  const [, turn, , , , full] = n.fenBefore.split(" ");
  const best = bestSan(n);
  return (
    `I just played ${full}${turn === "w" ? "." : "..."}${n.san} (position before it: ${n.fenBefore}). ` +
    `The app's engine check says my winning chances went from ${Math.round(n.before)}% to ${Math.round(n.after)}%` +
    `${best ? `; its best move was ${best}` : ""}. What did I miss? Keep it short.`
  );
}
