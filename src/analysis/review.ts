// Post-game analysis, all local (Stockfish, no AI): evaluates every position of a finished game,
// classifies each move by how much winning chance it gave away (chess.com's thresholds), labels it the
// way chess.com's review does (brilliant, great, miss, ...), tags the mistakes with simple
// patterns, saves it all to SQLite and turns the student's mistakes into drills.
import { invoke } from "../backend";
import { Chess } from "chess.js";
import { buildLine, moveLabel, sideToMove, START_FEN, type Line } from "../chess/line";
import { db, hasBackend, notifyChanged, reliably } from "../db";
import { whiteWinPercent } from "../engine/live";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import { useStore, type Color, type GameMeta } from "../store";
import { inBook, openingName } from "../openings/book";
import { addMistakeDrills } from "./drills";
import { isFollowing } from "../game/sync";
import { create } from "zustand";

const DEPTH = 13;
const MATE_CP = 10000;

/** Severity. Stats and drills work on this. */
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
  /**
   * Points the engine's second choice gives away against its first: how much the position asks
   * for one particular move. Only on fresh analyses (not saved); drills are picked with it.
   */
  secondLoss?: number;
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

/**
 * Thresholds on what a move threw away (see lossPoints), in percentage points of winning chances:
 * chess.com's published "expected points lost" table (0.05 / 0.10 / 0.20; excellent under 0.02,
 * good under 0.05, see labelFor). Lichess calls a blunder from 15; chess.com waits for 20.
 */
export function classify(drop: number, isBest: boolean): MoveClass {
  if (drop >= 20) return "blunder";
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
 * So once the mover is clearly worse (where that flattening starts), the centipawns lost count too:
 * 10 cp per point, more forgiving as the eval grows (engine numbers are noisy at −10), so at −4
 * a lost piece is a mistake and a lost rook a blunder, while a pawn or so stays unmarked, as on
 * chess.com. Around equal, winning chances alone decide, also as there: centipawns there made
 * 1-pawn slips into mistakes that chess.com doesn't flag at all.
 */
function lossPoints(before: Score, after: Score, mover: Color): number {
  const drop = Math.max(0, winPct(before, mover) - winPct(after, mover));
  if (pov(after, mover) >= 150 || pov(before, mover) > -LOST_CP) return drop;
  const cpLoss = Math.min(1000, Math.max(0, pov(before, mover) - pov(after, mover)));
  const scale = 1 + Math.min(Math.abs(pov(before, mover)), 1500) / 450;
  return Math.max(drop, cpLoss / (10 * scale));
}
/** How far behind (centipawns) the mover must be before lossPoints counts centipawns. */
const LOST_CP = 200;

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
  return sacrificed(fenBefore, fenAfter, played) !== null;
}

/** The square of the piece a sacrifice offers (see isSacrifice), or null when it isn't one. */
function sacrificed(fenBefore: string, fenAfter: string, played: string): string | null {
  const captured = moveFacts(fenBefore, played)?.captured;
  const before = threatened(fenBefore);
  let gain = 0;
  let square: string | null = null;
  for (const [sq, g] of captureGains(fenAfter)) {
    if ((sq === played.slice(2, 4) || !before.has(sq)) && g > gain) [gain, square] = [g, sq];
  }
  return gain >= 2 && gain - (captured ? VALUES[captured] : 0) >= 1 ? square : null;
}

/**
 * chess.com-style verdict, refining the severity class. `drops` holds lossPoints for every move
 * up to this one.
 * - book: still on a line of the opening book.
 * - brilliant: a sound sacrifice: gives up a piece, not losing, and best or nearly (only the best
 *   move when already winning, where any sensible move would do).
 * - great: the only good move (the engine's second choice is a blunder), not a plain recapture,
 *   a mate or taking a piece the opponent just blundered.
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
    // Like chess.com, mating or taking what a blunder just left hanging is plain "best".
    const mates = sans[i].includes("#");
    const takesBlunder = i > 0 && drops[i - 1] >= 20 && sans[i].includes("x");
    if (gap >= 15 && !recapture && !mates && !takesBlunder) return "great";
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
      secondLoss: before.second ? lossPoints(before, before.second, mover) : undefined,
    };
  });

  if (hasBackend()) {
    const args = {
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
    };
    // A phone can lose the computer for a moment; the review shouldn't go with it.
    await reliably("saving the analysis", () => invoke("db_save_analysis", args));
    // The other device then shows the review too, without analyzing the game again.
    notifyChanged(g.gameId);
    await reliably("adding drills", () => addMistakeDrills(g, annotations));
  }
  return annotations;
}

let queue: Promise<unknown> = Promise.resolve();

/** Analyzes the open game (when it ends) and any finished games still unanalyzed, one at a time. */
export function initReview() {
  useStore.subscribe((s, prev) => {
    if (s.gameId !== prev.gameId && s.reportOpen) useStore.setState({ reportOpen: false });
    // A game ended on the other device is analyzed there; this one picks up the saved review.
    // (If that device goes away first, the game is analyzed with the backlog at the next launch.)
    if (s.gameId !== null && s.gameId === prev.gameId && s.meta.result && !prev.meta.result && !isFollowing()) {
      enqueueCurrent();
    }
  });
  analyzeBacklog();
}

/** Finished games still waiting for their review (e.g. just imported): how far along it is. */
export const useBacklog = create<{ done: number; total: number } | null>(() => null);
let backlogQueued = false;

/** Analyzes every finished game that has no review yet, newest first, one at a time. */
export function analyzeBacklog() {
  if (!hasBackend() || backlogQueued) return;
  backlogQueued = true;
  queue = queue.then(async () => {
    backlogQueued = false;
    let ids: number[] = [];
    try {
      ids = await invoke<number[]>("db_unanalyzed_games");
    } catch (e) {
      console.warn("could not list the games waiting for review", e);
    }
    const total = ids.length;
    for (const [i, id] of ids.entries()) {
      useBacklog.setState({ done: i, total }, true);
      await analyzeStored(id);
    }
    useBacklog.setState(null, true);
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

// ---- Key moments ----

/**
 * A move of the student's that swung the game: a mistake or blunder that cost them, or a move that
 * won it for them (brilliant, the only good move, punishing the opponent's mistake). `reason` says
 * in words what happened, from the engine's numbers and the position; never how it ranks.
 */
export interface KeyMoment {
  /** Index of the move (the position before it is game.fens[i]). */
  i: number;
  good: boolean;
  reason: string;
}

const PIECE: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

type Anns = (MoveAnnotation | null | undefined)[];

/** Eval before move i (White's view): older analyses only kept the eval after each move. */
const evalBeforeAt = (anns: Anns, i: number) => anns[i]?.evalBefore ?? (i > 0 ? anns[i - 1]?.evalAfter : undefined) ?? 0;
const winAt = (cp: number, side: Color) => Math.round(winPct({ cp, mate: Math.abs(cp) >= 9000 }, side));
const lossAt = (anns: Anns, i: number, mover: Color) => lossFromEvals(evalBeforeAt(anns, i), anns[i]!.evalAfter, mover);
const evalFor = (cp: number, side: Color) => {
  const v = side === "white" ? cp : -cp;
  return Math.abs(v) >= 9000 ? (v > 0 ? "a forced mate" : "mate against you") : (v >= 0 ? "+" : "") + (v / 100).toFixed(1);
};

/** How a bad move changed the game, from the mover's winning chances (or the eval, once decided). */
function lossSwing(before: number, after: number, side: Color): string {
  const [wb, wa] = [winAt(before, side), winAt(after, side)];
  const chances = `winning chances ${wb}% → ${wa}%`;
  if (wa === 0 && Math.abs(after) >= 9000) return `After this the game was lost (${chances}).`;
  if (wb - wa < 10) return `You were already ${wb < 50 ? "worse" : "winning"}, but it gave away more (eval ${evalFor(before, side)} → ${evalFor(after, side)}).`;
  if (wb >= 65 && wa < 55) return `You were winning, and this threw the advantage away (${chances}).`;
  if (wa <= 15 && wb >= 30) return `After this the game was as good as lost (${chances}).`;
  if (wb >= 35 && wa < 35) return `The game was level, and after this you were clearly worse (${chances}).`;
  return `It cost you a lot (${chances}).`;
}

function badReason(game: Line, anns: Anns, i: number): string {
  const a = anns[i]!;
  const fen = game.fens[i];
  const mover = sideToMove(fen);
  const best = moveFacts(fen, a.bestUci);
  // The engine's best reply is the next move's best move.
  const replyUci = i + 1 < game.sans.length ? (anns[i + 1]?.bestUci ?? null) : null;
  const reply = moveFacts(game.fens[i + 1], replyUci);
  const parts: string[] = [];
  if (a.tags.includes("allowed-mate") && reply) parts.push(`It allows a forced mate, starting with ${reply.san}.`);
  else if (a.tags.includes("missed-mate") && best) parts.push(`You had a forced mate, starting with ${best.san}.`);
  else if (a.tags.includes("hung-piece") && reply?.captured)
    parts.push(`It leaves your ${PIECE[reply.captured]} on ${replyUci!.slice(2, 4)} to be taken: ${reply.san}.`);
  else if (a.tags.includes("missed-capture") && best?.captured)
    parts.push(`${best.san} would have won their ${PIECE[best.captured]} on ${a.bestUci!.slice(2, 4)}.`);
  else if (labelOf(a) === "miss" && i > 0)
    parts.push(`${moveLabel(game.fens[i - 1], game.sans[i - 1])} was a mistake by your opponent, and this let them off the hook.`);
  else if (a.tags.includes("missed-check") && best) parts.push(`${best.san} was a strong check you missed.`);
  parts.push(lossSwing(evalBeforeAt(anns, i), a.evalAfter, mover));
  if (a.tags.includes("time-trouble")) parts.push("You were short on time.");
  else if (a.tags.includes("rushed")) parts.push("You played it within three seconds.");
  return parts.join(" ");
}

function goodReason(game: Line, anns: Anns, i: number, punished: boolean): string {
  const a = anns[i]!;
  const fen = game.fens[i];
  const mover = sideToMove(fen);
  const played = game.lastMoves[i].join("") + (game.sans[i].match(/=([QRBN])/)?.[1].toLowerCase() ?? "");
  const label = labelOf(a);
  const parts: string[] = [];
  if (label === "brilliant") {
    const sq = sacrificed(fen, game.fens[i + 1], played);
    const piece = sq ? new Chess(game.fens[i + 1]).get(sq as never) : null;
    parts.push(
      piece
        ? `You offered your ${PIECE[piece.type]} on ${sq}, and taking it doesn't work out for them.`
        : "You gave up material here, and it works.",
    );
  } else if (label === "great") {
    parts.push("The only good move here: the engine's next choice would have given away most of your edge.");
  }
  if (punished) {
    const prev = anns[i - 1]!;
    const took = moveFacts(fen, played)?.captured;
    parts.push(
      `${moveLabel(game.fens[i - 1], game.sans[i - 1])} was a ${prev.class} by your opponent, and you made them pay` +
        (took && took !== "p" ? `, taking the ${PIECE[took]} on ${played.slice(2, 4)}` : "") +
        ` (winning chances ${winAt(evalBeforeAt(anns, i - 1), mover)}% → ${winAt(a.evalAfter, mover)}%).`,
    );
  } else {
    const w = winAt(a.evalAfter, mover);
    parts.push(`It kept you ${w >= 60 ? "on top" : "in the game"} (winning chances ${w}%).`);
  }
  return parts.join(" ");
}

/**
 * The moments that swung the game for the student: their costliest mistakes and blunders (up to
 * five) and their best finds (up to three), in game order.
 */
export function findKeyMoments(game: Line, anns: Anns, meta: Pick<GameMeta, "studentColor">): KeyMoment[] {
  const bad: { i: number; w: number }[] = [];
  const good: { i: number; w: number; punished: boolean }[] = [];
  anns.forEach((a, i) => {
    if (!a || !isStudentMove(game, meta, i)) return;
    const mover = sideToMove(game.fens[i]);
    if (a.class === "mistake" || a.class === "blunder") return void bad.push({ i, w: lossAt(anns, i, mover) });
    const label = labelOf(a);
    if (!["best", "excellent", "great", "brilliant"].includes(label)) return;
    // Punished: the opponent's move just before was a mistake, and this move cashed it in.
    const prev = i > 0 ? anns[i - 1] : null;
    const gained = prev ? winAt(a.evalAfter, mover) - winAt(evalBeforeAt(anns, i - 1), mover) : 0;
    const punished = !!prev && (prev.class === "mistake" || prev.class === "blunder") && gained >= 10;
    if (label === "brilliant") good.push({ i, w: 100, punished });
    else if (label === "great") good.push({ i, w: Math.max(20, a.secondLoss ?? 0), punished });
    else if (punished) good.push({ i, w: gained, punished });
  });
  const top = <T extends { w: number }>(xs: T[], n: number) => [...xs].sort((x, y) => y.w - x.w).slice(0, n);
  return [
    ...top(bad, 5).map(({ i }) => ({ i, good: false, reason: badReason(game, anns, i) })),
    ...top(good, 3).map(({ i, punished }) => ({ i, good: true, reason: goodReason(game, anns, i, punished) })),
  ].sort((x, y) => x.i - y.i);
}

let cached: { anns: Anns; game: Line; color: string; moments: KeyMoment[] } | null = null;

/** Key moments of the open game, for the review bar, the board and the coach. */
export function keyMoments(): KeyMoment[] {
  const { annotations, game, meta } = useStore.getState();
  if (cached?.anns !== annotations || cached.game !== game || cached.color !== meta.studentColor) {
    cached = { anns: annotations, game, color: meta.studentColor, moments: findKeyMoments(game, annotations, meta) };
  }
  return cached.moments;
}

export const isStudentMove = (game: Line, meta: Pick<GameMeta, "studentColor">, i: number) =>
  meta.studentColor === "both" || sideToMove(game.fens[i]) === meta.studentColor;
