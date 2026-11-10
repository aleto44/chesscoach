// A puzzle session on the main board. Each puzzle opens on the position before the opponent's
// move, plays that move, then the student finds the rest of the line; the app plays the
// opponent's replies. Like Lichess, a wrong move counts the puzzle as failed but the student can
// keep trying, and any mating move counts when the line ends in mate. Misses become drills.
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { create } from "zustand";
import { addDrills } from "../analysis/drills";
import { stopDrills } from "../analysis/drillSession";
import { emptyLine, playAt, sideToMove, type Line } from "../chess/line";
import { stepView, viewedPly, type Step } from "../chess/view";
import type { Color } from "../store";
import { findPuzzles, recordAttempt, themeLabel, usePuzzleDb, type Puzzle, type ThemeGain } from "./puzzles";
import { fromLichess, toLichess } from "../rating";
import { stopEndgame } from "../endgames/session";
import { stopGuess } from "../guess/session";
import { stopOpening } from "../openings/session";
import { useSettings } from "../settings";
import { buzz, BUZZ_END, BUZZ_OPPONENT, celebrate, clearCue, cue } from "./fx";
import { tierOf } from "../components/Mastery";

const stopTrainers = () => (stopEndgame(), stopOpening(), stopGuess());

export type Difficulty = "easier" | "normal" | "harder";
const OFFSET: Record<Difficulty, number> = { easier: -250, normal: 0, harder: 250 };

export interface Choice {
  theme: string | null;
  opening: string | null;
  difficulty: Difficulty;
}

/**
 * "rated": at the student's puzzle rating, a little above or below, no filters. "custom": the
 * student's theme / opening / difficulty. "rush": unrated, three lives, each puzzle harder than
 * the last (rushRating). Coach sets have none.
 */
export type PuzzleMode = "rated" | "custom" | "rush";

export interface Rush {
  lives: number;
  /** The student ended the run before the lives ran out. */
  ended?: boolean;
  /** Puzzles solved this run. */
  score: number;
  /** The best run on this device, before this one. */
  best: number;
}

export const RUSH_LIVES = 3;

export interface PuzzleSession {
  /** Where the puzzles come from: the student's own choice, or a set the coach picked. */
  set: { title: string; fromCoach: boolean; mode?: PuzzleMode };
  /** A puzzle rush run (mode "rush"); null otherwise. */
  rush: Rush | null;
  choice: Choice;
  queue: Puzzle[];
  index: number;
  /** The puzzle's moves so far, from its start (before the opponent's move). */
  line: Line | null;
  /** The full solution in SAN, opponent's first move included. */
  solution: string[];
  color: Color;
  status: "loading" | "intro" | "solving" | "solved" | "failed" | "empty" | "error";
  /** A wrong move was played (the puzzle counts as failed, but the student may keep going). */
  missed: boolean;
  message: string;
  shapes: { orig: Key; dest: Key; brush: string }[];
  startedAt: number;
  /** After the first attempt is saved: the rating change (null when this try wasn't rated). */
  change: { before: number; after: number } | null;
  /** Ply the student stepped back to (null = the latest position). Moves are played at the latest only. */
  view: number | null;
  results: { id: string; correct: boolean; themes: string[]; rating: number }[];
  /** How the first try moved each of the puzzle's themes (XP and stars), when it was rated. */
  mastery: ThemeGain[] | null;
  /** When a solved puzzle goes on to the next by itself (ms timestamp); null = it waits. */
  autoNextAt: number | null;
}

/** How long a solve stays on screen before the next puzzle, with auto-advance on (the rating count-up fits in it). */
export const AUTO_NEXT_MS = 2400;

export const usePuzzle = create<PuzzleSession | null>(() => null);

/**
 * The session is kept in localStorage so a reload picks up the same puzzle where the student left
 * it: a phone drops the page when the student switches apps while thinking over a puzzle.
 */
const SAVE_KEY = "cc-puzzle";

/** Restores the last session (if any) and keeps saving it. Call once at startup. */
export function initPuzzleSession() {
  let saved: PuzzleSession | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
  } catch {
    saved = null;
  }
  usePuzzle.subscribe((s) => {
    try {
      if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      else localStorage.removeItem(SAVE_KEY);
    } catch {
      // Private mode or full storage: the session just won't survive a reload.
    }
  });
  if (saved?.set && Array.isArray(saved.queue)) resume(saved);
}

/** Picks a saved session back up, redoing whatever a timer was about to do when the page went away. */
function resume(saved: PuzzleSession) {
  // Saved by an older version (a different shape): dropped.
  const mastery = saved.mastery?.every((g) => typeof g.after?.xp === "number") ? saved.mastery : null;
  usePuzzle.setState({ ...saved, rush: saved.rush ?? null, mastery, autoNextAt: null }, true);
  // Loading with a line on the board: on the way to the next puzzle, this one already counted.
  const at = saved.status === "loading" && saved.line ? saved.index + 1 : saved.index;
  const puzzle = saved.queue[at];
  if (saved.status === "loading" || saved.status === "intro" || !saved.line) {
    // Mid-refill or before the opponent's first move: start this puzzle over (or reload the set).
    if (puzzle) begin(at);
    else if (saved.queue.length && !saved.set.fromCoach) continueAt(at);
    else if (saved.set.mode === "rush") startRush();
    else if (saved.set.mode === "rated") startRatedPuzzles();
    else if (!saved.set.fromCoach) startPuzzles(saved.choice);
    return;
  }
  if (saved.status !== "solving") return;
  const line = saved.line;
  const ply = line.sans.length;
  // A wrong move still on the board (it's taken back after a moment): take it back now.
  if (ply > 0 && line.sans[ply - 1] !== saved.solution[ply - 1]) {
    const back = ply - 1;
    set({
      line: { ...line, sans: line.sans.slice(0, back), fens: line.fens.slice(0, back + 1), lastMoves: line.lastMoves.slice(0, back), notes: line.notes.slice(0, back) },
      message: saved.message ? `${line.sans[back]} isn't it. Try again, or view the solution.` : "",
    });
  }
  // A rush miss whose solution was about to play out.
  if (saved.rush && saved.missed) return void showSolution();
  // The opponent's reply was due: play it.
  const now = get()!.line!;
  if (sideToMove(now.fens[now.sans.length]) !== saved.color && now.sans.length < saved.solution.length) autoplay();
}

/** Fetches more puzzles, then shows the one at `index` (a resumed session whose next one wasn't loaded yet). */
async function continueAt(index: number) {
  set({ status: "loading" });
  try {
    await refill();
  } catch (e) {
    console.error("could not load puzzles", e);
    set({ status: "error" });
    return;
  }
  begin(index);
}

/**
 * Leaving the puzzles (back, the menu, another trainer) doesn't lose the puzzle on the board: the
 * session is parked per mode until its puzzle is solved, missed or given up (a rush: until the run
 * is over), and starting that mode again picks it back up. Coach sets aren't parked.
 */
const PARK_KEY = "cc-puzzle-parked";
type Parked = Partial<Record<PuzzleMode, PuzzleSession & { parkedAt: number }>>;
function readParked(): Parked {
  try {
    return JSON.parse(localStorage.getItem(PARK_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
export const useParkedPuzzles = create<Parked>(readParked);
useParkedPuzzles.subscribe((p) => {
  try {
    if (Object.keys(p).length) localStorage.setItem(PARK_KEY, JSON.stringify(p));
    else localStorage.removeItem(PARK_KEY);
  } catch {
    // Private mode: parked only until a reload.
  }
});

/** A puzzle still to answer, or a rush with lives left. */
function unfinished(s: PuzzleSession): boolean {
  if (s.rush) return s.rush.lives > 0 && s.queue.length > 0 && s.status !== "error" && s.status !== "empty";
  return (s.status === "intro" || s.status === "solving") && !!s.queue[s.index];
}

function park(s: PuzzleSession | null) {
  const mode = s?.set.mode;
  if (!s || !mode || s.set.fromCoach) return;
  const next = { ...useParkedPuzzles.getState() };
  if (unfinished(s)) next[mode] = { ...s, autoNextAt: null, parkedAt: Date.now() };
  else delete next[mode];
  useParkedPuzzles.setState(next, true);
}

/** Takes a mode's parked session out of the parking (null if there's none). */
function unpark(mode: PuzzleMode): PuzzleSession | null {
  const all = { ...useParkedPuzzles.getState() };
  const p = all[mode];
  if (!p) return null;
  delete all[mode];
  useParkedPuzzles.setState(all, true);
  const { parkedAt, ...s } = p;
  // The time away doesn't count as time spent on the puzzle.
  return { ...s, startedAt: s.startedAt + Math.max(0, Date.now() - parkedAt) };
}

/** Puts a parked session back on the board. */
function reopen(saved: PuzzleSession) {
  park(get());
  stopDrills();
  stopTrainers();
  resume(saved);
}

const get = () => usePuzzle.getState();
const set = (patch: Partial<PuzzleSession>) => usePuzzle.setState(patch);
const current = () => {
  const s = get();
  return s?.queue[s.index] ?? null;
};

function uciMove(chess: Chess, uci: string) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

function toSan(fen: string, moves: string[]): string[] {
  const chess = new Chess(fen);
  return moves.map((m) => uciMove(chess, m).san);
}

/** The last difficulty the student picked: a new session starts on it, not back on "normal". */
const DIFFICULTY_KEY = "cc-puzzle-difficulty";
function savedDifficulty(): Difficulty {
  try {
    const d = localStorage.getItem(DIFFICULTY_KEY);
    if (d && d in OFFSET) return d as Difficulty;
  } catch {
    // Private mode: normal.
  }
  return "normal";
}
const defaultChoice = (): Choice => ({ theme: null, opening: null, difficulty: savedDifficulty() });

/** Opens the trainer with puzzles picked from the student's own filters. */
export async function startPuzzles(choice: Partial<Choice> = {}) {
  const live = get();
  const own = live && !live.set.fromCoach && live.set.mode === "custom" ? live : null;
  const parked = own ? null : (useParkedPuzzles.getState().custom ?? null);
  const prev = (own ?? parked ?? live)?.choice ?? defaultChoice();
  const next = { ...prev, ...choice };
  try {
    localStorage.setItem(DIFFICULTY_KEY, next.difficulty);
  } catch {
    // Private mode: not remembered.
  }
  // A puzzle still to answer stays on the board; new filters apply from the next one.
  const keep = own ? (unfinished(own) ? own : null) : parked && unpark("custom");
  if (keep) {
    const same = keep.choice.theme === next.theme && keep.choice.opening === next.opening && keep.choice.difficulty === next.difficulty;
    const patch = same ? {} : { choice: next, queue: keep.queue.slice(0, keep.index + 1) };
    if (keep === own) return set(patch);
    return reopen({ ...keep, ...patch });
  }
  await open(blank({ title: "Puzzles", fromCoach: false, mode: "custom" }, next));
}

const NO_FILTER: Choice = { theme: null, opening: null, difficulty: "normal" };

/** Puzzles at the student's own puzzle rating, a bit above or below; no filters. */
export function startRatedPuzzles() {
  const parked = unpark("rated");
  if (parked) return reopen(parked);
  return open(blank({ title: "Rated puzzles", fromCoach: false, mode: "rated" }, NO_FILTER));
}

const RUSH_BEST_KEY = "cc-rush-best";
/** The best rush score on this device. */
export function rushBest(): number {
  try {
    return Number(localStorage.getItem(RUSH_BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Puzzle rush: starts dead easy and gets harder with every puzzle, until three misses. */
export function startRush() {
  const parked = unpark("rush");
  if (parked) return reopen(parked);
  const session = blank({ title: "Puzzle rush", fromCoach: false, mode: "rush" }, NO_FILTER);
  return open({ ...session, rush: { lives: RUSH_LIVES, score: 0, best: rushBest() } });
}

/**
 * The rush's difficulty for its nth puzzle (from 1), chess.com scale: dead easy at the start,
 * climbing fast through the easy ones, ~1350 by the 17th and ~1575 by the 26th, then +25 a puzzle.
 */
const RUSH_CURVE: [n: number, rating: number][] = [
  [1, 300],
  [8, 900],
  [17, 1350],
  [26, 1575],
];
export function rushRating(n: number): number {
  const c = RUSH_CURVE;
  const last = c[c.length - 1];
  if (n >= last[0]) return last[1] + (n - last[0]) * 25;
  let i = 1;
  while (n > c[i][0]) i++;
  const [a, b] = [c[i - 1], c[i]];
  return Math.round(a[1] + ((Math.max(n, 1) - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
}

async function open(session: PuzzleSession) {
  park(get());
  stopDrills();
  stopTrainers();
  usePuzzle.setState(session, true);
  try {
    await refill();
  } catch (e) {
    // Most likely the set isn't downloaded yet; the panel offers the download.
    console.error("could not load puzzles", e);
    set({ status: "error" });
    return;
  }
  begin(0);
}

/** A set the coach picked (find_puzzles). */
export function startCoachSet(title: string, puzzles: Puzzle[]) {
  park(get());
  stopDrills();
  usePuzzle.setState({ ...blank({ title, fromCoach: true }, get()?.choice ?? defaultChoice()), queue: puzzles }, true);
  begin(0);
}

/** Leaves the puzzles; an unfinished one is parked for later (see park). */
export function stopPuzzles() {
  park(get());
  stopReplay();
  usePuzzle.setState(null, true);
}

function blank(set: PuzzleSession["set"], choice: Choice): PuzzleSession {
  return {
    set,
    choice,
    rush: null,
    queue: [],
    index: 0,
    line: null,
    solution: [],
    color: "white",
    status: "loading",
    missed: false,
    message: "",
    shapes: [],
    startedAt: 0,
    change: null,
    view: null,
    results: [],
    mastery: null,
    autoNextAt: null,
  };
}

/** Tops the queue up from the student's filters, widening the rating window if it comes up dry. */
async function refill() {
  const s = get();
  if (!s || s.set.fromCoach) return;
  if (s.set.mode === "rush") return refillRush();
  const { rating } = usePuzzleDb.getState();
  // Rated: the student's own rating, the window giving a mix of a bit easier and a bit harder.
  const rated = s.set.mode === "rated";
  const center = rating + (rated ? 0 : OFFSET[s.choice.difficulty]);
  const exclude = s.queue.map((p) => p.id);
  for (const width of rated ? [150, 300, 600] : [100, 250, 600]) {
    const found = await findPuzzles({
      themes: s.choice.theme ? [s.choice.theme] : [],
      opening: s.choice.opening,
      minRating: center - width,
      maxRating: center + width,
      limit: 10,
      exclude,
    });
    if (found.length) {
      if (get() === null) return;
      usePuzzle.setState((st) => st && { queue: [...st.queue, ...found] });
      return;
    }
  }
}

/** The rush queue: one puzzle per step of the curve, kept a few ahead of the one on the board. */
async function refillRush() {
  const s = get();
  if (!s) return;
  for (let i = s.queue.length; i <= s.index + 3; i++) {
    const center = toLichess(rushRating(i + 1));
    const exclude = get()?.queue.map((p) => p.id) ?? [];
    let found: Puzzle[] = [];
    for (const width of [40, 100, 250, 600]) {
      found = await findPuzzles({ minRating: center - width, maxRating: center + width, limit: 5, exclude });
      if (found.length) break;
    }
    // Left the rush meanwhile, or another refill already got this step.
    const now = get();
    if (!found.length || !now?.rush || now.queue.length !== i) return;
    // The one closest to the curve, so the climb stays steady.
    const pick = found.reduce((a, b) => (Math.abs(b.rating - center) < Math.abs(a.rating - center) ? b : a));
    usePuzzle.setState((st) => st && { queue: [...st.queue, pick] });
  }
}

function begin(index: number) {
  const s = get();
  const puzzle = s?.queue[index];
  if (!s) return;
  if (!puzzle) {
    set({ index, status: "empty", line: null, shapes: [], message: "" });
    return;
  }
  let solution: string[];
  try {
    solution = toSan(puzzle.fen, puzzle.moves);
  } catch {
    // A puzzle that doesn't replay (shouldn't happen with Lichess data): skip it.
    begin(index + 1);
    return;
  }
  // The student plays the side that replies to the opponent's first move.
  const color: Color = sideToMove(puzzle.fen) === "white" ? "black" : "white";
  clearCue();
  stopReplay();
  set({ index, line: emptyLine(puzzle.fen), solution, color, status: "intro", missed: false, message: "", shapes: [], change: null, view: null, mastery: null, autoNextAt: null });
  window.setTimeout(() => {
    if (get()?.queue[get()!.index] !== puzzle) return;
    autoplay();
    set({ status: "solving", startedAt: Date.now() });
  }, 800);
}

/** Plays the opponent's next move of the solution. */
function autoplay() {
  const s = get();
  if (!s?.line) return;
  const ply = s.line.sans.length;
  const chess = new Chess(s.line.fens[ply]);
  const m = chess.move(s.solution[ply]);
  const line: Line = {
    ...s.line,
    sans: [...s.line.sans, m.san],
    fens: [...s.line.fens, chess.fen()],
    lastMoves: [...s.line.lastMoves, [m.from as Key, m.to as Key]],
    notes: [...s.line.notes, ""],
  };
  // The opponent's move brings the board back to the present, as in a game.
  set({ line, view: null });
  buzz(BUZZ_OPPONENT);
}

export async function nextPuzzle() {
  const s = get();
  if (!s) return;
  const next = s.index + 1;
  if (s.rush && s.rush.lives <= 0) return;
  if (!s.set.fromCoach && next >= s.queue.length - 2) {
    // Rush keeps a few ready ahead: only wait when the next one isn't there yet.
    if (s.rush && next < s.queue.length) {
      begin(next);
      refill().catch(() => undefined);
      return;
    }
    set({ status: "loading" });
    await refill();
  }
  begin(next);
}

export async function puzzleMove(from: Key, to: Key) {
  const s = get();
  const puzzle = current();
  if (!s?.line || !puzzle || s.status !== "solving" || s.view !== null) return;
  const ply = s.line.sans.length;
  if (sideToMove(s.line.fens[ply]) !== s.color) return;
  const played = playAt(s.line, ply, from, to);
  if (!played) return;
  const expected = s.solution[ply];
  const last = ply === s.solution.length - 1;
  const mates = new Chess(played.line.fens[ply + 1]).isCheckmate();

  const after = played.line.fens[ply + 1];
  if (played.san === expected || (last && mates)) {
    set({ line: played.line, shapes: [], message: "" });
    const done = last || mates;
    // The final move of a clean solve gets the big cue; a line finished after a miss just gets the tick.
    cue(done && !s.missed ? "solved" : "correct", to, after);
    if (done) return finish(!s.missed);
    window.setTimeout(() => {
      if (get()?.line !== played.line) return;
      autoplay();
    }, 350);
    return;
  }

  // Wrong: show it briefly, then take it back. The first miss fails the puzzle.
  set({ line: played.line, message: `${played.san} isn't it.` });
  cue("wrong", to, after);
  if (!s.missed) {
    set({ missed: true });
    await save(false);
  }
  window.setTimeout(() => {
    if (get()?.line !== played.line) return;
    set({ line: s.line, message: s.rush ? `${played.san} isn't it.` : `${played.san} isn't it. Try again, or view the solution.` });
    // Rush: one try per puzzle; the miss costs a life and the solution plays out.
    if (s.rush) showSolution();
  }, 700);
}

/** Plays out the rest of the solution (the puzzle stays failed). */
export async function showSolution() {
  const s = get();
  if (!s?.line || (s.status !== "solving" && s.status !== "intro")) return;
  if (!s.missed) {
    set({ missed: true });
    await save(false);
  }
  const chess = new Chess(s.line.fens[s.line.sans.length]);
  const line = { ...s.line, sans: [...s.line.sans], fens: [...s.line.fens], lastMoves: [...s.line.lastMoves], notes: [...s.line.notes] };
  for (const san of s.solution.slice(line.sans.length)) {
    const m = chess.move(san);
    line.sans.push(m.san);
    line.fens.push(chess.fen());
    line.lastMoves.push([m.from as Key, m.to as Key]);
    line.notes.push("");
  }
  set({ line });
  cue("failed", null, line.fens[line.fens.length - 1]);
  await finish(false);
  replaySolution();
}

/**
 * "View solution": goes back to where the student was to move and plays the solution out one
 * move at a time, rather than jumping to its end. Any step the student takes (the arrows) or a
 * new puzzle stops it where it is.
 */
const REPLAY_MS = 900;
let replay = 0;
const stopReplay = () => window.clearTimeout(replay);

function replaySolution() {
  stopReplay();
  const s = get();
  if (!s?.line) return;
  const line = s.line;
  const end = line.sans.length;
  // Ply 1: after the opponent's move that sets the puzzle up.
  let ply = Math.min(1, end);
  set({ view: ply === end ? null : ply });
  const step = () => {
    const now = get();
    if (!now || now.line !== line) return;
    ply += 1;
    set({ view: ply >= end ? null : ply });
    if (ply < end) replay = window.setTimeout(step, REPLAY_MS);
  };
  replay = window.setTimeout(step, REPLAY_MS);
}

/** A rush solve moves on quicker than the usual auto-next: there's no rating to count up. */
const RUSH_NEXT_MS = 900;

async function finish(correct: boolean) {
  const s = get()!;
  const puzzle = current()!;
  buzz(BUZZ_END);
  const rush = s.rush && { ...s.rush, score: s.rush.score + (correct ? 1 : 0), lives: s.rush.lives - (correct ? 0 : 1) };
  set({
    status: correct ? "solved" : "failed",
    message: correct ? "Solved." : `The solution: ${s.solution.slice(1).join(" ")}.`,
    view: null,
    results: [...s.results, { id: puzzle.id, correct, themes: puzzle.themes, rating: puzzle.rating }],
    rush,
  });
  if (rush) keepBest(rush);
  if (correct && (rush || useSettings.getState().puzzleAutoNext)) {
    const wait = rush ? RUSH_NEXT_MS : AUTO_NEXT_MS;
    const at = Date.now() + wait;
    set({ autoNextAt: at });
    window.setTimeout(() => {
      const now = get();
      if (now && now.autoNextAt === at && current() === puzzle && now.status === "solved") nextPuzzle();
    }, wait);
  }
  if (correct) await save(true);
}

function keepBest(rush: Rush) {
  if (rush.lives > 0 || rush.score <= rush.best) return;
  try {
    localStorage.setItem(RUSH_BEST_KEY, String(rush.score));
  } catch {
    // Private mode: not remembered.
  }
}

/** Ends a rush run now (otherwise it's kept until the lives run out); the puzzle on the board doesn't count. */
export function endRush() {
  const s = get();
  if (!s?.rush || s.rush.lives <= 0) return;
  stopReplay();
  clearCue();
  const rush = { ...s.rush, lives: 0, ended: true };
  set({ rush, status: s.status === "solved" ? "solved" : "failed", message: "", view: null, autoNextAt: null });
  keepBest(rush);
}

/** Keeps a solved puzzle on screen (the student is looking at it or asking about it). */
export function holdPuzzle() {
  if (get()?.autoNextAt) set({ autoNextAt: null });
}

/** Saves the attempt once per showing; a miss also becomes a drill. */
async function save(correct: boolean) {
  const s = get()!;
  const puzzle = current()!;
  try {
    // Rush is unrated (its easy puzzles would only pad the rating); a miss still becomes a drill.
    const r = s.rush ? null : await recordAttempt(puzzle, correct, Date.now() - s.startedAt);
    if (r && current() === puzzle) {
      set({ change: r.rated ? { before: r.before, after: r.after } : null, mastery: r.mastery?.length ? r.mastery : null });
      // A new star (or tier): hold the puzzle so auto-next doesn't skip the moment.
      const ups = r.mastery?.filter((g) => g.after.stars > g.before.stars) ?? [];
      if (ups.length) {
        holdPuzzle();
        celebrate(ups.some((g) => tierOf(g.after.stars).index > tierOf(g.before.stars).index));
      }
    }
    if (!correct) {
      const themes = puzzle.themes.filter((t) => !["short", "long", "veryLong", "oneMove", "crushing", "advantage"].includes(t));
      const start = new Chess(puzzle.fen);
      uciMove(start, puzzle.moves[0]);
      await addDrills([
        {
          kind: "puzzle",
          title: `Puzzle ${puzzle.id} (${fromLichess(puzzle.rating)})`,
          fen: start.fen(),
          color: s.color,
          answerUci: puzzle.moves[1],
          line: s.solution.slice(1),
          note: themes.map(themeLabel).join(", ") || null,
        },
      ]);
    }
  } catch (e) {
    console.error("saving the puzzle attempt failed", e);
  }
}

/** Step back through the moves so far (back to before the opponent's first move) and forward again. */
export function viewStep(delta: Step) {
  const s = get();
  if (!s?.line) return;
  stopReplay();
  set({ view: stepView(s.line.sans.length, s.view, delta), autoNextAt: null });
}

export function setChoice(choice: Partial<Choice>) {
  startPuzzles(choice);
}

/** What the coach sees for a question asked from the puzzle board. */
export function puzzleContext(): { title: string; fen: string; detail: string } | null {
  const s = get();
  const puzzle = current();
  if (!s?.line || !puzzle) return null;
  const over = s.status === "solved" || s.status === "failed";
  const ply = viewedPly(s.line.sans.length, s.view);
  return {
    title: `Lichess puzzle ${puzzle.id}`,
    fen: s.line.fens[ply],
    detail:
      `rating ${fromLichess(puzzle.rating)} (chess.com scale), student plays ${s.color}` +
      (over
        ? `, ${s.status}. Themes: ${puzzle.themes.join(", ")}. Solution from the puzzle start ${s.line.fens[1]}: ${s.solution.slice(1).join(" ")}`
        : ", not solved yet: don't give the answer away"),
  };
}

export function puzzleQuestion(): string {
  const s = get()!;
  const ctx = puzzleContext()!;
  return s.status === "failed"
    ? `I missed this puzzle (FEN ${s.line!.fens[1]}, I play ${s.color}). The solution was ${s.solution.slice(1).join(" ")}. What's the idea, and what should I have noticed? Keep it short.`
    : `About this puzzle (${ctx.title}): explain the idea behind the solution, briefly.`;
}

/** "Pins: solved 3 of 5, missed …" for the coach after a set it picked. */
export function setSummary(): string {
  const s = get()!;
  const right = s.results.filter((r) => r.correct).length;
  const missed = s.results.filter((r) => !r.correct);
  return (
    `I finished the puzzle set "${s.set.title}": solved ${right} of ${s.results.length}.` +
    (missed.length ? ` Missed: ${missed.map((m) => `${m.id} (${fromLichess(m.rating)}; ${m.themes.join(", ")})`).join("; ")}.` : "")
  );
}
