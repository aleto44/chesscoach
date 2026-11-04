// Post-game analysis, all local (Stockfish, no AI): evaluates every position of a finished game,
// classifies each move by how much winning chance it gave away, tags the mistakes with simple
// patterns, saves it all to SQLite and turns the student's mistakes into drills.
import { invoke } from "@tauri-apps/api/core";
import { Chess } from "chess.js";
import { buildLine, sideToMove, type Line } from "../chess/line";
import { db, hasBackend } from "../db";
import { whiteWinPercent } from "../engine/live";
import { getReviewEngine } from "../engine/stockfish";
import { useStore, type Color, type GameMeta } from "../store";
import { openingName } from "../openings/book";
import { addMistakeDrills } from "./drills";

const DEPTH = 13;
const MATE_CP = 10000;

export type MoveClass = "best" | "good" | "inaccuracy" | "mistake" | "blunder";
export type Phase = "opening" | "middlegame" | "endgame";

export interface MoveAnnotation {
  class: MoveClass;
  /** Centipawns the move gave away, mover's view (0–1000). */
  cpLoss: number;
  bestUci: string | null;
  /** White's view after the move, centipawns (mate = ±10000). */
  evalAfter: number;
  phase: Phase;
  tags: string[];
}

interface Eval {
  /** White's view, centipawns; mates as ±(10000 − distance). */
  cp: number;
  mate: boolean;
  best: string | null;
}

/** Thresholds on the drop in the mover's winning chances, in percentage points (as lichess). */
function classify(drop: number, isBest: boolean): MoveClass {
  if (drop >= 15) return "blunder";
  if (drop >= 10) return "mistake";
  if (drop >= 5) return "inaccuracy";
  return isBest ? "best" : "good";
}

async function evaluate(fen: string): Promise<Eval> {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { cp: chess.turn() === "w" ? -MATE_CP : MATE_CP, mate: true, best: null };
  if (chess.isGameOver()) return { cp: 0, mate: false, best: null };
  const [line] = await getReviewEngine().analyze(fen, 1, DEPTH);
  if (!line) return { cp: 0, mate: false, best: null };
  if (line.mate !== undefined) {
    const sign = line.mate > 0 ? 1 : -1;
    return { cp: sign * (MATE_CP - Math.abs(line.mate)), mate: true, best: line.pv[0] ?? null };
  }
  return { cp: line.cp ?? 0, mate: false, best: line.pv[0] ?? null };
}

const winPct = (e: Eval, side: Color) => {
  const w = e.mate ? (e.cp > 0 ? 100 : 0) : whiteWinPercent({ cp: e.cp });
  return side === "white" ? w : 100 - w;
};
const pov = (e: Eval, side: Color) => (side === "white" ? e.cp : -e.cp);

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function phaseOf(fen: string, ply: number): Phase {
  const pieces = new Chess(fen).board().flat();
  const material = pieces.reduce((sum, p) => sum + (p && p.type !== "p" ? VALUES[p.type] : 0), 0);
  if (material <= 26) return "endgame";
  return ply < 20 ? "opening" : "middlegame";
}

/** Facts about a UCI move in a position: does it capture (what), check, mate. */
function moveFacts(fen: string, uci: string | null) {
  if (!uci) return null;
  try {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { captured: m.captured ?? null, check: m.san.includes("+") || m.san.includes("#"), san: m.san };
  } catch {
    return null;
  }
}

interface GameInput {
  gameId: number;
  line: Line;
  meta: Pick<GameMeta, "studentColor" | "timeControl" | "mode">;
  clocks: (number | null)[];
}

function tagsFor(g: GameInput, i: number, before: Eval, after: Eval, cls: MoveClass): string[] {
  if (cls === "best" || cls === "good") return [];
  const tags: string[] = [];
  const fen = g.line.fens[i];
  const mover = sideToMove(fen);
  const played = g.line.lastMoves[i].join("");
  const tc = g.meta.timeControl;
  const clock = g.clocks[i];
  if (tc && clock !== null && clock !== undefined) {
    const left = clock - tc.increment * 1000;
    const prev = i >= 2 ? (g.clocks[i - 2] ?? tc.initial * 1000) : tc.initial * 1000;
    const spent = prev - left;
    if (left < Math.max(tc.initial * 100, 10_000)) tags.push("time-trouble");
    else if (spent < 3000 && i >= 2 && cls !== "inaccuracy") tags.push("rushed");
  }
  if (before.mate && pov(before, mover) > 0 && !(after.mate && pov(after, mover) > 0)) tags.push("missed-mate");
  if (after.mate && pov(after, mover) < 0 && !(before.mate && pov(before, mover) < 0)) tags.push("allowed-mate");
  const best = moveFacts(fen, before.best);
  const mine = moveFacts(fen, played);
  const reply = moveFacts(g.line.fens[i + 1], after.best);
  if (reply?.captured && reply.captured !== "p" && cls !== "inaccuracy") tags.push("hung-piece");
  if (best?.captured && !mine?.captured && best.captured !== "p") tags.push("missed-capture");
  if (best?.check && !mine?.check && !tags.includes("missed-mate")) tags.push("missed-check");
  return tags;
}

export async function analyzeGame(g: GameInput, onProgress?: (done: number, total: number) => void) {
  const { fens } = g.line;
  const evals: Eval[] = [];
  for (let i = 0; i < fens.length; i++) {
    evals.push(await evaluate(fens[i]));
    onProgress?.(i + 1, fens.length);
  }
  const annotations: MoveAnnotation[] = g.line.sans.map((_, i) => {
    const mover = sideToMove(fens[i]);
    const played = g.line.lastMoves[i].join("") + (g.line.sans[i].match(/=([QRBN])/)?.[1].toLowerCase() ?? "");
    const [before, after] = [evals[i], evals[i + 1]];
    const isBest = before.best === played;
    const drop = isBest ? 0 : Math.max(0, winPct(before, mover) - winPct(after, mover));
    const cls = classify(drop, isBest);
    const cpLoss = isBest ? 0 : Math.max(0, Math.min(1000, pov(before, mover) - pov(after, mover)));
    return {
      class: cls,
      cpLoss: Math.round(cpLoss),
      bestUci: before.best,
      evalAfter: after.cp,
      phase: phaseOf(fens[i], i),
      tags: tagsFor(g, i, before, after, cls),
    };
  });

  if (hasBackend()) {
    await invoke("db_save_analysis", {
      gameId: g.gameId,
      openingName: openingName(g.line.sans)?.name ?? null,
      moves: annotations.map((a, i) => ({
        ply: i + 1,
        evalBefore: evals[i].cp,
        evalAfter: a.evalAfter,
        cpLoss: a.cpLoss,
        bestUci: a.bestUci,
        class: a.class,
        phase: a.phase,
        tags: a.tags,
      })),
    });
    await addMistakeDrills(g, annotations);
  }
  return annotations;
}

let queue: Promise<unknown> = Promise.resolve();

/** Analyzes the open game (when it ends) and any finished games still unanalyzed, one at a time. */
export function initReview() {
  useStore.subscribe((s, prev) => {
    if (s.gameId !== null && s.gameId === prev.gameId && s.meta.result && !prev.meta.result) {
      enqueueCurrent();
    }
  });
  if (!hasBackend()) return;
  queue = queue.then(async () => {
    const ids = await invoke<number[]>("db_unanalyzed_games");
    for (const id of ids) await analyzeStored(id);
  });
}

function enqueueCurrent() {
  const { gameId, game, meta, clocks } = useStore.getState();
  if (gameId === null || game.sans.length === 0) return;
  const input: GameInput = { gameId, line: game, meta, clocks };
  queue = queue.then(async () => {
    const isOpen = () => useStore.getState().gameId === gameId;
    if (isOpen()) useStore.setState({ review: { done: 0, total: game.fens.length } });
    try {
      const annotations = await analyzeGame(input, (done, total) => {
        if (isOpen()) useStore.setState({ review: { done, total } });
      });
      if (isOpen()) useStore.setState({ annotations, review: null });
    } catch (e) {
      console.error("analysis failed", e);
      if (isOpen()) useStore.setState({ review: null });
    }
  });
}

async function analyzeStored(id: number) {
  const record = await db.loadGame(id);
  if (!record) return;
  const built = buildLine(record.game.startFen, record.moves.map((m) => m.san));
  if (!("line" in built)) return;
  const tc = record.game.timeControl?.match(/^(\d+)\+(\d+)$/);
  try {
    const annotations = await analyzeGame({
      gameId: id,
      line: built.line,
      meta: {
        studentColor: record.game.studentColor,
        mode: record.game.mode,
        timeControl: tc ? { initial: Number(tc[1]), increment: Number(tc[2]) } : null,
      },
      clocks: record.moves.map((m) => m.clockMs),
    });
    if (useStore.getState().gameId === id) useStore.setState({ annotations });
  } catch (e) {
    console.error(`analysis of game ${id} failed`, e);
  }
}

/** The student's worst moments in the open game, for the review bar and the coach. */
export function keyMoments(limit = 6): number[] {
  const { annotations, game, meta } = useStore.getState();
  return annotations
    .map((a, i) => ({ a, i }))
    .filter(({ a, i }) => a && (a.class === "mistake" || a.class === "blunder") && isStudentMove(game, meta, i))
    .sort((x, y) => y.a!.cpLoss - x.a!.cpLoss)
    .slice(0, limit)
    .map(({ i }) => i)
    .sort((x, y) => x - y);
}

export const isStudentMove = (game: Line, meta: Pick<GameMeta, "studentColor">, i: number) =>
  meta.studentColor === "both" || sideToMove(game.fens[i]) === meta.studentColor;
