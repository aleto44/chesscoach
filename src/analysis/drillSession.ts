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
import { dueDrills, gradeDrill, lostAnyway, retireDrill, type Drill } from "./drills";
import { explainCached, type Explanation } from "./explain";
import { unpackLesson } from "./lesson";
import { lossFromEvals } from "./review";
import { stopEndgame } from "../endgames/session";
import { stopGuess } from "../guess/session";
import { stopPlans } from "../plans/session";
import { stopOpening } from "../openings/session";
import { PIECE_NAMES, type PieceType } from "../chess/material";
import type { Color } from "../store";

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

/** Which drills a session works through: the due ones or all, optionally one review tag's. */
export interface DrillSource {
  all: boolean;
  tag: string | null;
}

export interface DrillState {
  source: DrillSource;
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
  shapes: { orig: Key; dest?: Key; brush: string }[];
  startedAt: number;
  /** Next review date of the drill just graded. */
  nextDue: string | null;
  correct: number;
  /** After a wrong answer: what the move allows and what the better move does (null while it's worked out). */
  why: Explanation | null;
  whyFailed: boolean;
  /** The hint, once asked for ("Move your knight on c5."): the drill then counts as missed. */
  hint: string | null;
  /** After a wrong answer whose better move wins by what it attacks: the student finds those pieces. */
  quiz?: AttackQuiz | null;
}

/**
 * "Ne5: what does it attack?" The better move is shown played, and the student taps the pieces it
 * attacks. Finding the fork on the board sticks better than reading about it.
 */
export interface AttackQuiz {
  san: string;
  /** The position after the better move. */
  fen: string;
  lastMove: [Key, Key];
  targets: Key[];
  found: Key[];
  /** The last tap that wasn't one of them. */
  miss: Key | null;
  /** "found": the student found them all; "shown": they asked to see them. */
  done: "found" | "shown" | null;
}

export const useDrill = create<DrillState | null>(() => null);

/**
 * The session is kept in localStorage so a reload picks up the same drill where the student left
 * it: a phone drops the page when the student switches apps for a while.
 */
const SAVE_KEY = "cc-drill";

/** Restores the last session (if any) and keeps saving it. Call once at startup. */
export function initDrillSession() {
  let saved: DrillState | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
  } catch {
    saved = null;
  }
  useDrill.subscribe((s) => {
    try {
      if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      else localStorage.removeItem(SAVE_KEY);
    } catch {
      // Private mode or full storage: the session just won't survive a reload.
    }
  });
  if (saved && Array.isArray(saved.queue)) resume(saved);
}

/** Picks a saved session back up, redoing whatever was in flight when the page went away. */
function resume(saved: DrillState) {
  const source = saved.source ?? { all: false, tag: null };
  useDrill.setState({ ...saved, source }, true);
  const line = saved.line;
  if (saved.status === "loading" || saved.status === "intro" || !line) {
    // Loading with a line on the board: on the way to the next drill (this one is graded).
    const at = saved.status === "loading" && line ? saved.index + 1 : saved.index;
    // Before the drill's position was shown (or while the queue loaded): open it again.
    if (saved.queue.length) begin(at);
    else if (saved.status === "loading") startDrills(source.all, source.tag);
    return;
  }
  const drill = saved.queue[saved.index];
  if (saved.status === "solving") return autoplay();
  if (saved.status === "checking") {
    // The engine was grading the answer and the grade never got saved: take the move back to replay it.
    const back = line.sans.length - 1;
    useDrill.setState({
      status: "solving",
      shapes: [],
      line: { ...line, sans: line.sans.slice(0, back), fens: line.fens.slice(0, back + 1), lastMoves: line.lastMoves.slice(0, back), notes: line.notes.slice(0, back) },
    });
    return;
  }
  if (saved.status === "right" && !saved.why && !saved.whyFailed && drill) {
    // The reasons the game move was worse were still being worked out: work them out again.
    const ply = line.sans.length - 1;
    if (ply >= 0) explainRight(line.fens[ply], drill, uciOf(line.fens[ply], line.sans[ply]));
  }
  if (saved.status === "wrong" && !saved.why && !saved.whyFailed && drill && drill.kind !== "opening") {
    // The reasons for a wrong answer were still being worked out: work them out again.
    const ply = line.sans.length - 1;
    const best = saved.shapes.find((sh) => sh.brush === "green" && sh.dest);
    if (ply >= 0 && best) {
      const fen = line.fens[ply];
      const bestMove = new Chess(fen).moves({ verbose: true }).find((m) => m.from === best.orig && m.to === best.dest);
      if (bestMove) explainWrong(fen, uciOf(fen, line.sans[ply]), bestMove.from + bestMove.to + (bestMove.promotion ?? ""), undefined, true);
    }
  }
}

/** The move the student played in the game a mistake drill comes from ("a6"), from its title. */
export function gameMoveSan(d: Drill): string | null {
  return d.kind === "mistake" ? (drillTitle(d).match(/^In your game: \d+\.+(\S+)$/)?.[1] ?? null) : null;
}

/**
 * After a right answer to a mistake drill: why the game's move was worse than the one just found.
 * "The engine's choice" alone teaches nothing; this says what the game move allowed and what the
 * answer does instead.
 */
function explainRight(fen: string, drill: Drill, uci: string) {
  const lesson = lessonOf(drill);
  if (lesson) {
    // Worked out when the drill was made: what the game move did wrong and what the answer does.
    useDrill.setState({ why: lesson });
    return;
  }
  const san = gameMoveSan(drill);
  if (!san) return;
  let game: string;
  try {
    game = uciOf(fen, san);
  } catch {
    return;
  }
  if (game !== uci) explainWrong(fen, game, uci);
}

type Lesson = NonNullable<ReturnType<typeof unpackLesson>>;
const lessons = new Map<string, Lesson | null>();

/** A mistake drill's stored lesson (see lesson.ts), unpacked once. */
export function lessonOf(d: Drill | undefined): Lesson | null {
  if (!d || d.kind !== "mistake" || !d.lesson) return null;
  const key = `${d.id}|${d.lesson.length}`;
  if (!lessons.has(key)) lessons.set(key, unpackLesson(d.lesson));
  return lessons.get(key) ?? null;
}

/**
 * Why a wrong answer that isn't the game move is bad (worked out now), with the better move's part
 * from the drill's lesson, so it reads the same at every attempt.
 */
function withLesson(live: Explanation, lesson: Lesson): Explanation {
  return {
    ...live,
    better: lesson.better,
    alternatives: lesson.alternatives,
    standout: lesson.standout,
    // The lesson's summary compares with the game move's chances; this answer had its own.
    betterSummary: lesson.betterSummary.replace(/, against \d+% after the move you played/, ""),
    attack: lesson.attack,
  };
}

const current = () => {
  const s = useDrill.getState();
  return s && s.queue[s.index];
};

function emptyAt(fen: string): Line {
  return { startFen: fen, sans: [], fens: [fen], lastMoves: [], notes: [] };
}

/**
 * Leaving the drills (back, the menu, another trainer) parks the session, one per source, until
 * its queue is done; starting the same drills again picks it back up where it was.
 */
const PARK_KEY = "cc-drill-parked";
type Parked = Record<string, DrillState & { parkedAt: number }>;
const sourceKey = (s: DrillSource) => `${s.all ? "all" : "due"}${s.tag ? `:${s.tag}` : ""}`;
function readParked(): Parked {
  try {
    return JSON.parse(localStorage.getItem(PARK_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
export const useParkedDrills = create<Parked>(readParked);
useParkedDrills.subscribe((p) => {
  try {
    if (Object.keys(p).length) localStorage.setItem(PARK_KEY, JSON.stringify(p));
    else localStorage.removeItem(PARK_KEY);
  } catch {
    // Private mode: parked only until a reload.
  }
});

/** The parked session for these drills, if any (for the menu). */
export const parkedFor = (p: Parked, all = false, tag: string | null = null) => p[sourceKey({ all, tag })] ?? null;

function park(s: DrillState | null) {
  if (!s?.source) return;
  const next = { ...useParkedDrills.getState() };
  const key = sourceKey(s.source);
  if (s.queue.length && s.status !== "done") next[key] = { ...s, parkedAt: Date.now() };
  else delete next[key];
  useParkedDrills.setState(next, true);
}

function unpark(source: DrillSource): DrillState | null {
  const all = { ...useParkedDrills.getState() };
  const key = sourceKey(source);
  const p = all[key];
  if (!p) return null;
  delete all[key];
  useParkedDrills.setState(all, true);
  const { parkedAt, ...s } = p;
  // The time away doesn't count as time spent on the drill.
  return { ...s, startedAt: s.startedAt + Math.max(0, Date.now() - parkedAt) };
}

const blank = (queue: Drill[], source: DrillSource): DrillState => ({
  source,
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
  hint: null,
  quiz: null,
});

/** `tag`: drill the mistakes with that review tag (the weakness dashboard), due or not. */
export async function startDrills(all = false, tag: string | null = null) {
  stopEndgame();
  stopOpening();
  stopGuess();
  stopPlans();
  park(useDrill.getState());
  const source = { all, tag };
  const parked = unpark(source);
  if (parked) return resume(parked);
  useDrill.setState(blank([], source), true);
  const queue = await dueDrills(30, all, tag);
  if (!useDrill.getState()) return;
  useDrill.setState({ ...blank(queue, source), status: queue.length ? "loading" : "done" }, true);
  if (queue.length) begin(0);
}

/** Leaves the drills; an unfinished session is parked for later (see park). */
export function stopDrills() {
  park(useDrill.getState());
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

/**
 * A mistake drill from a position that was lost whatever the student played (made before such
 * positions were left out, see addMistakeDrills): its game's saved analysis says so.
 */
async function lostDrill(drill: Drill): Promise<boolean> {
  if (drill.kind !== "mistake" || drill.sourceGameId === null) return false;
  const rec = await db.loadGame(drill.sourceGameId);
  const i = rec?.moves.findIndex((m) => sameSpot(m.fenBefore, drill.fen)) ?? -1;
  if (!rec || i < 0) return false;
  return lostAnyway(rec.moves[i].analysis?.evalBefore ?? rec.moves[i - 1]?.analysis?.evalAfter, drill.color);
}

async function begin(index: number) {
  const s = useDrill.getState()!;
  const drill = s.queue[index];
  if (!drill) {
    useDrill.setState({ index, status: "done", line: null, lead: null, base: 0, shapes: [], message: "", why: null, quiz: null });
    return;
  }
  // Nothing to find in a lost position: retire the drill and go on to the next one.
  if (await lostDrill(drill).catch(() => false)) {
    await retireDrill(drill.id).catch((e) => console.warn("could not retire a lost-position drill", e));
    if (useDrill.getState()?.queue === s.queue) begin(index + 1);
    return;
  }
  let lead: LeadIn | null = null;
  try {
    lead = await leadIn(drill);
  } catch (e) {
    console.warn("no lead-in for the drill", e);
  }
  if (useDrill.getState()?.queue !== s.queue) return;
  const reset = { index, view: null, message: "", shapes: [], nextDue: null, why: null, whyFailed: false, hint: null, quiz: null };
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
async function explainWrong(fen: string, uci: string, bestUci: string, evals?: { before: number; after: number }, quiz = false) {
  const index = useDrill.getState()?.index;
  const still = () => useDrill.getState()?.index === index;
  const lesson = lessonOf(current() ?? undefined);
  const known = lesson && lesson.bestUci === bestUci ? lesson : null;
  const offerQuiz = (why: Explanation) => {
    const a = why.attack;
    // Only for the move the drill shows as the answer (the green arrow), and only on a miss (`quiz`;
    // with a stored lesson this runs before the miss is recorded, so the status can't tell).
    const ask = quiz && a && a.from + a.to === bestUci.slice(0, 4);
    useDrill.setState({
      why,
      ...(ask ? { quiz: { san: a.san, fen: a.fen, lastMove: [a.from, a.to] as [Key, Key], targets: a.targets, found: [], miss: null, done: null } } : {}),
    });
  };
  // The game move again: the lesson already says why it's bad.
  if (known && uci === known.gameUci) return offerQuiz(known);
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
    const live = await explainCached({ fenBefore: fen, uci, bestUci, evalBefore: e.before, evalAfter: e.after });
    if (!still()) return;
    offerQuiz(known ? withLesson(live, known) : live);
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
      useDrill.setState({ shapes: [] });
      autoplay();
      return;
    }
    if (drill.kind === "puzzle" && new Chess(played.line.fens[ply + 1]).isCheckmate()) {
      return finish(true, played.san, "Solved.");
    }
    const exp = new Chess(fen).move(expected);
    useDrill.setState({ shapes: [{ orig: exp.from as Key, dest: exp.to as Key, brush: "green" }] });
    // A repertoire move isn't always the engine's, so only puzzle misses get the engine's reasons.
    if (drill.kind === "puzzle") explainWrong(fen, uci, uciOf(fen, expected), undefined, true);
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
    // A drill with a lesson teaches its own answer; others show the engine's choice now.
    bestUci = lessonOf(drill) && answer ? answer : (best?.pv[0] ?? answer);
  }
  const bestSan = bestUci
    ? new Chess(fen).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san
    : answerSan;
  const shapes = bestUci && bestUci !== uci ? [{ orig: bestUci.slice(0, 2) as Key, dest: bestUci.slice(2, 4) as Key, brush: "green" }] : [];
  useDrill.setState({ shapes });
  if (!correct && bestUci) explainWrong(fen, uci, bestUci, evals, true);
  else if (correct) explainRight(fen, drill, uci);
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
  // A right answer after a hint still shows as right, but is graded (and scheduled) as a miss.
  const counts = correct && !s.hint;
  useDrill.setState({ status: correct ? "right" : "wrong", message, correct: s.correct + (counts ? 1 : 0) });
  try {
    const nextDue = await gradeDrill(drill.id, counts, played, Date.now() - s.startedAt);
    if (useDrill.getState()?.index === s.index) useDrill.setState({ nextDue });
  } catch (e) {
    console.error("grading failed", e);
  }
}

/**
 * Circles the piece to move (the line's next move, or the drill's answer) and says what went wrong
 * last time. Taking it counts the drill as missed, even if the move is then found.
 */
export function drillHint() {
  const s = useDrill.getState();
  const drill = current();
  if (!s?.line || !drill || s.status !== "solving" || s.view !== null) return;
  const ply = s.line.sans.length;
  const fen = s.line.fens[ply];
  if (sideToMove(fen) !== drill.color) return;
  let from: Key | null = null;
  let piece = "";
  try {
    const next = followsLine(drill) ? drill.line[ply - s.base] : null;
    const m = next
      ? new Chess(fen).move(next)
      : drill.answerUci
        ? new Chess(fen).move({ from: drill.answerUci.slice(0, 2), to: drill.answerUci.slice(2, 4), promotion: drill.answerUci[4] })
        : null;
    if (m) [from, piece] = [m.from as Key, m.piece === "k" ? "king" : PIECE_NAMES[m.piece as PieceType]];
  } catch {
    from = null;
  }
  if (!from) return;
  const last = drill.kind === "mistake" && drill.note ? ` Last time: ${drill.note.replace(/-/g, " ")}.` : "";
  const theme = drill.kind === "puzzle" && drill.note ? ` Theme: ${drill.note}.` : "";
  useDrill.setState({ hint: `Move your ${piece} on ${from}.${last}${theme} This drill counts as missed.`, shapes: [{ orig: from, brush: "green" }] });
}

/** A tap on the attack quiz's board: one of the attacked pieces, or a miss. */
export function quizTap(key: Key) {
  const q = useDrill.getState()?.quiz;
  if (!q || q.done) return;
  if (!q.targets.includes(key)) return useDrill.setState({ quiz: { ...q, miss: key } });
  const found = q.found.includes(key) ? q.found : [...q.found, key];
  useDrill.setState({ quiz: { ...q, found, miss: null, done: found.length === q.targets.length ? "found" : null } });
}

/** Gives up on the attack quiz: the pieces are shown. */
export function quizReveal() {
  const q = useDrill.getState()?.quiz;
  if (q && !q.done) useDrill.setState({ quiz: { ...q, done: "shown" } });
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

/**
 * What the coach sees for a question asked during a drill. The board on screen is often past the
 * drill's position (after the student's attempt), so the start position, the student's side and
 * what the drill asks are spelled out: without them the coach took the position after the game's
 * mistake for the puzzle and coached the opponent's side.
 */
export function drillContext(): {
  title: string;
  /** The position on screen. */
  fen: string;
  /** The drill's position, where the student is to move. */
  startFen: string;
  color: Color;
  /** What the drill asks, in words. */
  asks: string;
  /** The student's attempt in this session and how it was graded, if they've moved. */
  attempt: string | null;
  /** Whether the student has answered, so the answer may be discussed. */
  answered: boolean;
} | null {
  const s = useDrill.getState();
  const drill = current();
  if (!s?.line || !drill) return null;
  const startFen = s.line.fens[s.base] ?? drill.fen;
  const side = drill.color === "white" ? "White" : "Black";
  const title = drillTitle(drill);
  const lead = s.lead ? ` (the opponent's ${s.lead.label} came just before)` : "";
  const asks =
    drill.kind === "mistake"
      ? `In the game the student (${side}) played ${title.replace(/^In your game: /, "")} from this position${lead}, a mistake; the drill asks for a better ${side} move here.`
      : drill.kind === "puzzle"
        ? `A Lichess puzzle the student (${side}) missed${lead}; the drill asks for ${side}'s solution.`
        : drill.kind === "opening"
          ? `A repertoire drill for ${side}${lead}: the drill asks for the repertoire move.`
          : `A position the coach asked about before${lead}: the drill asks for ${side}'s best move.`;
  const answered = s.status === "right" || s.status === "wrong";
  const tried = s.line.sans[s.base];
  const attempt = tried ? `The student played ${tried} in the drill${answered ? `: ${s.status}. ${s.message}` : "."}`.trim() : null;
  return { title, fen: s.line.fens[viewedPly(s.line.sans.length, s.view)], startFen, color: drill.color, asks, attempt, answered };
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
