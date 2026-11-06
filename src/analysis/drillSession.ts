// A drill session: works through due cards on the main board, graded locally by Stockfish.
// "Mistake" and "coach" cards: any move the review would call good (under an inaccuracy) counts. "Opening" cards:
// the student plays their repertoire line from memory while the app plays the other side.
// "Puzzle" cards replay a missed Lichess puzzle the same way, and any mating move counts.
// Each drill opens on the position before the opponent's last move and plays it, so the student
// sees what led there (as a puzzle does), and a wrong answer comes with the engine's reasons.
import type { Key } from "chessground/types";
import { create } from "zustand";
import { Chess } from "chess.js";
import { buildLine, moveLabel, playAt, sideToMove, type Line } from "../chess/line";
import { stepView, viewedPly, type Step } from "../chess/view";
import { db } from "../db";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import { getPuzzle } from "../puzzles/puzzles";
import { dueDrills, gradeDrill, retireDrill, type Drill } from "./drills";
import { explainCached, type Explanation } from "./explain";
import { lossFromEvals } from "./review";

/**
 * Loss in review points (see lossPoints) a drill answer may give away: below an inaccuracy. A flat
 * centipawn cutoff failed sound alternatives on search noise (Nge2 for f4, 30cp apart in a level
 * opening); the review itself would have called them good.
 */
const TOLERANCE = 5;

/** How long the position before the opponent's move shows before the move is played. */
const INTRO_MS = 700;

/** The opponent's move that led to the drill's position. */
export interface LeadIn {
  fen: string;
  san: string;
  /** "13...b4". */
  label: string;
}

export interface DrillState {
  queue: Drill[];
  index: number;
  /** The moves so far: the lead-in move (if there is one), then the drill's own. */
  line: Line | null;
  lead: LeadIn | null;
  /** Plies of `line` before the drill's own start position: 1 with a lead-in, else 0. */
  base: number;
  /** Ply the student stepped back to (null = the latest position). Moves are played at the latest only. */
  view: number | null;
  status: "loading" | "intro" | "solving" | "checking" | "right" | "wrong" | "done";
  /** What went wrong / right, shown under the board. */
  message: string;
  /** Best (green) and played (red) moves to draw after grading. */
  shapes: { orig: Key; dest: Key; brush: string }[];
  startedAt: number;
  /** Next review date of the drill just graded. */
  nextDue: string | null;
  correct: number;
  /** After a wrong answer: what the move allows and what the better move does (null while it's worked out). */
  why: Explanation | null;
  whyFailed: boolean;
}

export const useDrill = create<DrillState | null>(() => null);

const current = () => {
  const s = useDrill.getState();
  return s && s.queue[s.index];
};

function emptyAt(fen: string): Line {
  return { startFen: fen, sans: [], fens: [fen], lastMoves: [], notes: [] };
}

const blank = (queue: Drill[]): DrillState => ({
  queue,
  index: 0,
  line: null,
  lead: null,
  base: 0,
  view: null,
  status: "loading",
  message: "",
  shapes: [],
  startedAt: 0,
  nextDue: null,
  correct: 0,
  why: null,
  whyFailed: false,
});

export async function startDrills(all = false) {
  useDrill.setState(blank([]), true);
  const queue = await dueDrills(30, all);
  if (!useDrill.getState()) return;
  useDrill.setState({ ...blank(queue), status: queue.length ? "loading" : "done" }, true);
  if (queue.length) begin(0);
}

export function stopDrills() {
  useDrill.setState(null, true);
}

const sameSpot = (a: string, b: string) => a.split(" ").slice(0, 3).join(" ") === b.split(" ").slice(0, 3).join(" ");

/** The opponent's move into the drill's position: from the source game, or the missed puzzle. */
async function leadIn(drill: Drill): Promise<LeadIn | null> {
  let before: { fen: string; san: string } | null = null;
  if (drill.kind === "mistake" && drill.sourceGameId !== null) {
    const rec = await db.loadGame(drill.sourceGameId);
    const row = rec?.moves.find((m) => sameSpot(m.fenAfter, drill.fen));
    if (row) before = { fen: row.fenBefore, san: row.san };
  } else if (drill.kind === "puzzle") {
    const id = drill.title.match(/^Puzzle (\S+)/)?.[1];
    const p = id ? await getPuzzle(id) : null;
    if (p?.moves[0]) {
      const chess = new Chess(p.fen);
      const m = chess.move({ from: p.moves[0].slice(0, 2), to: p.moves[0].slice(2, 4), promotion: p.moves[0][4] });
      if (sameSpot(chess.fen(), drill.fen)) before = { fen: p.fen, san: m.san };
    }
  }
  return before && { ...before, label: moveLabel(before.fen, before.san) };
}

async function begin(index: number) {
  const s = useDrill.getState()!;
  const drill = s.queue[index];
  if (!drill) {
    useDrill.setState({ index, status: "done", line: null, lead: null, base: 0, shapes: [], message: "", why: null });
    return;
  }
  let lead: LeadIn | null = null;
  try {
    lead = await leadIn(drill);
  } catch (e) {
    console.warn("no lead-in for the drill", e);
  }
  if (useDrill.getState()?.queue !== s.queue) return;
  const reset = { index, view: null, message: "", shapes: [], nextDue: null, why: null, whyFailed: false };
  if (!lead) {
    useDrill.setState({ ...reset, line: emptyAt(drill.fen), lead: null, base: 0, status: "solving", startedAt: Date.now() });
    autoplay();
    return;
  }
  useDrill.setState({ ...reset, line: emptyAt(lead.fen), lead, base: 1, status: "intro" });
  window.setTimeout(() => {
    const now = useDrill.getState();
    if (!now || now.queue[now.index] !== drill || now.status !== "intro") return;
    const built = buildLine(lead.fen, [lead.san]);
    if (!("line" in built)) return;
    useDrill.setState({ line: built.line, view: null, status: "solving", startedAt: Date.now() });
    autoplay();
  }, INTRO_MS);
}

export const nextDrill = () => {
  const s = useDrill.getState()!;
  // While the next one loads, the board stays put but takes no moves.
  useDrill.setState({ status: "loading" });
  begin(s.index + 1);
};

export async function retireCurrent() {
  const drill = current();
  if (drill) await retireDrill(drill.id);
  nextDrill();
}

/** Drills that follow a line (opening and puzzle). */
const followsLine = (d: Drill) => d.kind === "opening" || d.kind === "puzzle";

/** Line drills: play the other side's moves of the line. */
function autoplay() {
  const s = useDrill.getState();
  const drill = current();
  if (!s || !drill || !followsLine(drill) || s.status !== "solving" || !s.line) return;
  const ply = s.line.sans.length - s.base;
  if (ply >= drill.line.length) {
    return finish(true, drill.line[drill.line.length - 1] ?? "", drill.kind === "puzzle" ? "Solved." : "Line complete.");
  }
  if (sideToMove(s.line.fens[s.line.sans.length]) === drill.color) return;
  window.setTimeout(() => {
    const now = useDrill.getState();
    if (!now?.line || now.index !== s.index || now.line !== s.line || now.status !== "solving") return;
    const built = buildLine(now.line.startFen, [...now.line.sans.slice(0, now.base), ...drill.line.slice(0, ply + 1)]);
    if ("line" in built) {
      // The opponent's move brings the board back to the present, as in a game.
      useDrill.setState({ line: built.line, view: null });
      autoplay();
    }
  }, 350);
}

const toCp = (l: EngineLine | undefined, side: "white" | "black") => {
  if (!l) return 0;
  const white = l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0);
  return side === "white" ? white : -white;
};

const uciOf = (fen: string, san: string) => {
  const m = new Chess(fen).move(san);
  return m.from + m.to + (m.promotion ?? "");
};

/**
 * Works out why the answer was wrong (the opponent's best reply and what it comes to, and what the
 * better move does) for the panel under the board. Evals are White's view; searched when not given.
 */
async function explainWrong(fen: string, uci: string, bestUci: string, evals?: { before: number; after: number }) {
  const index = useDrill.getState()?.index;
  const still = () => useDrill.getState()?.index === index;
  try {
    let e = evals;
    if (!e) {
      const engine = getReviewEngine();
      const [best] = await engine.analyze(fen, 1, 12);
      const after = new Chess(fen);
      after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      const [reply] = after.isGameOver() ? [] : await engine.analyze(after.fen(), 1, 12);
      e = { before: toCp(best, "white"), after: toCp(reply, "white") };
    }
    const why = await explainCached({ fenBefore: fen, uci, bestUci, evalBefore: e.before, evalAfter: e.after });
    if (still()) useDrill.setState({ why });
  } catch (err) {
    console.error("could not explain the drill answer", err);
    if (still()) useDrill.setState({ whyFailed: true });
  }
}

export async function drillMove(from: Key, to: Key, promotion?: string) {
  const s = useDrill.getState();
  const drill = current();
  if (!s || !drill || s.status !== "solving" || !s.line || s.view !== null) return;
  const ply = s.line.sans.length;
  const fen = s.line.fens[ply];
  if (sideToMove(fen) !== drill.color) return;
  const played = playAt(s.line, ply, from, to, promotion);
  if (!played) return;
  useDrill.setState({ line: played.line });
  const uci = from + to + (played.san.match(/=([QRBN])/)?.[1].toLowerCase() ?? "");

  if (followsLine(drill)) {
    const expected = drill.line[ply - s.base];
    if (played.san === expected) {
      autoplay();
      return;
    }
    if (drill.kind === "puzzle" && new Chess(played.line.fens[ply + 1]).isCheckmate()) {
      return finish(true, played.san, "Solved.");
    }
    const exp = new Chess(fen).move(expected);
    useDrill.setState({ shapes: [{ orig: exp.from as Key, dest: exp.to as Key, brush: "green" }] });
    // A repertoire move isn't always the engine's, so only puzzle misses get the engine's reasons.
    if (drill.kind === "puzzle") explainWrong(fen, uci, uciOf(fen, expected));
    return finish(
      false,
      played.san,
      drill.kind === "puzzle" ? `${played.san} isn't it. The solution: ${drill.line.slice(ply - s.base).join(" ")}.` : `Your repertoire plays ${expected} here.`,
    );
  }

  // Mistake / coach drills: one move, judged by the engine.
  useDrill.setState({ status: "checking" });
  const answer = drill.answerUci;
  const answerSan = answer ? new Chess(fen).move({ from: answer.slice(0, 2), to: answer.slice(2, 4), promotion: answer[4] }).san : null;
  let correct = uci === answer;
  let bestUci = answer;
  let evals: { before: number; after: number } | undefined;
  if (!correct) {
    const engine = getReviewEngine();
    const [best] = await engine.analyze(fen, 1, 14);
    const mates = new Chess(played.line.fens[ply + 1]).isCheckmate();
    const [after] = mates ? [] : await engine.analyze(played.line.fens[ply + 1], 1, 13);
    evals = { before: toCp(best, "white"), after: mates ? (drill.color === "white" ? 9999 : -9999) : toCp(after, "white") };
    const loss = lossFromEvals(evals.before, evals.after, drill.color);
    correct = mates || loss < TOLERANCE || toCp(after, drill.color) >= 9000;
    bestUci = best?.pv[0] ?? answer;
  }
  const bestSan = bestUci
    ? new Chess(fen).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san
    : answerSan;
  const shapes = bestUci && bestUci !== uci ? [{ orig: bestUci.slice(0, 2) as Key, dest: bestUci.slice(2, 4) as Key, brush: "green" }] : [];
  useDrill.setState({ shapes });
  if (!correct && bestUci) explainWrong(fen, uci, bestUci, evals);
  finish(
    correct,
    played.san,
    correct
      ? uci === answer || !answerSan || played.san === bestSan
        ? `${played.san} is the engine's choice.`
        : `${played.san} works too (the engine's first choice is ${bestSan}).`
      : `${played.san} isn't it. The better move is ${bestSan}.`,
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

/** Step back through the moves so far (the lead-in move included) and forward again. */
export function drillStep(delta: Step) {
  const s = useDrill.getState();
  if (!s?.line) return;
  useDrill.setState({ view: stepView(s.line.sans.length, s.view, delta) });
}

/**
 * The title shown for a drill. Older mistake drills were saved as "Move 14.: you played Qa1";
 * they read as "In your game: 14.Qa1".
 */
export function drillTitle(d: Drill): string {
  const old = d.title.match(/^Move (\d+)(\.{1,3}): you played (\S+)$/);
  return old ? `In your game: ${old[1]}${old[2]}${old[3]}` : d.title;
}

/** What the coach sees for "Ask the coach" from a drill. */
export function drillContext(): { title: string; fen: string } | null {
  const s = useDrill.getState();
  const drill = current();
  if (!s?.line || !drill) return null;
  return { title: drillTitle(drill), fen: s.line.fens[viewedPly(s.line.sans.length, s.view)] };
}

export function drillQuestion(): string {
  const s = useDrill.getState()!;
  const drill = current()!;
  const line = s.line!;
  const start = drill.fen;
  const moves = line.sans.slice(s.base).join(" ");
  if (drill.kind === "puzzle") {
    return `I missed this puzzle again (FEN ${start}, I play ${drill.color}). The solution is ${drill.line.join(" ")}. What's the idea? Keep it short.`;
  }
  if (drill.kind === "opening") {
    return `In my repertoire drill "${drill.title}" (line: ${drill.line.join(" ")}), I played ${moves}. ${s.message} Why is the repertoire move better here? Keep it short.`;
  }
  const lead = s.lead ? ` after my opponent's ${s.lead.label}` : "";
  return (
    `Drill position (FEN ${start}, ${drill.color} to move${lead}): I played ${line.sans[s.base]}. ${s.message} ` +
    `Why is my move bad (what does it allow?), and what is the idea behind the better move? Show it on the board. Keep it short.`
  );
}
