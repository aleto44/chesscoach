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
import { SURPRISES, pickSurprise } from "./surprise";
import { moveCard, situationCard } from "./now";
import type { PlanIdea } from "../openings/plans";
import { stopPuzzles } from "../puzzles/session";
import { stopDrills } from "../analysis/drillSession";
import { stopGuess } from "../guess/session";
import { stopPlans } from "../plans/session";
import { stopOpening } from "../openings/session";
import { keepSession } from "../persist";
import { saveSetting, useSettings } from "../settings";

export interface EndgameSession {
  id: string;
  line: Line;
  status: "playing" | "thinking" | "won" | "held" | "failed";
  message: string;
  /** Moves the student has played in this try. */
  moves: number;
  hint: boolean;
  /** Surprise endings: how many of the ending's ideas the student has asked for so far. */
  ideas: number;
  /** Started from "Surprise me": the name stays hidden until a hint or the end, and Next picks another. */
  surprise?: boolean;
  /** Hints about the position on the board (now.ts): "Right now", then the move. Only for `fen`. */
  now?: { fen: string; cards: PlanIdea[] };
  /** A hint is being worked out. */
  hinting?: boolean;
  shapes: { orig: Key; dest: Key; brush: string }[];
  view: number | null;
  /** A position from the student's own games (not in ENDGAMES), and the ones queued after it. */
  spec?: Endgame;
  more?: Endgame[];
  /** After a failed try: the ply to take back to, where the result was last still intact. */
  back?: number;
}

export const useEndgame = create<EndgameSession | null>(() => null);

const get = () => useEndgame.getState();
const set = (patch: Partial<EndgameSession>) => useEndgame.setState(patch);
const builtIn = (id: string) => ENDGAMES.find((e) => e.id === id) ?? SURPRISES.find((e) => e.id === id);
export const endgameOf = (s: EndgameSession) => s.spec ?? builtIn(s.id)!;

/** A mate goal gives up after this many of the student's moves (the 50-move rule is close by). */
const MOVE_LIMIT = 50;
/** A convert goal that's still clearly better after this many moves counts as kept. */
const CONVERT_MOVES = 40;
/** Below this (student's view, centipawns), a won ending is no longer won. */
const STILL_WON = 200;
/** Beyond this against the student, a drawn ending is lost. */
const LOST = -400;

/**
 * How deep to judge a move. Pawn endings hide their races past a shallow horizon (a move that loses
 * still looks winning at depth 14), and with this little material a deep search is quick.
 */
function judgeDepth(fen: string): number {
  const pieces = fen.split(" ")[0].replace(/[^pnbrqPNBRQ]/g, "").length;
  const heavy = /[nbrqNBRQ]/.test(fen.split(" ")[0]);
  return !heavy ? 24 : pieces <= 8 ? 20 : 16;
}

/** The student's-view eval of `fen` with best play. */
async function judge(fen: string, side: Endgame["side"]): Promise<number> {
  const [best] = await getReviewEngine().analyze(fen, 1, judgeDepth(fen));
  return whiteCp(best) * (side === "white" ? 1 : -1);
}

/** Whether a verdict still keeps the ending's result (a win still won, a draw still held). */
function kept(e: Endgame, verdict: number): boolean {
  if (e.goal === "draw") return verdict > (e.lostAt ?? LOST);
  if (e.goal === "convert") return verdict >= (e.failBelow ?? 150);
  return verdict >= (e.goal === "promote" ? (e.failBelow ?? STILL_WON) : STILL_WON);
}

// ---- Results ----

export interface EndgameRecord {
  tries: number;
  wins: number;
  last: "won" | "failed" | null;
}

/** Kept in the settings (endgameRecords), so the phone and the computer share them. */
export const endgameRecords = (): Record<string, EndgameRecord> => useSettings.getState().endgameRecords;
function record(id: string, won: boolean) {
  const all = endgameRecords();
  const r = all[id] ?? { tries: 0, wins: 0, last: null };
  const next: EndgameRecord = { tries: r.tries + 1, wins: r.wins + (won ? 1 : 0), last: won ? "won" : "failed" };
  saveSetting("endgameRecords", { ...all, [id]: next }).catch((e) => console.error("saving the endgame result failed", e));
}

// ---- The session ----

export function startEndgame(id: string, surprise = false) {
  const e = builtIn(id);
  if (e) begin(e, false, [], surprise);
}

/** A surprise ending: a random one from SURPRISES, preferring ones not won yet. */
export const startSurprise = () => begin(pickSurprise(endgameRecords(), get()?.id), false, [], true);

/** Plays a position from the student's own games; `more` are played next, in order. */
export const startCustomEndgame = (spec: Endgame, more: Endgame[] = []) => begin(spec, true, more);

function begin(e: Endgame, custom = false, more: Endgame[] = [], surprise = false) {
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
      ideas: 0,
      shapes: [],
      view: null,
      ...(custom ? { spec: e, more } : {}),
      ...(surprise ? { surprise } : {}),
    },
    true,
  );
  if (sideToMove(e.fen) !== e.side) reply();
}

/** Restores the last session (if any) and keeps saving it, for a phone that dropped the page. Call once at startup. */
export const initEndgameSession = () =>
  keepSession(useEndgame, "cc-endgame", (s) => !!((s.spec?.fen || builtIn(s.id)) && s.line?.fens), resume);

/** Picks a saved session back up, redoing what the engine was in the middle of when the page went away. */
function resume(saved: EndgameSession) {
  useEndgame.setState({ ...saved, ideas: saved.ideas ?? 0, hinting: false, status: saved.status === "thinking" ? "playing" : saved.status }, true);
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
  else if (s) startEndgame(s.id, s.surprise);
};
/** The ply before the student's last move, or null if they haven't moved. */
function beforeLastMove(s: EndgameSession): number | null {
  const side = endgameOf(s).side;
  for (let i = s.line.sans.length - 1; i >= 0; i--) if (sideToMove(s.line.fens[i]) === side) return i;
  return null;
}

/** Whether a failed try can be taken back to just before the student's mistake. */
export const canTakeBack = (s: EndgameSession) => s.status === "failed" && (s.back ?? beforeLastMove(s)) !== null;

/** Undoes the student's mistake (by default their last move, and the engine's reply) and plays on from there. */
export function takeBackEndgame() {
  const s = get();
  if (!s || !canTakeBack(s)) return;
  const ply = s.back ?? beforeLastMove(s)!;
  const side = endgameOf(s).side;
  const undone = s.line.fens.slice(ply, s.line.sans.length).filter((f) => sideToMove(f) === side).length;
  const l = s.line;
  set({
    line: { ...l, sans: l.sans.slice(0, ply), fens: l.fens.slice(0, ply + 1), lastMoves: l.lastMoves.slice(0, ply), notes: l.notes.slice(0, ply) },
    moves: Math.max(0, s.moves - undone),
    status: "playing",
    message: "",
    back: undefined,
    shapes: [],
    view: null,
  });
}

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
  if (s.surprise) return startSurprise();
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

function finish(won: boolean, status: EndgameSession["status"], message: string, back?: number) {
  const s = get();
  if (!s) return;
  set({ status, message, shapes: [], back });
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
    verdict = await judge(fen, e.side);
  } catch (err) {
    console.error("endgame check failed", err);
    verdict = e.goal === "draw" ? 0 : 1000;
  }
  // The student left or started over while the engine was looking.
  if (get()?.line !== line) return;

  if (e.goal === "convert") {
    if (!kept(e, verdict))
      return slipped(line, `${san} lets the advantage slip: with best play it's ${cpText(verdict)} now. Take it back and find a better move, or ask for a hint.`);
    if (verdict >= (e.winAt ?? 600)) return finish(true, "won", `${cpText(verdict)}: that's decisive. Converted.`);
    if (moves >= (e.moves ?? CONVERT_MOVES))
      return finish(true, "won", `${moves} moves and still ${cpText(verdict)}: you kept the advantage, though a faster kill was there.`);
  } else if (e.goal !== "draw" && !kept(e, verdict))
    return slipped(line, `${san} lets the win slip: with best play it's no longer won. Take it back and find a better move, or ask for a hint.`);
  if (e.goal === "draw" && !kept(e, verdict)) return slipped(line, `${san} loses: the engine wins from here. Take it back and look for another move.`);
  if (e.goal === "promote" && san.includes("=")) return finish(true, "won", "Promoted, and the win is safe. Well done.");
  if (e.goal === "draw" && moves >= (e.moves ?? 15)) return finish(true, "held", `${moves} moves and still a draw: you've held it.`);
  const limit = e.moves ?? MOVE_LIMIT;
  if (e.goal === "mate" && moves >= limit) return finish(false, "failed", `${limit} moves without mate. Push the king to the edge faster.`);
  set({ status: "playing" });
  reply();
}

/** How many of the student's earlier moves to look back through for the real slip. */
const LOOK_BACK = 8;

/**
 * Ends a try on the student's last move in `line`, unless the result was already gone before it: a
 * deeper look can find a loss an earlier, shallower check let through. Then every move would fail,
 * so this walks back to the student's move that really gave it away and takes back to there.
 */
async function slipped(line: Line, message: string) {
  const e = endgameOf(get()!);
  const last = line.sans.length - 1;
  // The plies the student moved from, latest first.
  const theirs = line.fens.slice(0, last + 1).flatMap((f, i) => (sideToMove(f) === e.side ? [i] : [])).reverse();
  // Not found within the look-back: the student's first move (the start is checked to keep its result).
  let slip = theirs[theirs.length - 1] ?? last;
  try {
    for (const i of theirs.slice(0, LOOK_BACK)) {
      // Still intact before the student's move at ply i, so that move gave it away.
      if (kept(e, await judge(line.fens[i], e.side))) {
        slip = i;
        break;
      }
      if (get()?.line !== line) return;
    }
  } catch (err) {
    console.error("endgame look-back failed", err);
    slip = last;
  }
  if (get()?.line !== line) return;
  if (slip === last) return finish(false, "failed", message);
  finish(
    false,
    "failed",
    `It was already gone before that move: ${line.sans[slip]}, ${countBack(line, slip, e.side)} earlier, is where the ${e.goal === "draw" ? "draw" : "win"} slipped away. Take back to there and try another move, or ask for a hint.`,
    slip,
  );
}

/** "2 moves" / "1 move": how many of the student's moves ago ply `slip` was. */
function countBack(line: Line, slip: number, side: Endgame["side"]): string {
  const n = line.fens.slice(slip, line.sans.length).filter((f) => sideToMove(f) === side).length - 1;
  return n === 1 ? "1 move" : `${n} moves`;
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
  if (end === "mate") return finish(false, "failed", "Checkmated. Take it back, or start over.");
  if (end === "draw") {
    return e.goal === "draw" ? finish(true, "held", "Draw. You held it.") : finish(false, "failed", "That's a draw, and this one is a win.");
  }
  // The engine's reply promoted (or will): a draw goal fails on a queen, a win goal can't happen here.
  if (e.goal === "draw" && played.san.includes("=")) return finish(false, "failed", "The pawn promoted. Take it back, or start over.");
  set({ status: "playing" });
}

/** Whether the next hint is another of the ending's ideas (rather than the engine's move). */
export const moreIdeas = (s: EndgameSession) => s.ideas < (endgameOf(s).ideas?.length ?? 0);

/** The live hint cards for the position on the board, if they were worked out for it. */
export const nowCards = (s: EndgameSession) => (s.now?.fen === s.line.fens[s.line.sans.length] ? s.now.cards : []);

/** What the next hint is: a written idea (only from the start position), "Right now", the move, or nothing left. */
export function nextHint(s: EndgameSession): "idea" | "situation" | "move" | null {
  const e = endgameOf(s);
  if (!e.ideas) return "move";
  if (s.line.sans.length === 0 && moreIdeas(s)) return "idea";
  const cards = nowCards(s);
  if (!cards.length && s.line.sans.length > 0) return "situation";
  return cards.some((c) => c.title.startsWith("The move")) ? null : "move";
}

/**
 * The next hint. Endings with written ideas give them from the start position; once the student has
 * played on, hints are about the board in front of them (now.ts): first what's going on, then the
 * move. Other endings show their one-line hint and the engine's move as an arrow.
 */
export async function endgameHint() {
  const s = get();
  if (!s || s.status !== "playing" || s.hinting) return;
  const kind = nextHint(s);
  if (!kind) return;
  if (kind === "idea") return set({ ideas: s.ideas + 1, shapes: [] });
  const e = endgameOf(s);
  const fen = s.line.fens[s.line.sans.length];
  if (e.ideas) {
    set({ hinting: true });
    try {
      const card = kind === "situation" ? await situationCard(fen, e.side) : await moveCard(fen);
      const now = get();
      if (card && now && now.line.fens[now.line.sans.length] === fen) set({ now: { fen, cards: [...nowCards(now), card] } });
    } catch (err) {
      console.error("no hint", err);
    } finally {
      if (get()) set({ hinting: false });
    }
    return;
  }
  set({ hint: true });
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
    detail: `student plays ${e.side} against full-strength Stockfish and must ${goal}; ${s.moves} moves played, ${s.status}${s.message ? `; the trainer's message: "${s.message}"` : ""}` +
      (s.hint ? `; the student asked for the hint, shown under the board: "${e.hint}" (with the engine's move as an arrow)` : "") +
      (s.ideas ? `; ideas shown so far (one per hint, about the start position): ${e.ideas!.slice(0, s.ideas).map((i) => `${i.title}: ${i.text}`).join(" / ")}` : ""),
  };
}
