// An endgame trainer session on the main board: the student plays a standard endgame against
// full-strength Stockfish until it's won (mate, or a pawn promoted with the win intact) or held.
// After each of the student's moves the engine checks the verdict, so a move that throws the win
// away (or loses the draw) ends the try right there, with the reason.
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { create } from "zustand";
import { emptyLine, playAt, sideToMove, type Line } from "../chess/line";
import { stepView, viewedPly, type Step } from "../chess/view";
import { getOpponentEngine, getReviewEngine, type EngineLine } from "../engine/stockfish";
import { ENDGAMES, type Endgame } from "./positions";
import { stopPuzzles } from "../puzzles/session";
import { stopDrills } from "../analysis/drillSession";
import { stopGuess } from "../guess/session";
import { stopPlans } from "../plans/session";
import { stopOpening } from "../openings/session";
import { keepSession } from "../persist";

export interface EndgameSession {
  id: string;
  line: Line;
  status: "playing" | "thinking" | "won" | "held" | "failed";
  message: string;
  /** Moves the student has played in this try. */
  moves: number;
  hint: boolean;
  shapes: { orig: Key; dest: Key; brush: string }[];
  view: number | null;
  /** A position from the student's own games (not in ENDGAMES), and the ones queued after it. */
  spec?: Endgame;
  more?: Endgame[];
}

export const useEndgame = create<EndgameSession | null>(() => null);

const get = () => useEndgame.getState();
const set = (patch: Partial<EndgameSession>) => useEndgame.setState(patch);
export const endgameOf = (s: EndgameSession) => s.spec ?? ENDGAMES.find((e) => e.id === s.id)!;

/** A mate goal gives up after this many of the student's moves (the 50-move rule is close by). */
const MOVE_LIMIT = 50;
/** A convert goal that's still clearly better after this many moves counts as kept. */
const CONVERT_MOVES = 40;
/** Below this (student's view, centipawns), a won ending is no longer won. */
const STILL_WON = 200;
/** Beyond this against the student, a drawn ending is lost. */
const LOST = -400;

// ---- Results, kept on this device ----

export interface EndgameRecord {
  tries: number;
  wins: number;
  last: "won" | "failed" | null;
}

const RECORD_KEY = "cc-endgames";
export function endgameRecords(): Record<string, EndgameRecord> {
  try {
    return JSON.parse(localStorage.getItem(RECORD_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function record(id: string, won: boolean) {
  const all = endgameRecords();
  const r = all[id] ?? { tries: 0, wins: 0, last: null };
  all[id] = { tries: r.tries + 1, wins: r.wins + (won ? 1 : 0), last: won ? "won" : "failed" };
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(all));
  } catch {
    // Private mode: not kept.
  }
}

// ---- The session ----

export function startEndgame(id: string) {
  const e = ENDGAMES.find((x) => x.id === id);
  if (e) begin(e);
}

/** Plays a position from the student's own games; `more` are played next, in order. */
export const startCustomEndgame = (spec: Endgame, more: Endgame[] = []) => begin(spec, true, more);

function begin(e: Endgame, custom = false, more: Endgame[] = []) {
  stopPuzzles();
  stopDrills();
  stopGuess();
  stopPlans();
  stopOpening();
  useEndgame.setState(
    {
      id: e.id,
      line: emptyLine(e.fen),
      status: "playing",
      message: "",
      moves: 0,
      hint: false,
      shapes: [],
      view: null,
      ...(custom ? { spec: e, more } : {}),
    },
    true,
  );
  if (sideToMove(e.fen) !== e.side) reply();
}

/** Restores the last session (if any) and keeps saving it, for a phone that dropped the page. Call once at startup. */
export const initEndgameSession = () =>
  keepSession(useEndgame, "cc-endgame", (s) => !!((s.spec?.fen || ENDGAMES.find((e) => e.id === s.id)) && s.line?.fens), resume);

/** Picks a saved session back up, redoing what the engine was in the middle of when the page went away. */
function resume(saved: EndgameSession) {
  useEndgame.setState({ ...saved, status: saved.status === "thinking" ? "playing" : saved.status }, true);
  if (saved.status !== "thinking") return;
  const s = get()!;
  const ply = s.line.sans.length;
  // The engine's turn: it was judging the student's last move (or replying, after which judging again is harmless).
  if (ply > 0 && sideToMove(s.line.fens[ply]) !== endgameOf(s).side) {
    set({ status: "thinking" });
    check(s.line, s.line.sans[ply - 1], s.moves);
  }
}

export const stopEndgame = () => useEndgame.setState(null, true);
export const retryEndgame = () => {
  const s = get();
  if (s?.spec) startCustomEndgame(s.spec, s.more);
  else if (s) startEndgame(s.id);
};
/** Whether "Next" has somewhere to go: the built-in list wraps; positions from games run out. */
export const hasNextEndgame = (s: EndgameSession) => !s.spec || !!s.more?.length;
export function nextEndgame() {
  const s = get();
  if (!s) return;
  if (s.spec) {
    const [next, ...rest] = s.more ?? [];
    if (next) startCustomEndgame(next, rest);
    return;
  }
  const i = ENDGAMES.findIndex((e) => e.id === s.id);
  startEndgame(ENDGAMES[(i + 1) % ENDGAMES.length].id);
}

/** White-view centipawns, mates as ±(10000 − distance). */
const whiteCp = (l: EngineLine | undefined) => (!l ? 0 : l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0));

/** How the game ended, if it did: from chess.js, which knows repetition and the 50-move rule. */
function ending(line: Line): "mate" | "draw" | null {
  const chess = new Chess(line.startFen);
  for (const san of line.sans) chess.move(san);
  if (chess.isCheckmate()) return "mate";
  if (chess.isDraw() || chess.isStalemate()) return "draw";
  return null;
}

function finish(won: boolean, status: EndgameSession["status"], message: string) {
  const s = get();
  if (!s) return;
  set({ status, message, shapes: [] });
  record(s.id, won);
}

export async function endgameMove(from: Key, to: Key, promotion?: string) {
  const s = get();
  if (!s || s.status !== "playing" || s.view !== null) return;
  const e = endgameOf(s);
  const ply = s.line.sans.length;
  if (sideToMove(s.line.fens[ply]) !== e.side) return;
  const played = playAt(s.line, ply, from, to, promotion);
  if (!played) return;
  const line = played.line;
  const moves = s.moves + 1;
  set({ line, moves, shapes: [], status: "thinking", message: "" });
  return check(line, played.san, moves);
}

/** The engine's verdict on the student's move that left `line`; the try ends there or the engine replies. */
async function check(line: Line, san: string, moves: number) {
  const e = endgameOf(get()!);
  const ply = line.sans.length - 1;
  const end = ending(line);
  if (end === "mate") return finish(true, "won", e.goal === "draw" ? "Checkmate! More than a draw." : "Checkmate. Well done.");
  if (end === "draw") {
    return e.goal === "draw"
      ? finish(true, "held", "Draw. You held it.")
      : finish(false, "failed", stalemated(line) ? "Stalemate: the king has no moves but isn't in check. Leave it a square." : "That's a draw, and this one is a win.");
  }

  const fen = line.fens[ply + 1];
  let verdict: number;
  try {
    const [best] = await getReviewEngine().analyze(fen, 1, 14);
    verdict = whiteCp(best) * (e.side === "white" ? 1 : -1);
  } catch (err) {
    console.error("endgame check failed", err);
    verdict = e.goal === "draw" ? 0 : 1000;
  }
  // The student left or started over while the engine was looking.
  if (get()?.line !== line) return;

  if (e.goal === "convert") {
    if (verdict < (e.failBelow ?? 150))
      return finish(false, "failed", `${san} lets the advantage slip: with best play it's ${cpText(verdict)} now. Try again, or ask for a hint.`);
    if (verdict >= (e.winAt ?? 600)) return finish(true, "won", `${cpText(verdict)}: that's decisive. Converted.`);
    if (moves >= (e.moves ?? CONVERT_MOVES))
      return finish(true, "won", `${moves} moves and still ${cpText(verdict)}: you kept the advantage, though a faster kill was there.`);
  } else if (e.goal !== "draw" && verdict < STILL_WON)
    return finish(false, "failed", `${san} lets the win slip: with best play it's no longer won. Try again, or look at the hint.`);
  if (e.goal === "draw" && verdict <= (e.lostAt ?? LOST)) return finish(false, "failed", `${san} loses: the engine wins from here. Try again.`);
  if (e.goal === "promote" && san.includes("=")) return finish(true, "won", "Promoted, and the win is safe. Well done.");
  if (e.goal === "draw" && moves >= (e.moves ?? 15)) return finish(true, "held", `${moves} moves and still a draw: you've held it.`);
  const limit = e.moves ?? MOVE_LIMIT;
  if (e.goal === "mate" && moves >= limit) return finish(false, "failed", `${limit} moves without mate. Push the king to the edge faster.`);
  set({ status: "playing" });
  reply();
}

/** "+2.3" for the student, or "a forced mate". */
const cpText = (cp: number) => (Math.abs(cp) >= 9000 ? (cp > 0 ? "a forced mate" : "mate against you") : `${cp >= 0 ? "+" : "−"}${(Math.abs(cp) / 100).toFixed(1)}`);

function stalemated(line: Line): boolean {
  return new Chess(line.fens[line.fens.length - 1]).isStalemate();
}

/** The engine's move, at full strength. */
async function reply() {
  const s = get();
  if (!s) return;
  const e = endgameOf(s);
  const ply = s.line.sans.length;
  set({ status: "thinking" });
  let uci: string | null = null;
  try {
    uci = await getOpponentEngine().bestMove(s.line.fens[ply], null, 700);
  } catch (err) {
    console.error("engine move failed", err);
  }
  const now = get();
  if (!now || now.line !== s.line) return;
  if (!uci) return set({ status: "playing" });
  const played = playAt(now.line, ply, uci.slice(0, 2) as Key, uci.slice(2, 4) as Key, uci[4]);
  if (!played) return set({ status: "playing" });
  set({ line: played.line, view: null });
  const end = ending(played.line);
  if (end === "mate") return finish(false, "failed", "Checkmated. Try again.");
  if (end === "draw") {
    return e.goal === "draw" ? finish(true, "held", "Draw. You held it.") : finish(false, "failed", "That's a draw, and this one is a win.");
  }
  // The engine's reply promoted (or will): a draw goal fails on a queen, a win goal can't happen here.
  if (e.goal === "draw" && played.san.includes("=")) return finish(false, "failed", "The pawn promoted. Try again.");
  set({ status: "playing" });
}

/** Shows the hint and the engine's move as an arrow. */
export async function endgameHint() {
  const s = get();
  if (!s || s.status !== "playing") return;
  set({ hint: true });
  const fen = s.line.fens[s.line.sans.length];
  try {
    const [best] = await getReviewEngine().analyze(fen, 1, 16);
    const uci = best?.pv[0];
    if (uci && get()?.line === s.line) set({ shapes: [{ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush: "green" }] });
  } catch (err) {
    console.error("no hint move", err);
  }
}

export function endgameStep(delta: Step) {
  const s = get();
  if (!s) return;
  set({ view: stepView(s.line.sans.length, s.view, delta) });
}

/** What the coach sees for a question asked from the endgame board. */
export function endgameContext(): { title: string; fen: string; detail: string } | null {
  const s = get();
  if (!s) return null;
  const e: Endgame = endgameOf(s);
  const goal =
    e.goal === "draw" ? "hold the draw" : e.goal === "mate" ? "deliver mate" : e.goal === "convert" ? "turn the advantage into a win" : "promote and win";
  return {
    title: `${s.spec ? "Position from the student's own game" : "Endgame trainer"}: ${e.name}`,
    fen: s.line.fens[viewedPly(s.line.sans.length, s.view)],
    detail: `student plays ${e.side} against full-strength Stockfish and must ${goal}; ${s.moves} moves played, ${s.status}`,
  };
}

export const endgameQuestion = () => {
  const s = get()!;
  const e = endgameOf(s);
  return s.status === "failed"
    ? `In the endgame trainer (${e.name}) it went wrong: ${s.message} What's the right technique here? Show it on the board, briefly.`
    : `I'm practising the endgame "${e.name}". What's the plan from this position? Keep it short and show it on the board.`;
};
