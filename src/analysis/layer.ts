// The analysis layer: a board one level above whatever screen opened it (a reviewed game, a finished
// puzzle, a drill, a trainer), at the same position and with the same moves to step through. The
// student plays what-if moves for both sides (chess/explore.ts) with the engine's top lines always
// on. The screen underneath keeps its state; closing the layer goes back to it.
import { create } from "zustand";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { explore, exploreGoto, exploreMove, type Explore } from "../chess/explore";
import type { Line } from "../chess/line";
import { stepView, viewedPly, type Step } from "../chess/view";
import { useNav, peeking } from "../nav";
import { boardOrientation, isLocked, screen, useStore, type Color } from "../store";
import { holdPuzzle, usePuzzle } from "../puzzles/session";
import { useDrill } from "./drillSession";
import { endgameOf, useEndgame } from "../endgames/session";
import { openingSetOf, useOpening } from "../openings/session";
import { useGuess } from "../guess/session";

export interface AnalysisLayer {
  x: Explore;
  orientation: Color;
  /** What it was opened from, for the way back ("Back to the puzzle"). */
  from: string;
}

export const useAnalysis = create<AnalysisLayer | null>(() => null);

interface Source {
  line: Line;
  ply: number;
  orientation: Color;
  from: string;
}

const at = (line: Line, view: number | null) => viewedPly(line.sans.length, view);

/**
 * The board the layer would open on, or null where analysis isn't allowed: during a rated game
 * (the engine is off then, trainers included), and while a puzzle, drill, endgame or guess is still
 * being solved, since the engine's lines would give the answer away.
 */
export function analysisSource(): Source | null {
  if (isLocked()) return null;
  if (peeking()) {
    const { line, ply } = screen();
    return { line, ply, orientation: boardOrientation(), from: "scenario" };
  }
  const p = usePuzzle.getState();
  if (p) return p.line && (p.status === "solved" || p.status === "failed") ? { line: p.line, ply: at(p.line, p.view), orientation: p.color, from: "puzzle" } : null;
  const d = useDrill.getState();
  if (d) {
    const drill = d.queue[d.index];
    const answered = d.status === "right" || d.status === "wrong" || d.status === "done";
    return d.line && drill && answered ? { line: d.line, ply: at(d.line, d.view), orientation: drill.color, from: "drill" } : null;
  }
  const e = useEndgame.getState();
  if (e) return e.status === "playing" || e.status === "thinking" ? null : { line: e.line, ply: at(e.line, e.view), orientation: endgameOf(e).side, from: "endgame" };
  const o = useOpening.getState();
  if (o) return { line: o.line, ply: at(o.line, o.view), orientation: openingSetOf(o).color, from: "opening trainer" };
  const g = useGuess.getState();
  if (g) return g.status === "reveal" || g.status === "done" ? { line: g.line, ply: at(g.line, g.view), orientation: g.side, from: "guess the move" } : null;
  if (useNav.getState().view !== "board") return null;
  const { line, ply, tangent } = screen();
  return { line, ply, orientation: boardOrientation(), from: tangent ? "scenario" : "game" };
}

/** Whether the analysis button shows; follows every store the answer depends on. */
export function useCanAnalyze(): boolean {
  useStore((s) => s.meta);
  useStore((s) => s.active);
  useNav((n) => n.view);
  useNav((n) => n.peek);
  usePuzzle((p) => p?.status);
  useDrill((d) => d?.status);
  useEndgame((e) => e?.status);
  useOpening((o) => !!o);
  useGuess((g) => g?.status);
  return analysisSource() !== null;
}

export function openAnalysis() {
  const src = analysisSource();
  if (!src) return;
  // A solved puzzle would move on to the next one underneath.
  holdPuzzle();
  useAnalysis.setState({ x: explore(src.line, src.ply), orientation: src.orientation, from: src.from }, true);
}

export const closeAnalysis = () => useAnalysis.setState(null, true);

const update = (fn: (a: AnalysisLayer) => Partial<AnalysisLayer> | null) => {
  const a = useAnalysis.getState();
  const patch = a && fn(a);
  if (patch) useAnalysis.setState(patch);
};

export const analysisGoto = (ply: number) => update((a) => ({ x: exploreGoto(a.x, ply) }));

export const analysisStep = (s: Step) =>
  update((a) => {
    const n = a.x.line.sans.length;
    return { x: exploreGoto(a.x, viewedPly(n, stepView(n, a.x.ply, s))) };
  });

export const analysisMove = (from: Key, to: Key, promotion?: string) =>
  update((a) => {
    const x = exploreMove(a.x, from, to, promotion);
    return x && { x };
  });

/** Plays engine moves (UCI) from the board's position, e.g. a line clicked up to one of its moves. */
export const analysisPlay = (ucis: string[]) =>
  update((a) => {
    let x = a.x;
    for (const u of ucis) {
      const next = exploreMove(x, u.slice(0, 2) as Key, u.slice(2, 4) as Key, u[4]);
      if (!next) break;
      x = next;
    }
    return { x };
  });

export const analysisFlip = () => update((a) => ({ orientation: a.orientation === "white" ? "black" : "white" }));

/** Every position of an engine line from `fen`: its SAN, numbered label and the board after it. */
export function pvSteps(fen: string, pv: string[], max = 20): { san: string; label: string; fen: string; from: Key; to: Key }[] {
  const chess = new Chess(fen);
  const out: { san: string; label: string; fen: string; from: Key; to: Key }[] = [];
  for (const [i, uci] of pv.slice(0, max).entries()) {
    const [, turn, , , , full] = chess.fen().split(" ");
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    const label = turn === "w" ? `${full}. ${m.san}` : i === 0 ? `${full}… ${m.san}` : m.san;
    out.push({ san: m.san, label, fen: chess.fen(), from: m.from as Key, to: m.to as Key });
  }
  return out;
}
