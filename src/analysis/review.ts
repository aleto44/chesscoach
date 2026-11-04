// Post-game analysis, all local (Stockfish, no AI): evaluates every position of a finished game,
// classifies each move by how much winning chance it gave away (lichess thresholds), labels it the
// way chess.com's review does (brilliant, great, miss, ...), tags the mistakes with simple
// patterns, saves it all to SQLite and turns the student's mistakes into drills.
import { invoke } from "../backend";
import { Chess } from "chess.js";
import { buildLine, sideToMove, START_FEN, type Line } from "../chess/line";
import { db, hasBackend } from "../db";
import { whiteWinPercent } from "../engine/live";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import { useStore, type Color, type GameMeta } from "../store";
import { inBook, openingName } from "../openings/book";
import { addMistakeDrills } from "./drills";

const DEPTH = 13;
const MATE_CP = 10000;

/** Severity, lichess-style. Stats and drills work on this. */
export type MoveClass = "best" | "good" | "inaccuracy" | "mistake" | "blunder";
/** The review's verdict on a move, chess.com-style (see labelFor). */
export type MoveLabel =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";
export type Phase = "opening" | "middlegame" | "endgame";

export interface MoveAnnotation {
  class: MoveClass;
  /** Missing in analyses saved before labels existed; read it with labelOf. */
  label?: MoveLabel;
  /** Centipawns the move gave away, mover's view (0–1000). */
  cpLoss: number;
  bestUci: string | null;
  /** White's view before and after the move, centipawns (mate = ±10000). */
  evalBefore?: number;
  evalAfter: number;
  phase: Phase;
  tags: string[];
}

interface Score {
  /** White's view, centipawns; mates as ±(10000 − distance). */
  cp: number;
  mate: boolean;
}

interface Eval extends Score {
  best: string | null;
  /** The engine's second choice, to tell an only move ("great") from one of several good ones. */
  second: Score | null;
}

/** Thresholds on what a move threw away (see lossPoints), in percentage points (as lichess). */
function classify(drop: number, isBest: boolean): MoveClass {
  if (drop >= 15) return "blunder";
  if (drop >= 10) return "mistake";
  if (drop >= 5) return "inaccuracy";
  return isBest ? "best" : "good";
}

function score(line: EngineLine): Score {
  if (line.mate !== undefined) {
    const sign = line.mate > 0 ? 1 : -1;
    return { cp: sign * (MATE_CP - Math.abs(line.mate)), mate: true };
  }
  return { cp: line.cp ?? 0, mate: false };
}

async function evaluate(fen: string): Promise<Eval> {
  const chess = new Chess(fen);
  const none = { best: null, second: null };
  if (chess.isCheckmate()) return { cp: chess.turn() === "w" ? -MATE_CP : MATE_CP, mate: true, ...none };
  if (chess.isGameOver()) return { cp: 0, mate: false, ...none };
  const [line, second] = await getReviewEngine().analyze(fen, 2, DEPTH);
  if (!line) return { cp: 0, mate: false, ...none };
  return { ...score(line), best: line.pv[0] ?? null, second: second ? score(second) : null };
}

const winPct = (e: Score, side: Color) => {
  const w = e.mate ? (e.cp > 0 ? 100 : 0) : whiteWinPercent({ cp: e.cp });
  return side === "white" ? w : 100 - w;
};
const pov = (e: Score, side: Color) => (side === "white" ? e.cp : -e.cp);

/**
 * What a move threw away, in points (≈ percentage points of winning chances, as lichess).
 * Winning chances alone flatten out once a game is decided: from −5 another lost rook barely
 * moves them, so a student who keeps hanging pieces in a bad position would see "good" moves.
 * So unless the mover is still clearly winning afterwards (then a lost pawn or two really doesn't
 * matter), the centipawns lost count too: 10 cp per point, more forgiving as the eval grows
 * (engine numbers are noisy at −10), so 50 / 100 / 150 cp make an inaccuracy / mistake / blunder
 * in a level position.
 */
function lossPoints(before: Score, after: Score, mover: Color): number {
  const drop = Math.max(0, winPct(before, mover) - winPct(after, mover));
  if (pov(after, mover) >= 150) return drop;
  const cpLoss = Math.min(1000, Math.max(0, pov(before, mover) - pov(after, mover)));
  const scale = 1 + Math.min(Math.abs(pov(before, mover)), 1500) / 1500;
  return Math.max(drop, cpLoss / (10 * scale));
}

/** lossPoints from stored evals (White's view, mates as ±(10000 − distance)). */
export const lossFromEvals = (before: number, after: number, mover: Color) =>
  lossPoints({ cp: before, mate: Math.abs(before) >= 9000 }, { cp: after, mate: Math.abs(after) >= 9000 }, mover);

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

/**
 * For each of the opponent's pieces (not pawns) the side to move can win, the material it gains
 * in pawns, counting the capturer as lost when it can be taken back on that square. A one-ply
 * exchange estimate: enough to spot a piece left en prise.
 */
function captureGains(fen: string): Map<string, number> {
  const chess = new Chess(fen);
  const gains = new Map<string, number>();
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured || VALUES[m.captured] < 3) continue;
    chess.move(m);
    const recapture = chess.moves({ verbose: true }).some((r) => r.to === m.to);
    chess.undo();
    const gain = VALUES[m.captured] - (recapture ? VALUES[m.piece] : 0);
    if (gain > (gains.get(m.to) ?? 0)) gains.set(m.to, gain);
  }
  return gains;
}

/** What the opponent already threatened to win, by square, as if the mover passed (none in check). */
function threatened(fen: string): Map<string, number> {
  if (new Chess(fen).inCheck()) return new Map();
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  try {
    return captureGains(parts.join(" "));
  } catch {
    return new Map();
  }
}

/**
 * The move newly leaves a piece (not a pawn) for the taking and gives up material on balance.
 * Leaving a piece that was already attacked doesn't count.
 */
function isSacrifice(fenBefore: string, fenAfter: string, played: string): boolean {
  const captured = moveFacts(fenBefore, played)?.captured;
  const before = threatened(fenBefore);
  let gain = 0;
  for (const [sq, g] of captureGains(fenAfter)) {
    if (sq === played.slice(2, 4) || !before.has(sq)) gain = Math.max(gain, g);
  }
  return gain >= 2 && gain - (captured ? VALUES[captured] : 0) >= 1;
}

/**
 * chess.com-style verdict, refining the severity class. `drops` holds lossPoints for every move
 * up to this one.
 * - book: still on a line of the opening book.
 * - brilliant: a sound sacrifice: gives up a piece, not losing, and best or nearly (only the best
 *   move when already winning, where any sensible move would do).
 * - great: the only good move (the engine's second choice is a blunder), not a plain recapture.
 * - excellent / good: not the engine's move, losing under 2 / 5 points.
 * - miss: a mistake or blunder that fails to punish the opponent's own mistake (leaving you about
 *   where you were before it), or lets a forced mate slip while still winning.
 */
function labelFor(g: GameInput, evals: Eval[], i: number, cls: MoveClass, drops: number[], played: string): MoveLabel {
  const { fens, sans, lastMoves } = g.line;
  const mover = sideToMove(fens[i]);
  const [before, after] = [evals[i], evals[i + 1]];
  const winBefore = winPct(before, mover);
  const winAfter = winPct(after, mover);
  const drop = drops[i];

  if (g.line.startFen === START_FEN && drop < 5 && inBook(sans.slice(0, i + 1))) return "book";
  if (cls === "mistake" || cls === "blunder") {
    const unpunished = i > 0 && drops[i - 1] >= 10 && winAfter >= winPct(evals[i - 1], mover) - 5;
    const slipped = before.mate && pov(before, mover) > 0 && winAfter >= 60;
    return unpunished || slipped ? "miss" : cls;
  }
  if (cls === "inaccuracy") return cls;
  const sound = cls === "best" || (drop < 2 && winBefore < 97);
  if (sound && winAfter >= 50 && isSacrifice(fens[i], fens[i + 1], played)) return "brilliant";
  if (cls === "best" && before.second) {
    const gap = winBefore - winPct(before.second, mover);
    const recapture = i > 0 && lastMoves[i][1] === lastMoves[i - 1][1] && sans[i - 1].includes("x");
    if (gap >= 15 && !recapture) return "great";
  }
  if (cls === "best") return "best";
  return drop < 2 ? "excellent" : "good";
}

/** The verdict on an analyzed move; analyses saved before labels have only the severity class. */
export function labelOf(a: MoveAnnotation): MoveLabel {
  if (a.label) return a.label;
  if (a.class === "good") return a.cpLoss < 20 ? "excellent" : "good";
  return a.class;
}

export async function analyzeGame(g: GameInput, onProgress?: (done: number, total: number) => void) {
  const { fens } = g.line;
  const evals: Eval[] = [];
  for (let i = 0; i < fens.length; i++) {
    evals.push(await evaluate(fens[i]));
    onProgress?.(i + 1, fens.length);
  }
  const drops: number[] = [];
  const annotations: MoveAnnotation[] = g.line.sans.map((_, i) => {
    const mover = sideToMove(fens[i]);
    const played = g.line.lastMoves[i].join("") + (g.line.sans[i].match(/=([QRBN])/)?.[1].toLowerCase() ?? "");
    const [before, after] = [evals[i], evals[i + 1]];
    const isBest = before.best === played;
    const drop = isBest ? 0 : lossPoints(before, after, mover);
    drops.push(drop);
    const cls = classify(drop, isBest);
    const cpLoss = isBest ? 0 : Math.max(0, Math.min(1000, pov(before, mover) - pov(after, mover)));
    return {
      class: cls,
      label: labelFor(g, evals, i, cls, drops, played),
      cpLoss: Math.round(cpLoss),
      bestUci: before.best,
      evalBefore: before.cp,
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
        label: a.label,
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
    if (s.gameId !== prev.gameId && s.reportOpen) useStore.setState({ reportOpen: false });
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
      // The report opens by itself when the game just played has been analyzed.
      if (isOpen()) useStore.setState({ annotations, review: null, reportOpen: !useStore.getState().active });
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
