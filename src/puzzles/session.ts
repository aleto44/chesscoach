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
import { fromLichess } from "../rating";
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

export interface PuzzleSession {
  /** Where the puzzles come from: the student's own choice, or a set the coach picked. */
  set: { title: string; fromCoach: boolean };
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
  usePuzzle.setState({ ...saved, mastery, autoNextAt: null }, true);
  const puzzle = saved.queue[saved.index];
  if (saved.status === "loading" || saved.status === "intro" || !saved.line) {
    // Mid-refill or before the opponent's first move: start this puzzle over (or reload the set).
    if (puzzle) begin(saved.index);
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
  // The opponent's reply was due: play it.
  const now = get()!.line!;
  if (sideToMove(now.fens[now.sans.length]) !== saved.color && now.sans.length < saved.solution.length) autoplay();
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
  stopDrills();
  stopTrainers();
  const prev = get()?.choice ?? defaultChoice();
  const next = { ...prev, ...choice };
  try {
    localStorage.setItem(DIFFICULTY_KEY, next.difficulty);
  } catch {
    // Private mode: not remembered.
  }
  usePuzzle.setState(blank({ title: "Puzzles", fromCoach: false }, next), true);
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
  stopDrills();
  usePuzzle.setState({ ...blank({ title, fromCoach: true }, get()?.choice ?? defaultChoice()), queue: puzzles }, true);
  begin(0);
}

export function stopPuzzles() {
  stopReplay();
  usePuzzle.setState(null, true);
}

function blank(set: PuzzleSession["set"], choice: Choice): PuzzleSession {
  return {
    set,
    choice,
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
  const { rating } = usePuzzleDb.getState();
  const center = rating + OFFSET[s.choice.difficulty];
  const exclude = s.queue.map((p) => p.id);
  for (const width of [100, 250, 600]) {
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
  if (!s.set.fromCoach && next >= s.queue.length - 2) {
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
    if (get()?.line === played.line) set({ line: s.line, message: `${played.san} isn't it. Try again, or view the solution.` });
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

async function finish(correct: boolean) {
  const s = get()!;
  const puzzle = current()!;
  buzz(BUZZ_END);
  set({
    status: correct ? "solved" : "failed",
    message: correct ? "Solved." : `The solution: ${s.solution.slice(1).join(" ")}.`,
    view: null,
    results: [...s.results, { id: puzzle.id, correct, themes: puzzle.themes, rating: puzzle.rating }],
  });
  if (correct && useSettings.getState().puzzleAutoNext) {
    const at = Date.now() + AUTO_NEXT_MS;
    set({ autoNextAt: at });
    window.setTimeout(() => {
      const now = get();
      if (now && now.autoNextAt === at && current() === puzzle && now.status === "solved") nextPuzzle();
    }, AUTO_NEXT_MS);
  }
  if (correct) await save(true);
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
    const r = await recordAttempt(puzzle, correct, Date.now() - s.startedAt);
    if (current() === puzzle) {
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
