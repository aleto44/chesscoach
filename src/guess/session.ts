// "Guess the move": the student plays through a master game from one side, guessing each move.
// The master's move scores 3. Another move scores by how close the engine thinks it comes: 2 when
// it's as good, 1 when it's a little worse, 0 otherwise. Either way the game goes on with the
// master's move, and a miss waits with both moves drawn so the student can see the difference.
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { create } from "zustand";
import { buildLine, playAt, sideToMove, type Line } from "../chess/line";
import { stepView, viewedPly, type Step } from "../chess/view";
import { lossFromEvals } from "../analysis/review";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import type { Color } from "../store";
import { stopPuzzles } from "../puzzles/session";
import { stopDrills } from "../analysis/drillSession";
import { stopEndgame } from "../endgames/session";
import { stopOpening } from "../openings/session";
import { keepSession } from "../persist";
import { stopPlans } from "../plans/session";

export interface GuessGame {
  /** Saved best scores are kept per id; pasted games have none. */
  id: string | null;
  title: string;
  startFen: string;
  sans: string[];
  result: string | null;
}

export interface GuessResult {
  ply: number;
  guess: string;
  master: string;
  points: 0 | 1 | 2 | 3;
}

export interface GuessSession {
  game: GuessGame;
  side: Color;
  /** The game so far (the master's moves only). */
  line: Line;
  status: "waiting" | "guessing" | "checking" | "reveal" | "done";
  message: string;
  results: GuessResult[];
  shapes: { orig: Key; dest: Key; brush: string }[];
  view: number | null;
}

export const useGuess = create<GuessSession | null>(() => null);
const get = () => useGuess.getState();
const set = (patch: Partial<GuessSession>) => useGuess.setState(patch);

export const score = (s: GuessSession) => s.results.reduce((n, r) => n + r.points, 0);
export const maxScore = (s: GuessSession) => s.results.length * 3;

// ---- Best scores, kept on this device ----

const BEST_KEY = "cc-guess-best";
export function bestScores(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveBest(id: string, pct: number) {
  const all = bestScores();
  if ((all[id] ?? -1) >= pct) return;
  all[id] = pct;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    // Private mode: not kept.
  }
}

// ---- The session ----

/** `skip`: full moves played out before the guessing starts (the opening). */
export function startGuess(game: GuessGame, side: Color, skip = 0) {
  const built = buildLine(game.startFen, game.sans.slice(0, Math.min(game.sans.length, skip * 2)));
  if (!("line" in built)) return;
  stopPuzzles();
  stopDrills();
  stopEndgame();
  stopOpening();
  stopPlans();
  useGuess.setState({ game, side, line: built.line, status: "waiting", message: "", results: [], shapes: [], view: null }, true);
  advance();
}

/** Restores the last session (if any) and keeps saving it, for a phone that dropped the page. Call once at startup. */
export const initGuessSession = () =>
  keepSession(useGuess, "cc-guess", (s) => !!(s.game?.sans && s.line?.fens && Array.isArray(s.results)), resume);

/** Picks a saved session back up, redoing what was in progress when the page went away. */
function resume(saved: GuessSession) {
  useGuess.setState(saved, true);
  // The other side's move was on its way.
  if (saved.status === "waiting") return advance();
  // The engine was still scoring a guess: the guess is taken back, to make again.
  if (saved.status === "checking") {
    const built = buildLine(saved.line.startFen, saved.game.sans.slice(0, saved.line.sans.length - 1));
    if ("line" in built) set({ line: built.line, status: "guessing", message: "", shapes: [], view: null });
  }
}

export const stopGuess = () => useGuess.setState(null, true);

/** Plays the other side's moves until it's the student's turn to guess (or the game is over). */
function advance() {
  const s = get();
  if (!s) return;
  const ply = s.line.sans.length;
  if (ply >= s.game.sans.length) return finish();
  if (sideToMove(s.line.fens[ply]) === s.side) return set({ status: "guessing", view: null });
  set({ status: "waiting" });
  window.setTimeout(() => {
    const now = get();
    if (!now || now.line !== s.line) return;
    const built = buildLine(now.line.startFen, now.game.sans.slice(0, ply + 1));
    if (!("line" in built)) return finish();
    set({ line: built.line, view: null });
    advance();
  }, 550);
}

function finish() {
  const s = get();
  if (!s) return;
  const pct = maxScore(s) ? Math.round((100 * score(s)) / maxScore(s)) : 0;
  set({ status: "done", shapes: [], message: `Game over${s.game.result ? ` (${s.game.result})` : ""}. You scored ${score(s)} of ${maxScore(s)}: ${pct}%.` });
  if (s.game.id && maxScore(s)) saveBest(s.game.id, pct);
}

const whiteCp = (l: EngineLine | undefined) => (!l ? 0 : l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0));

/** The engine's view of a position (White's view), with a finished game scored exactly. */
async function evalOf(fen: string): Promise<number> {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return chess.turn() === "w" ? -10000 : 10000;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  const [best] = await getReviewEngine().analyze(fen, 1, 13);
  return whiteCp(best);
}

const arrow = (fen: string, san: string, brush: string) => {
  const m = new Chess(fen).move(san);
  return { orig: m.from as Key, dest: m.to as Key, brush };
};

export async function guessMove(from: Key, to: Key, promotion?: string) {
  const s = get();
  if (!s || s.status !== "guessing" || s.view !== null) return;
  const ply = s.line.sans.length;
  const fen = s.line.fens[ply];
  const master = s.game.sans[ply];
  const played = playAt(s.line, ply, from, to, promotion);
  if (!played) return;
  const masterLine = buildLine(s.line.startFen, s.game.sans.slice(0, ply + 1));
  if (!("line" in masterLine)) return;

  if (played.san === master) {
    set({
      line: masterLine.line,
      results: [...s.results, { ply, guess: played.san, master, points: 3 }],
      message: `✓ ${master}: the master's move. +3`,
      shapes: [],
    });
    return advance();
  }

  // Show the guess while the engine compares it with the master's move.
  set({ line: played.line, status: "checking", message: `${played.san}… checking it against the master's move.` });
  let points: GuessResult["points"] = 0;
  let verdict = "";
  try {
    const [mine, theirs] = [await evalOf(played.line.fens[ply + 1]), await evalOf(masterLine.line.fens[ply + 1])];
    const loss = lossFromEvals(theirs, mine, s.side);
    // Better than the master's move by the engine's lights counts as matching it.
    points = loss < 2 ? 2 : loss < 5 ? 1 : 0;
    verdict =
      points === 2
        ? `the engine rates it as good as ${master}.`
        : points === 1
          ? `close, but the engine prefers ${master}.`
          : `the engine says ${master} is clearly stronger.`;
  } catch (e) {
    console.error("could not compare the moves", e);
    verdict = `the master played ${master}.`;
  }
  if (get()?.line !== played.line) return;
  set({
    line: masterLine.line,
    status: "reveal",
    results: [...s.results, { ply, guess: played.san, master, points }],
    message: `${played.san}: ${verdict} +${points}`,
    shapes: [arrow(fen, played.san, "red"), arrow(fen, master, "green")],
    view: null,
  });
}

/** After a miss: on to the next move. */
export function continueGuess() {
  const s = get();
  if (!s || s.status !== "reveal") return;
  set({ shapes: [], message: "" });
  advance();
}

export function guessStep(delta: Step) {
  const s = get();
  if (!s) return;
  set({ view: stepView(s.line.sans.length, s.view, delta) });
}

/** What the coach sees for a question asked from the guess-the-move board. */
export function guessContext(): { title: string; fen: string; detail: string } | null {
  const s = get();
  if (!s) return null;
  const last = s.results[s.results.length - 1];
  const fen = s.line.fens[viewedPly(s.line.sans.length, s.view)];
  return {
    title: `Guess the move: ${s.game.title}`,
    fen,
    detail:
      `the student guesses ${s.side}'s moves of a master game; score ${score(s)} of ${maxScore(s)}` +
      (s.status === "guessing" ? ". It's the student's turn to guess: don't reveal the master's move" : "") +
      (last ? `. Last guess: ${last.guess}, the master played ${last.master}` : ""),
  };
}

export function guessQuestion(): string {
  const s = get()!;
  const last = s.results[s.results.length - 1];
  const fen = s.line.fens[last ? last.ply : s.line.sans.length];
  return last && last.guess !== last.master
    ? `In "${s.game.title}" (position before the move: FEN ${fen}) I guessed ${last.guess} but the master played ${last.master}. What's the idea behind ${last.master}, and what's wrong with mine? Show it on the board, briefly.`
    : `In "${s.game.title}", what's the plan for ${s.side} here? Keep it short.`;
}
