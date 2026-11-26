// An opening trainer session on the main board: the student plays their system against one of the
// replies in its training set, the computer answers from the book, and the session ends where the
// book line does. Move orders that come to the same thing are fine (order.ts). It's not a game: nothing is saved to the games list, and it can run alongside a
// rated game (whose clock waits meanwhile, see clock.ts).
import type { Key } from "chessground/types";
import { create } from "zustand";
import { buildLine, emptyLine, playAt, sideToMove, type Line } from "../chess/line";
import { stepView, viewedPly, type Step } from "../chess/view";
import { Chess } from "chess.js";
import { findSet, markSeen, type TrainingLine, type TrainingSet } from "./training";
import { stopPuzzles } from "../puzzles/session";
import { stopDrills } from "../analysis/drillSession";
import { stopGuess } from "../guess/session";
import { stopPlans } from "../plans/session";
import { stopEndgame } from "../endgames/session";
import { guideAt } from "./guides";
import { cachedExplanation, canExplain, CLOSE, compareMoves, evalText, explainOffLine, offLineFacts, parseIdeas, type MoveEvals } from "./explain";
import { legalNext, matchLine, reachable, sanIn, type Planned } from "./order";
import { planOf, type PlanIdea } from "./plans";
import { hasBackend } from "../backend";
import { moveLabel } from "../chess/line";
import { clearTrainerChat, pushTrainer, trainerGeneration } from "../coach/trainerChat";
import { judgePunish, planTrap, positionKey, trapHint, trapPlay, type Blunder, type Detour } from "./blunders";
import { settingRating, useSettings } from "../settings";
import { START_RATING } from "../rating";
import { keepSession } from "../persist";
import { structureById, structuresAt } from "./structures";
import { courseContext, courseHint, courseMove, resumeCourse, type CourseRun } from "./courseSession";

/** The student's move that left the line, the book move, and the engine on both (under the board). */
export interface OffLineWhy {
  played: string;
  book: string;
  evals: MoveEvals | null;
  /** The engine rates the student's move about as good as the book move: not a mistake, just not this line. */
  close: boolean;
  /** The student's move is in the line, only too early (and the engine says that costs something). */
  early: boolean;
  /** The student asked the coach why (explainOpening); the button goes once it has. */
  asked?: boolean;
  /** The coach is answering. */
  loading?: boolean;
  /** The coach's answer as ideas with drawings, shown like the line's plan (on the position before the move). */
  ideas?: PlanIdea[];
}

export interface OpeningSession {
  setId: string;
  /** The book line being followed; can change when the student transposes into another one. */
  target: TrainingLine;
  line: Line;
  status: "playing" | "thinking" | "done" | "off";
  message: string;
  shapes: { orig: Key; dest: Key; brush: string }[];
  view: number | null;
  why: OffLineWhy | null;
  /** The position (positionKey) where the opponent will play a stored mistake instead of the book move (blunders.ts), if any. */
  trapAt: string | null;
  /** The opponent's blunder on the board, waiting to be punished. */
  blunder: Blunder | null;
  /** The opponent left the book on a detour toward a trap (blunders.ts Route): the student's answer is due. */
  detour?: Detour | null;
  /** The ply whose move note (guides.ts) the student asked for with Hint; notes stay hidden otherwise. */
  noteAt?: number | null;
  /** The structure card (structures.ts) open under the board, if any. */
  structure?: string | null;
  /** The structures the board has already turned into this session. */
  structuresMet?: string[];
  /** The ones the latest move turned it into: their buttons are highlighted until the next move. */
  structuresNew?: string[];
  /** A study run through an opening course (courseSession.ts): its moves and hints go there. */
  course?: CourseRun | null;
}

export const useOpening = create<OpeningSession | null>(() => null);

const get = () => useOpening.getState();
const set = (patch: Partial<OpeningSession>) => useOpening.setState(patch);
export const openingSetOf = (s: OpeningSession): TrainingSet =>
  findSet(s.setId) ?? { id: s.setId, name: "Opening", color: "white", blurb: "", lines: [s.target] };

/** A book reply comes after a short pause, so it doesn't land on top of the student's move. */
const REPLY_MS = 450;


export function startOpening(setId: string, target: TrainingLine) {
  const set = findSet(setId);
  if (!set) return;
  stopPuzzles();
  stopDrills();
  stopGuess();
  stopPlans();
  stopEndgame();
  markSeen(target);
  // A line that starts deeper (startNearSplit) has its first moves on the board already.
  const built = target.start ? buildLine(emptyLine().startFen, target.moves.slice(0, target.start)) : null;
  const line = built && "line" in built ? built.line : emptyLine();
  const start = line.sans.length;
  const trap = planTrap(target, set.color, start, studentRating());
  const message = start ? `Starting after ${moveLabelAt(target.moves, start - 1)}, with the setup on the board. Step back to see how it got here.` : "";
  useOpening.setState(
    { setId, target, line, status: "playing", message, shapes: [], view: null, why: null, trapAt: trap, blunder: null, detour: null },
    true,
  );
  if (sideToMove(line.fens[start]) !== set.color) reply();
}

/** Restores the last session (if any) and keeps saving it, for a phone that dropped the page. Call once at startup. */
export function initOpeningSession() {
  keepSession(useOpening, "cc-opening", (s) => !!(s.setId && s.target?.moves && s.line?.fens), resume);
  useOpening.subscribe(noticeStructures);
}

/**
 * When the board turns into a structure the session hasn't met yet (a Pirc, a King's Indian, Bc4 in
 * the Pirc...), its button under the board lights up for a move: whatever move order got there, the
 * student sees what kind of game it is now. The card itself opens only when asked: opening it by
 * itself took over the board in the middle of the line.
 */
function noticeStructures(s: OpeningSession | null, prev: OpeningSession | null) {
  if (!s || s.line === prev?.line) return;
  const met = s.structuresMet ?? [];
  const here = structuresAt(s.line.fens[s.line.sans.length], openingSetOf(s).color);
  const fresh = here.filter((x) => !met.includes(x.id)).map((x) => x.id);
  if (fresh.length) set({ structuresMet: [...met, ...fresh], structuresNew: fresh });
  else if (s.structuresNew?.length) set({ structuresNew: [] });
}

export const openStructure = (id: string) => set({ structure: id });
export const closeStructure = () => set({ structure: null });

/** Picks a saved session back up, redoing whatever the computer was in the middle of when the page went away. */
function resume(saved: OpeningSession) {
  if (saved.course) return resumeCourse(saved);
  // The set's own line object: the session tells lines apart by identity.
  const target =
    findSet(saved.setId)?.lines.find((l) => l.name === saved.target.name && l.moves.join(" ") === saved.target.moves.join(" ")) ??
    saved.target;
  const why = saved.why ? { ...saved.why, loading: false } : null;
  const thinking = saved.status === "thinking";
  useOpening.setState({ ...saved, target, why, status: thinking ? "playing" : saved.status }, true);
  if (!thinking) return;
  const s = get()!;
  const ply = s.line.sans.length;
  if (sideToMove(s.line.fens[ply]) === openingSetOf(s).color) return;
  // The student had answered the opponent's mistake and the engine was judging it.
  if (s.blunder && ply > 0) return punishMove(s, s.blunder, s.line, s.line.sans[ply - 1]);
  // The opponent was about to play its mistake after a detour.
  if (s.trapAt === positionKey(s.line.fens[ply])) return reply();
  // The opponent was about to reply, or the engine was still weighing a move off the line: that
  // move is taken back to play again, rather than let through unjudged.
  if (reachable(s.target, s.line)) return reply();
  set({ line: lineBefore(s.line), message: "", shapes: [] });
}

/** The rating the opponent's mistakes are picked for: the student's rapid rating. */
const studentRating = () => settingRating(useSettings.getState(), "rapid") ?? START_RATING;

/** "8...Ne7" for the move at `ply` of a move list. */
const moveLabelAt = (moves: string[], ply: number) => `${Math.floor(ply / 2) + 1}${ply % 2 ? "..." : "."}${moves[ply]}`;

export function stopOpening() {
  if (!get()) return;
  useOpening.setState(null, true);
  clearTrainerChat();
}
export const retryOpening = () => {
  const s = get();
  if (s) startOpening(s.setId, s.target);
};

function uciOf(fen: string, san: string): { from: Key; to: Key } | null {
  try {
    const m = new Chess(fen).move(san);
    return { from: m.from as Key, to: m.to as Key };
  } catch {
    return null;
  }
}

/** The line is over once all its moves are on the board, in whatever order. */
function finished(s: OpeningSession, line: Line): boolean {
  if (matchLine(s.target, line).remaining.length) return false;
  const plan = planOf(s.target);
  set({
    status: "done",
    message: plan
      ? `End of the book line: ${s.target.name}. Here's what you're playing for from here.`
      : `End of the book line: ${s.target.name}. From here it's a middlegame.`,
    shapes: [],
  });
  return true;
}

/**
 * The plan for the position on the board: only once the whole line is on it, since the plan's
 * drawings are made for the line's final position.
 */
export function openingPlan(s: OpeningSession): PlanIdea[] | null {
  if (s.status !== "done" || matchLine(s.target, s.line).remaining.length) return null;
  return planOf(s.target);
}

/** The student's next book move here: the first of their remaining line moves that's legal. */
function bookNext(s: OpeningSession, line = s.line): Planned | null {
  const fen = line.fens[line.sans.length];
  return legalNext(matchLine(s.target, line).remaining, openingSetOf(s).color, fen)[0] ?? null;
}

const playedMatches = (p: Planned, from: Key, to: Key) => p.from === from && p.to === to;

export async function openingMove(from: Key, to: Key, promotion?: string) {
  const s = get();
  if (s?.course) return courseMove(from, to, promotion);
  if (!s || s.status !== "playing" || s.view !== null) return;
  const lines = openingSetOf(s).lines;
  const color = openingSetOf(s).color;
  const ply = s.line.sans.length;
  const fen = s.line.fens[ply];
  if (sideToMove(fen) !== color) return;
  const played = playAt(s.line, ply, from, to, promotion);
  if (!played) return;
  const line = played.line;
  if (s.blunder) return punishMove(s, s.blunder, line, played.san);
  if (s.detour) return detourMove(s, s.detour, line, played.san);
  const book = bookNext(s);

  // The book move of this line, or of another line of the set (a move order the student knows).
  if (book && playedMatches(book, from, to)) return accept(s, s.target, line, "");
  const other = lines
    .filter((l) => l !== s.target && reachable(l, line))
    .filter((l) => {
      const next = legalNext(matchLine(l, s.line).remaining, color, fen)[0];
      return next && playedMatches(next, from, to);
    })
    .sort((x, y) => y.weight - x.weight)[0];
  if (other) return accept(s, other, line, `That's ${other.name} now.`);

  // Not the next book move. A move the line (or another of the set) plays later is fine when the
  // engine says the order costs nothing; anything else leaves the line.
  set({ line, status: "thinking", message: "", shapes: [] });
  const bookSan = book ? sanIn(fen, book) : null;
  let evals: MoveEvals | null = null;
  if (bookSan) {
    try {
      evals = await compareMoves(fen, played.san, bookSan, color);
    } catch (e) {
      console.error("move comparison failed", e);
    }
  }
  if (get()?.line !== line) return;
  const close = !evals || evals.book - evals.played <= CLOSE;
  const fits = [s.target, ...lines.filter((l) => l !== s.target)].filter(
    (l) => l.moves.length > ply && reachable(l, line),
  );
  if (fits.length && close) {
    const target = fits.includes(s.target) ? s.target : [...fits].sort((x, y) => y.weight - x.weight)[0];
    return accept(s, target, line, `${played.san} early: a different move order, same idea. Fine.`);
  }
  if (!bookSan) return accept(s, s.target, line, "");

  const arrow = uciOf(fen, bookSan);
  const early = fits.length > 0;
  set({
    line,
    status: "off",
    message: close
      ? `${played.san} is playable too (the engine rates it about the same), but it isn't this line. The book move here is ${bookSan}.`
      : early
        ? `${played.san} comes later in this line; played now it costs something. The book move here is ${bookSan}.`
        : `${played.san} leaves the line. The book move here is ${bookSan}.`,
    shapes: arrow ? [{ orig: arrow.from, dest: arrow.to, brush: "green" }] : [],
    why: { played: played.san, book: bookSan, evals, close, early },
  });
  // The engine's numbers go under the board at once; the coach explains only when asked (explainOpening),
  // since a call on every slip was noisy and cost a coach turn each time.
  fillEvals(s, line, played.san, bookSan, early).catch((e) => console.error("opening facts failed", e));
}

/** How often players at the student's level fall for it, as Maia sees it. */
const common = (b: Blunder) => `${Math.max(1, Math.round(b.p * 100))}% of players at your level play it here`;

/** `sans` numbered from ply `at` of the game ("9.Nxc6 bxc6 10.Bxd6"), so the message's moves can be hovered. */
const numberedFrom = (at: number, sans: string[]) =>
  sans
    .map((x, i) => ((at + i) % 2 === 0 ? `${(at + i) / 2 + 1}.${x}` : i === 0 ? `${Math.floor((at + i) / 2) + 1}...${x}` : x))
    .join(" ");

/** The opponent's next move in the played-out punishment (`b.cont`), after the usual pause. */
function contReply(b: Blunder, line: Line, k: number) {
  window.setTimeout(() => {
    const now = get();
    if (!now || now.line !== line) return;
    const ply = line.sans.length;
    let m: { from: string; to: string; promotion?: string } | null = null;
    try {
      m = new Chess(line.fens[ply]).move(b.cont[k]);
    } catch {
      m = null;
    }
    const played = m && playAt(line, ply, m.from as Key, m.to as Key, m.promotion);
    if (!played) return set({ status: "done", message: punishedText(b) });
    set({ line: played.line, view: null, status: "playing" });
  }, REPLY_MS);
}

const punishedText = (b: Blunder) =>
  `Punished. ${b.san} was a mistake (${common(b)}): ${numberedFrom(b.at, b.cont)} wins it (${evalText(b.bestEval)} for you).`;

/**
 * The student's answer to the opponent's blunder. The stored punishment is played out to where the
 * win is on the board (b.cont): the student finds each of their moves and the opponent defends, so the
 * point of the tactic gets played, not just its first move. Any other move the engine judges.
 */
async function punishMove(s: OpeningSession, b: Blunder, line: Line, san: string) {
  // Which of the continuation's moves this was (even: the student's).
  const k = line.sans.length - 1 - b.at;
  const expected = b.cont[k];
  if (san === expected) {
    if (k + 1 >= b.cont.length) return set({ line, status: "done", message: punishedText(b), shapes: [] });
    set({
      line,
      status: "thinking",
      message: k === 0 ? `${san}! ${b.san} was a mistake. Keep going: there's more to it.` : `${san}, right. Keep going.`,
      shapes: [],
    });
    return contReply(b, line, k + 1);
  }
  if (k > 0) return contSlip(s, b, line, san, expected);
  set({ line, status: "thinking", message: "", shapes: [] });
  const color = openingSetOf(s).color;
  let verdict: { eval: number; ok: boolean } | null = null;
  try {
    verdict = await judgePunish(b, line.fens[line.sans.length], san, color);
  } catch (e) {
    console.error("blunder check failed", e);
  }
  if (get()?.line !== line) return;
  if (!verdict || verdict.ok) {
    return set({
      status: "done",
      message:
        san === b.best
          ? `Punished. ${b.san} was a mistake (${common(b)}) and ${san} cashes in (${evalText(verdict?.eval ?? b.bestEval)} for you).`
          : `Punished. ${b.san} was a mistake (${common(b)}); ${san} keeps the gain (${evalText(verdict?.eval ?? b.bestEval)} for you; the engine's choice was ${b.best}).`,
      shapes: [],
    });
  }
  set({
    status: "off",
    message: `${b.san} was a mistake (${common(b)}), and ${san} lets it go (${evalText(verdict.eval)} for you). ${b.best} wins: ${evalText(b.bestEval)}. Look for what your opponent just left loose.`,
    shapes: [{ orig: b.bestMove.from, dest: b.bestMove.to, brush: "green" }],
    why: null,
  });
}

/**
 * The student's answer to the opponent's detour: the expected move walks on into the trap, an
 * engine-equal one is fine but ends the session (no trap after it), anything worse is a slip.
 */
async function detourMove(s: OpeningSession, d: Detour, line: Line, san: string) {
  if (san === d.reply) {
    set({ line, detour: null, trapAt: d.trapKey, status: "playing", message: "", shapes: [], why: null });
    return reply();
  }
  const fen = s.line.fens[s.line.sans.length];
  const color = openingSetOf(s).color;
  set({ line, status: "thinking", message: "", shapes: [] });
  let evals: MoveEvals | null = null;
  try {
    evals = await compareMoves(fen, san, d.reply, color);
  } catch (e) {
    console.error("detour check failed", e);
  }
  if (get()?.line !== line) return;
  if (!evals || evals.book - evals.played <= CLOSE)
    return set({
      status: "done",
      detour: null,
      message: `${san} is a fine answer to ${d.lead} too (about as good as ${d.reply}). Off the book from here: it's a middlegame.`,
    });
  const arrow = uciOf(fen, d.reply);
  set({
    status: "off",
    message: `${san} costs something after ${d.lead} (${evalText(evals.played)} for you). ${d.reply} was the move (${evalText(evals.book)}).`,
    shapes: arrow ? [{ orig: arrow.from, dest: arrow.to, brush: "green" }] : [],
    why: null,
  });
}

/** A move other than the continuation's, partway through the punishment: fine if it keeps the gain. */
async function contSlip(s: OpeningSession, b: Blunder, line: Line, san: string, expected: string) {
  const before = line.fens[line.sans.length - 1];
  set({ line, status: "thinking", message: "", shapes: [] });
  let verdict: { eval: number; ok: boolean } | null = null;
  try {
    verdict = await judgePunish({ ...b, best: expected }, line.fens[line.sans.length], san, openingSetOf(s).color);
  } catch (e) {
    console.error("blunder check failed", e);
  }
  if (get()?.line !== line) return;
  if (!verdict || verdict.ok)
    return set({
      status: "done",
      message: `Punished. ${b.san} was a mistake (${common(b)}), and ${san} keeps the gain (${evalText(verdict?.eval ?? b.bestEval)} for you; the engine went ${numberedFrom(line.sans.length - 1, b.cont.slice(line.sans.length - 1 - b.at))}).`,
      shapes: [],
    });
  const arrow = uciOf(before, expected);
  set({
    status: "off",
    message: `${san} lets the win go (${evalText(verdict.eval)} for you). ${expected} keeps going: ${evalText(b.bestEval)}.`,
    shapes: arrow ? [{ orig: arrow.from, dest: arrow.to, brush: "green" }] : [],
    why: null,
  });
}

/** The student's move stands: on with `target`, and the computer replies unless the line is over. */
function accept(before: OpeningSession, target: TrainingLine, line: Line, message: string) {
  set({ line, target, message, shapes: [], status: "playing", why: null });
  if (!finished({ ...before, target }, line)) reply();
}

/** "Why not …?" after leaving the line: the coach's explanation, on request (cached answers show at once). */
export function explainOpening() {
  const s = get();
  if (!s || s.status !== "off" || !s.why || s.why.asked) return;
  set({ why: { ...s.why, asked: true } });
  const before: OpeningSession = { ...s, line: lineBefore(s.line) };
  explainOff(before, s.line, s.why.played, s.why.book, s.why.early);
}

function lineBefore(line: Line): Line {
  const ply = line.sans.length - 1;
  return {
    ...line,
    sans: line.sans.slice(0, ply),
    fens: line.fens.slice(0, ply + 1),
    lastMoves: line.lastMoves.slice(0, ply),
    notes: line.notes.slice(0, ply),
  };
}

/** The engine's numbers for the slip, under the board, without asking the coach. */
async function fillEvals(before: OpeningSession, line: Line, played: string, book: string, early: boolean) {
  const facts = await offLineFacts(openingSetOf(before), before.target, before.line, played, book, early);
  const why = get()?.why;
  if (get()?.line === line && why) set({ why: { ...why, evals: facts.evals } });
}

/**
 * The coach's "why", in the shape of the line plans: two or three short ideas, each drawn on the
 * position before the student's move (explain.ts parseIdeas), shown under the board. At once from
 * this device's cache, otherwise while the coach answers. An answer that doesn't parse goes to the
 * chat column as text.
 */
async function explainOff(before: OpeningSession, line: Line, played: string, book: string, early = false) {
  const gen = trainerGeneration();
  const fen = before.line.fens[before.line.sans.length];
  const slip = { target: before.target, fen, played, book };
  const show = (text: string) => {
    const why = get()?.why;
    if (get()?.line !== line || !why) return;
    const ideas = parseIdeas(text, fen);
    set({ why: { ...why, loading: false, ideas: ideas ?? undefined } });
    if (!ideas) {
      pushTrainer({ kind: "user", text: `Why not ${moveLabel(fen, played)}? The book move is ${moveLabel(fen, book)}.` }, gen);
      pushTrainer({ kind: "coach", text }, gen);
    }
  };
  const hit = cachedExplanation(slip);
  if (hit) return show(hit);
  if (!canExplain()) {
    if (hasBackend()) pushTrainer({ kind: "system", text: "Sign in to the coach to have this explained." }, gen);
    return;
  }
  const why = get()?.why;
  if (why) set({ why: { ...why, loading: true } });
  try {
    const facts = await offLineFacts(openingSetOf(before), before.target, before.line, played, book, early);
    show(await explainOffLine(slip, facts.prompt));
  } catch (e) {
    console.error("opening explanation failed", e);
    const now = get()?.why;
    if (get()?.line === line && now) set({ why: { ...now, loading: false } });
    pushTrainer({ kind: "system", text: `No explanation this time: ${String(e)}` }, gen);
  }
}

/** The opponent's next book move: its first remaining line move that's legal in this move order. */
function reply() {
  const s = get();
  if (!s) return;
  set({ status: "thinking" });
  window.setTimeout(() => {
    const now = get();
    if (!now || now.line !== s.line) return;
    const ply = now.line.sans.length;
    const fen = now.line.fens[ply];
    // Follow a line that can still be finished from here: this one, else the likeliest of the set's.
    const target = reachable(now.target, now.line)
      ? now.target
      : [...openingSetOf(now).lines].sort((x, y) => y.weight - x.weight).find((l) => reachable(l, now.line));
    if (target && target !== now.target) set({ target });
    const next = (target && legalNext(matchLine(target, now.line).remaining, sideToMove(fen), fen)[0]) || null;
    if (now.trapAt === positionKey(fen)) return trapReply(now, next);
    const played = next && playAt(now.line, ply, next.from, next.to, next.promotion);
    if (!played) {
      return set({
        status: "done",
        message: `This move order steps out of the book here, with the setup of ${now.target.name} in place. From here it's a middlegame.`,
      });
    }
    set({ line: played.line, view: null, status: "playing" });
    finished(get()!, played.line);
  }, REPLY_MS);
}

/**
 * The opponent's stored mistake, or a detour toward one, instead of `next`, the book move (played
 * when there's neither after all; off the book there may be no book move either).
 */
function trapReply(s: OpeningSession, next: Planned | null) {
  const ply = s.line.sans.length;
  const fen = s.line.fens[ply];
  const pick = trapPlay(fen, studentRating());
  const san = pick && ("blunder" in pick ? pick.blunder.san : pick.detour.lead);
  const move = san && uciOf(fen, san);
  const played = move ? playAt(s.line, ply, move.from, move.to) : next && playAt(s.line, ply, next.from, next.to, next.promotion);
  if (!played) {
    set({ trapAt: null });
    return next
      ? set({ status: "playing" })
      : set({ status: "done", message: "Off the book from here: it's a middlegame." });
  }
  const blunder = move && pick && "blunder" in pick ? { ...pick.blunder, at: played.line.sans.length } : null;
  const detour = move && pick && "detour" in pick ? pick.detour : null;
  set({
    line: played.line,
    view: null,
    status: "playing",
    trapAt: null,
    blunder,
    detour,
    message: detour ? `${detour.lead}: your opponent leaves the book. Find a good answer.` : "",
  });
  if (!move) finished(get()!, played.line);
}

/** Back to just before the student's wrong move, to find the book move. */
export function openingTakeBack() {
  const s = get();
  if (!s || s.status !== "off") return;
  set({ line: lineBefore(s.line), status: "playing", message: "", view: null, why: null, shapes: [] });
}

/**
 * The note under the board: the one the student asked for with Hint (the trap's or detour's while
 * one is on the board, else the line's move note), or after a wrong move the line's note for it.
 */
export function shownNote(s: OpeningSession): { text: string; draw: string } | null {
  const len = s.line.sans.length;
  if (s.status === "playing" && s.noteAt === len) return trapHint(s.blunder, s.detour, len) ?? (s.blunder || s.detour ? null : guideAt(s.target, len));
  if (s.status === "off" && s.why) return guideAt(s.target, len - 1);
  return null;
}

/** The student's next book move, as an arrow. */
export function openingHint() {
  const s = get();
  if (s?.course) return courseHint();
  if (!s || s.status !== "playing") return;
  // Off the book (the opponent's mistake or detour): what it's about first, the arrow on a second press.
  if ((s.blunder || s.detour) && s.noteAt !== s.line.sans.length && trapHint(s.blunder, s.detour, s.line.sans.length))
    return set({ noteAt: s.line.sans.length, shapes: [] });
  if (s.blunder) {
    // The continuation's move due now (the first is the punishment itself).
    const due = s.blunder.cont?.[s.line.sans.length - (s.blunder.at ?? s.line.sans.length)] ?? s.blunder.best;
    const arrow = uciOf(s.line.fens[s.line.sans.length], due);
    return set({ shapes: arrow ? [{ orig: arrow.from, dest: arrow.to, brush: "green" }] : [] });
  }
  if (s.detour) {
    const arrow = uciOf(s.line.fens[s.line.sans.length], s.detour.reply);
    return set({ shapes: arrow ? [{ orig: arrow.from, dest: arrow.to, brush: "green" }] : [] });
  }
  // A line with move notes gives the idea first (with its drawings); the arrow comes on a second press.
  const ply = s.line.sans.length;
  if (s.noteAt !== ply && guideAt(s.target, ply)) return set({ noteAt: ply, shapes: [] });
  const next = bookNext(s);
  if (next) set({ shapes: [{ orig: next.from, dest: next.to, brush: "green" }] });
}

export function openingStep(delta: Step) {
  const s = get();
  if (!s) return;
  // Looking back at the moves holds a right course answer that was about to move on.
  if (s.course?.autoNextAt) set({ course: { ...s.course, autoNextAt: null } });
  set({ view: stepView(s.line.sans.length, s.view, delta) });
}

/** What the coach sees for a question asked from the opening board. */
export function openingContext(): { title: string; fen: string; detail: string } | null {
  const s = get();
  if (!s) return null;
  const set = openingSetOf(s);
  // The coach should agree with the plan the trainer is showing.
  const plan = openingPlan(s);
  const shown = plan ? `; the trainer shows this plan for the student's side: ${plan.map((i) => `${i.title}: ${i.text}`).join(" | ")}` : "";
  const why = s.why?.ideas ? `; the trainer explained why ${s.why.book}, not ${s.why.played}: ${s.why.ideas.map((i) => `${i.title}: ${i.text}`).join(" | ")}` : "";
  // What the student is reading under the board: the trainer's message, and the hint they asked for.
  const note = shownNote(s);
  const trapWhy = s.blunder?.note && s.status !== "playing" && s.status !== "thinking" ? `; why the opponent's mistake ${s.blunder.san} loses: "${s.blunder.note.why}"` : "";
  const message = s.message ? `; the trainer's message: "${s.message}"` : "";
  const hint = note ? `; the move note shown (Hint): "${note.text}"` : "";
  const card = s.structure ? structureById(s.structure) : null;
  const structure = card ? `; the trainer shows a card "${card.name}": ${card.ideas.map((i) => `${i.title}: ${i.text}`).join(" | ")}` : "";
  const course = s.course ? courseContext(s.course) : "";
  const arrows = s.shapes.length ? `; the trainer's arrow on the board shows ${s.shapes.map((a) => `${a.orig}-${a.dest}`).join(", ")} (the book move: from Hint, or after a wrong move)` : "";
  return {
    title: `Opening trainer: ${s.target.name}`,
    fen: s.line.fens[viewedPly(s.line.sans.length, s.view)],
    detail: `student plays the ${set.name} as ${set.color} against the book line ${s.target.moves.join(" ")}; moves so far: ${s.line.sans.join(" ") || "(none)"}; ${s.status}${message}${hint}${trapWhy}${structure}${arrows}${shown}${why}${course}`,
  };
}
