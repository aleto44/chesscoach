// A study run through an opening course, on the opening trainer's board (useOpening with `course`
// set): one decision at a time, each from its own position, so the student practises the moments
// that matter instead of replaying the first moves of every line. A decision is either taught (the
// card and the answer's arrow up front, the student plays it) or asked from memory (Hint gives what
// White is up to first, then the arrow). A wrong move that players really make there (a pitfall) is
// punished on the board, so the student sees what it costs. The first answer to each decision is
// graded into the course progress (progress.ts); a missed one comes back at the end of the run.
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { buildLine, emptyLine, playAt, type Line } from "../chess/line";
import { useOpening } from "./session";
import { courseById, fenOf, nodeById, pitfallFor, pitfallShare, type StudyItem } from "./course";
import type { CourseNode } from "./courseTypes";
import { grade, markLearned, testOut, type Pitfall } from "./progress";
import { CLOSE, compareMoves } from "./explain";
import { settingRating, useSettings } from "../settings";
import { START_RATING } from "../rating";
import { stopPuzzles } from "../puzzles/session";
import { stopDrills } from "../analysis/drillSession";
import { stopGuess } from "../guess/session";
import { stopPlans } from "../plans/session";
import { stopEndgame } from "../endgames/session";
import { clearTrainerChat } from "../coach/trainerChat";
import { markSeen, type TrainingLine } from "./training";
import { clearCue, cue } from "../puzzles/fx";
import { ensureMemo, memoOf } from "./courseMemo";

export interface CourseRun {
  courseId: string;
  items: StudyItem[];
  index: number;
  /** How the current decision went at the first try (graded then); null until answered. */
  first: "right" | "hinted" | "wrong" | null;
  /**
   * 0: nothing asked; 1: what White is up to shown; then, for a decision with the coach's closer look
   * (courseMemo.ts), 2: what to look for; last, the answer's arrow (2, or 3 with the closer look).
   */
  hints: number;
  /** The pitfall the student walked into, being played out on the board. */
  caught: { san: string; share: number; eval: number; answerEval: number; watch?: string } | null;
  /** A move the course also accepts (or the engine rates as good), played instead of its answer. */
  other: string | null;
  /** The engine on the student's wrong move and the answer, the student's view. */
  evals: { played: number; answer: number } | null;
  tally: { right: number; wrong: number };
  /** The run is over: the summary shows. */
  over: boolean;
  /** A right answer moves on by itself at this time (ms since the epoch), like a solved puzzle; null when it waits for Next. */
  autoNextAt?: number | null;
}

const get = () => useOpening.getState();
const set = (patch: Partial<NonNullable<ReturnType<typeof get>>>) => useOpening.setState(patch);

/** A pause before the opponent's move, so it doesn't land on top of the student's. */
const REPLY_MS = 450;
/** Between the moves of a pitfall's punishment, played out for the student to watch. */
const SHOW_MS = 700;
/** A right answer moves on by itself after this long; a taught one a little later, to take in the card. */
export const COURSE_NEXT_MS = 900;
export const LEARN_NEXT_MS = 1500;

const studentRating = () => settingRating(useSettings.getState(), "rapid") ?? START_RATING;

export const runOf = () => get()?.course ?? null;

export function courseNode(run: CourseRun): CourseNode | null {
  const course = courseById(run.courseId);
  const item = run.items[run.index];
  return course && item ? nodeById(course, item.id) : null;
}

const pathOf = (node: CourseNode) => node.path.split(" ");
/** The moves the decision plays from its position: the answer, then the point played out. */
const movesOf = (node: CourseNode) => [node.answer, ...(node.cont ? node.cont.split(" ") : [])];
const bare = (san: string) => san.replace(/[+#!?]/g, "");

/** Starts a run (the opening trainer's board, with other trainers stopped). */
export function startCourse(courseId: string, items: StudyItem[]) {
  const course = courseById(courseId);
  if (!course || !items.length) return;
  stopPuzzles();
  stopDrills();
  stopGuess();
  stopPlans();
  stopEndgame();
  clearTrainerChat();
  const run: CourseRun = { courseId, items, index: 0, first: null, hints: 0, caught: null, other: null, evals: null, tally: { right: 0, wrong: 0 }, over: false };
  load(run);
}

/** Puts the run's current decision on the board (`keep`: as already answered, when it's put back after a reload). */
function load(run: CourseRun, keep = false) {
  const course = courseById(run.courseId)!;
  const node = courseNode(run)!;
  const built = buildLine(emptyLine().startFen, pathOf(node));
  const line = "line" in built ? built.line : emptyLine();
  const target: TrainingLine = { eco: "", name: node.title, moves: [...pathOf(node), ...movesOf(node)], weight: 1, start: line.sans.length };
  markSeen(target);
  // Missed often enough (on this device or another) and no closer look yet: the coach writes it now.
  if (!run.items[run.index].learn) void ensureMemo(course, node);
  useOpening.setState(
    {
      setId: course.setId,
      target,
      line,
      status: "playing",
      message: "",
      shapes: [],
      view: null,
      why: null,
      trapAt: null,
      blunder: null,
      detour: null,
      course: keep
        ? { ...run, caught: null, evals: null, autoNextAt: null }
        : { ...run, first: null, hints: 0, caught: null, other: null, evals: null, autoNextAt: null },
    },
    true,
  );
}

/**
 * Restores a run saved by keepSession (session.ts) as it was; one caught in the middle of a move (the
 * opponent's reply, the engine's verdict) goes back to the start of its decision, keeping its grade.
 */
export function resumeCourse(saved: NonNullable<ReturnType<typeof get>>) {
  const run = saved.course!;
  if (!courseById(run.courseId) || !courseNode(run)) return useOpening.setState(null, true);
  if (saved.status !== "thinking") return useOpening.setState(saved, true);
  load(run, true);
}

/** Whether this item teaches (shows the answer first). */
export const learning = (run: CourseRun) => !!run.items[run.index]?.learn;

function uciOf(fen: string, san: string): { from: Key; to: Key; promotion?: string } | null {
  try {
    const m = new Chess(fen).move(san);
    return { from: m.from as Key, to: m.to as Key, promotion: m.promotion };
  } catch {
    return null;
  }
}

const arrowTo = (fen: string, san: string) => {
  const m = uciOf(fen, san);
  return m ? [{ orig: m.from, dest: m.to, brush: "green" }] : [];
};

/** Plays `san` on the line (for either side); null if it isn't legal there. */
function playSan(line: Line, san: string): Line | null {
  const ply = line.sans.length;
  const m = uciOf(line.fens[ply], san);
  return m ? (playAt(line, ply, m.from, m.to, m.promotion)?.line ?? null) : null;
}

/** "9.Nd5" / "9...Nxd5": numbered, so the trainer's text can be hovered against the moves on the board. */
export function numbered(line: Line, from: number, count: number): string {
  return line.sans
    .slice(from, from + count)
    .map((san, i) => {
      const ply = from + i;
      const n = Math.floor(ply / 2) + 1;
      return ply % 2 === 0 ? `${n}.${san}` : i === 0 ? `${n}...${san}` : san;
    })
    .join(" ");
}

/** The student's move on the course board. */
export async function courseMove(from: Key, to: Key, promotion?: string) {
  const s = get();
  const run = s?.course;
  if (!s || !run || s.status !== "playing" || s.view !== null) return;
  const node = courseNode(run);
  if (!node) return;
  const ply = s.line.sans.length;
  const fen = s.line.fens[ply];
  const played = playAt(s.line, ply, from, to, promotion);
  if (!played) return;
  const k = ply - pathOf(node).length;
  const expected = movesOf(node)[k];
  const line = played.line;
  if (expected && bare(played.san) === bare(expected)) return onTrack(node, line);

  // Taught: the move to play is on the board; anything else goes back with a nudge.
  if (learning(run)) {
    set({ line, status: "thinking", shapes: [] });
    window.setTimeout(() => {
      if (get()?.line !== line) return;
      set({ line: s.line, status: "playing", message: `Play the course's move here: ${expected}. You'll be asked it from memory in a moment.`, shapes: arrowTo(fen, expected) });
    }, REPLY_MS);
    return;
  }

  // The first move: one the course also accepts, or one players really make that loses.
  if (k === 0) {
    if ((node.also ?? []).some((m) => bare(m) === bare(played.san))) return finish(line, "right", played.san);
    const pit = pitfallFor(node, played.san);
    if (pit) return caught(node, line, played.san, pit);
  }

  // Anything else: the engine decides whether it's as good as the course's move.
  set({ line, status: "thinking", message: "", shapes: [] });
  let evals: { played: number; answer: number } | null = null;
  try {
    const e = await compareMoves(fen, played.san, expected, useCourseColor());
    evals = { played: e.played, answer: e.book };
  } catch (e) {
    console.error("course move check failed", e);
  }
  if (get()?.line !== line) return;
  // As good by the engine, but not the course's move: no step forward, so the course's move comes back soon.
  if (!evals || evals.answer - evals.played <= CLOSE) return finish(line, "hinted", played.san);
  miss(line, fen, expected, played.san, evals);
}

const useCourseColor = () => courseById(runOf()!.courseId)!.color;

/** The expected move: on to the opponent's next move of the point, or the decision is done. */
function onTrack(node: CourseNode, line: Line) {
  const run = runOf()!;
  const k = line.sans.length - pathOf(node).length;
  const moves = movesOf(node);
  if (k >= moves.length) return finish(line, run.first === null && run.hints > 0 ? "hinted" : "right", null);
  set({ line, status: "thinking", message: k === 1 && moves.length > 1 ? `${moves[0]}, right.` : "", shapes: [] });
  window.setTimeout(() => {
    const now = get();
    if (!now || now.line !== line) return;
    const next = playSan(line, moves[k]);
    if (!next) return finish(line, "right", null);
    const after = next.sans.length - pathOf(node).length;
    if (after >= moves.length) return finish(next, run.hints > 0 ? "hinted" : "right", null);
    const learnArrow = learning(run) ? arrowTo(next.fens[next.sans.length], moves[after]) : [];
    set({ line: next, status: "playing", shapes: learnArrow });
  }, REPLY_MS);
}

/** Grades the first answer of a decision once, and counts it for the run. */
function settle(result: "right" | "hinted" | "wrong", played?: string) {
  const s = get()!;
  const run = s.course!;
  if (run.first !== null) return run;
  const id = run.items[run.index].id;
  if (learning(run)) {
    markLearned(id);
    return { ...run, first: result };
  }
  const probe = !!run.items[run.index].probe;
  if (probe && result === "right") testOut(id);
  else grade(id, result, played);
  // Another miss may be the one that calls for the coach's closer look: written while the student reads the card.
  if (result === "wrong") void ensureMemo(courseById(run.courseId)!, courseNode(run)!);
  const tally = { right: run.tally.right + (result === "wrong" ? 0 : 1), wrong: run.tally.wrong + (result === "wrong" ? 1 : 0) };
  // A miss comes back at the end of the run, once.
  // A test-out that needed a hint comes back too: it isn't known yet.
  const again = (result === "wrong" || (probe && result === "hinted")) && !run.items.slice(run.index + 1).some((it) => it.id === id) ? [{ id, learn: false }] : [];
  return { ...run, first: result, tally, items: [...run.items, ...again] };
}

/**
 * The decision is answered. Right at the first try (or taught): the puzzles' cue (a ✓ on the square,
 * the frame lighting up, the sound) and on to the next one by itself, unless the student steps
 * through the moves meanwhile or presses Next. Anything else waits for Next, so the card gets read.
 */
function finish(line: Line, result: "right" | "hinted" | "wrong", other: string | null) {
  const run = settle(result);
  const clean = run.first === "right" && !other;
  const wait = learning(run) ? LEARN_NEXT_MS : COURSE_NEXT_MS;
  const autoNextAt = clean ? Date.now() + wait : null;
  set({ line, status: "done", message: "", shapes: [], course: { ...run, other, autoNextAt } });
  const ply = line.sans.length;
  const mine = studentMoved(line);
  if (mine) cue(clean ? "solved" : "correct", mine, line.fens[ply]);
  if (!autoNextAt) return;
  window.setTimeout(() => {
    const now = get();
    if (now?.line === line && now.status === "done" && now.view === null && now.course?.autoNextAt === autoNextAt) courseNext();
  }, wait);
}

/** The square of the student's latest move, if the latest move on the line is theirs. */
function studentMoved(line: Line): Key | null {
  const ply = line.sans.length;
  const color = courseById(runOf()!.courseId)!.color;
  const moverWhite = ply % 2 === 1;
  return ply > 0 && moverWhite === (color === "white") ? line.lastMoves[ply - 1][1] : null;
}

/** Stops a right answer from moving on by itself (the student wants to look). */
export function holdCourse() {
  const run = runOf();
  if (run?.autoNextAt) set({ course: { ...run, autoNextAt: null } });
}

function miss(line: Line, fen: string, expected: string, played: string, evals: { played: number; answer: number }) {
  const run = settle("wrong", played);
  const mine = studentMoved(line);
  if (mine) cue("wrong", mine, line.fens[line.sans.length]);
  set({ line, status: "off", message: "", shapes: arrowTo(fen, expected), course: { ...run, evals, other: played } });
}

/** The student walked into a pitfall: its punishment is played out on the board, move by move. */
function caught(node: CourseNode, line: Line, san: string, pit: Pitfall) {
  const run = settle("wrong", san);
  const mine = studentMoved(line);
  if (mine) cue("wrong", mine, line.fens[line.sans.length]);
  const watch = node.watch && bare(node.watch.move) === bare(san) ? node.watch.text : undefined;
  set({
    line,
    status: "thinking",
    message: "",
    shapes: [],
    course: { ...run, caught: { san, share: pitfallShare(pit, studentRating()), eval: pit.eval, answerEval: pit.answerEval, watch } },
  });
  let at = line;
  pit.refute.forEach((m, i) =>
    window.setTimeout(() => {
      if (get()?.line !== at) return;
      const next = playSan(at, m);
      if (!next) return set({ status: "off" });
      at = next;
      set({ line: next, status: i === pit.refute.length - 1 ? "off" : "thinking" });
    }, SHOW_MS * (i + 1)),
  );
  if (!pit.refute.length) set({ status: "off" });
}

/** How many presses Hint has for the decision: what White is up to, the closer look if there is one, then the arrow. */
export const hintSteps = (run: CourseRun) => (memoOf(run.items[run.index]?.id ?? "") ? 3 : 2);

/** Hint: first what White's last move is about, then (for a decision often missed) what to look for, then the answer's arrow. */
export function courseHint() {
  const s = get();
  const run = s?.course;
  if (!s || !run || s.status !== "playing") return;
  const node = courseNode(run)!;
  const k = s.line.sans.length - pathOf(node).length;
  const steps = hintSteps(run);
  const hints = Math.min(steps, run.hints + 1);
  // The closer look's drawings are added by the panel (CoursePanel), from the memo itself.
  set({
    course: { ...run, hints },
    shapes: hints >= steps || k > 0 ? arrowTo(s.line.fens[s.line.sans.length], movesOf(node)[k]) : [],
  });
}

/** Back to the decision's position to find the move again (the grade stays as it was). */
export function courseRetry() {
  const s = get();
  const run = s?.course;
  if (!s || !run) return;
  const node = courseNode(run)!;
  const built = buildLine(emptyLine().startFen, pathOf(node));
  if (!("line" in built)) return;
  clearCue();
  set({ line: built.line, status: "playing", message: "", shapes: [], view: null, course: { ...run, caught: null, other: null, evals: null } });
}

/** On to the next decision, or the summary after the last. */
export function courseNext() {
  const run = runOf();
  if (!run) return;
  clearCue();
  if (run.index + 1 >= run.items.length) return set({ status: "done", course: { ...run, over: true } });
  load({ ...run, index: run.index + 1 });
}

/** What the coach sees about the decision on the board. */
export function courseContext(run: CourseRun): string {
  const node = courseNode(run);
  if (!node) return "";
  const shown = learning(run) || get()?.status !== "playing";
  return `; this is the opening course, decision "${node.title}" (${run.index + 1} of ${run.items.length}, ${learning(run) ? "being taught" : "asked from memory"})${
    shown ? `; the course's move here is ${node.answer}: ${node.why}` : "; the student is finding the move: don't give it away"
  }`;
}

/** The decision's position, for texts that speak from it. */
export const courseFen = (run: CourseRun) => {
  const node = courseNode(run);
  return node ? fenOf(node) : null;
};

