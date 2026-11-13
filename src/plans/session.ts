// A "find the plan" session on the main board: a quiet position from the student's own game, where
// the engine's move is positional. The student plays the move they'd make; the engine grades it the
// way guess-the-move does (as good, a little worse, clearly worse), and the reveal shows the plan:
// the engine's next few moves for the student's side, drawn, in words (describe.ts), with what the
// student's move gives up in the position itself (analysis/positional.ts). The coach can explain the
// plan on request, in the opening plans' shape (two or three ideas, each drawn on the board).
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { create } from "zustand";
import { emptyLine, playAt, type Line } from "../chess/line";
import { stepView, viewedPly, type Step } from "../chess/view";
import { lossFromEvals } from "../analysis/review";
import { positionalCost } from "../analysis/positional";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import { evalWords, storedEval, topMoves } from "../coach/insight";
import { invoke, hasBackend } from "../backend";
import { pushTrainer, trainerGeneration } from "../coach/trainerChat";
import { canExplain, evalText, parseIdeas } from "../openings/explain";
import type { PlanIdea } from "../openings/plans";
import { stopPuzzles } from "../puzzles/session";
import { stopDrills } from "../analysis/drillSession";
import { stopEndgame } from "../endgames/session";
import { stopOpening } from "../openings/session";
import { stopGuess } from "../guess/session";
import { keepSession } from "../persist";
import { fenKey } from "../training/games";
import { describePlan, lineEnd, moveText, type PlanText } from "./describe";
import { isQuiet, recordPlan, skipPlan, type PlanPosition } from "./positions";

const DEPTH = 16;

interface Scored {
  uci: string;
  san: string;
  /** White's view, centipawns. */
  cp: number;
  pv: string[];
}

type SimpleShape = { orig: Key; dest?: Key; brush: string };

export interface PlanSession {
  queue: PlanPosition[];
  index: number;
  line: Line;
  status: "loading" | "solving" | "checking" | "right" | "close" | "wrong" | "done";
  message: string;
  best: Scored | null;
  played: Scored | null;
  /** The engine's plan, and (after a miss) what the student's move is about. */
  plan: PlanText | null;
  mine: PlanText | null;
  /** What the student's move costs in the position itself, as clauses. */
  facts: string[];
  shapes: SimpleShape[];
  hint: boolean;
  ideas: PlanIdea[] | null;
  ideaIndex: number;
  explaining: boolean;
  view: number | null;
  /** Answered positions in this sitting, and how many were found. */
  answered: number;
  found: number;
}

export const usePlan = create<PlanSession | null>(() => null);
const get = () => usePlan.getState();
const set = (patch: Partial<PlanSession>) => usePlan.setState(patch);

export const planOf = (s: PlanSession): PlanPosition | undefined => s.queue[s.index];
export const answered = (s: PlanSession) => s.status === "right" || s.status === "close" || s.status === "wrong";

export function startPlans(queue: PlanPosition[], index = 0) {
  if (!queue[index]) return;
  stopPuzzles();
  stopDrills();
  stopEndgame();
  stopOpening();
  stopGuess();
  usePlan.setState(fresh(queue, index, 0, 0), true);
  load();
}

function fresh(queue: PlanPosition[], index: number, answeredN: number, found: number): PlanSession {
  return {
    queue,
    index,
    line: emptyLine(queue[index].fen),
    status: "loading",
    message: "",
    best: null,
    played: null,
    plan: null,
    mine: null,
    facts: [],
    shapes: [],
    hint: false,
    ideas: null,
    ideaIndex: 0,
    explaining: false,
    view: null,
    answered: answeredN,
    found,
  };
}

export const stopPlans = () => usePlan.setState(null, true);

/** Restores the last session (if any) and keeps saving it, for a phone that dropped the page. Call once at startup. */
export const initPlanSession = () =>
  keepSession(usePlan, "cc-plan", (s) => !!(s.queue?.[s.index]?.fen && s.line?.fens), (saved) => {
    usePlan.setState({ ...saved, explaining: false }, true);
    // The engine was looking at the position or the answer: start this position over.
    if (saved.status === "loading" || saved.status === "checking") {
      usePlan.setState(fresh(saved.queue, saved.index, saved.answered, saved.found), true);
      load();
    }
  });

const sanOf = (fen: string, uci: string) => {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
};

/** The engine's top moves in the position; a position that turns out tactical is skipped for good. */
async function load() {
  const s = get();
  const p = s && planOf(s);
  if (!s || !p) return;
  let lines: EngineLine[] = [];
  try {
    lines = await getReviewEngine().analyze(p.fen, 3, DEPTH);
  } catch (e) {
    console.error("plan position not analyzed", e);
  }
  const now = get();
  if (!now || now.line !== s.line) return;
  const top = lines[0];
  const uci = top?.pv[0];
  const san = uci && sanOf(p.fen, uci);
  if (!top || !uci || !san) return set({ status: "solving", message: "" });
  if (!isQuiet(p.fen, uci)) {
    skipPlan(p.id);
    return nextPlan(true);
  }
  set({ status: "solving", best: { uci, san, cp: storedEval(top), pv: top.pv }, plan: describePlan(p.fen, top.pv, p.color) });
}

/** The student's move: graded against the engine's, then the plan is shown. */
export async function planMove(from: Key, to: Key, promotion?: string) {
  const s = get();
  const p = s && planOf(s);
  if (!s || !p || s.status !== "solving" || s.view !== null || s.line.sans.length > 0) return;
  const played = playAt(s.line, 0, from, to, promotion);
  if (!played) return;
  const uci = `${from}${to}${played.san.includes("=") ? (promotion ?? "q") : ""}`;
  set({ line: played.line, status: "checking", message: `${played.san}… the engine is looking at it.`, shapes: [] });

  let best = s.best;
  let mine: Scored | null = null;
  try {
    if (!best) {
      const [top] = await getReviewEngine().analyze(p.fen, 1, DEPTH);
      const u = top?.pv[0];
      const san = u && sanOf(p.fen, u);
      if (top && u && san) best = { uci: u, san, cp: storedEval(top), pv: top.pv };
    }
    const after = played.line.fens[1];
    const chess = new Chess(after);
    if (chess.isCheckmate()) mine = { uci, san: played.san, cp: p.color === "white" ? 10000 : -10000, pv: [uci] };
    else if (chess.isDraw() || chess.isStalemate()) mine = { uci, san: played.san, cp: 0, pv: [uci] };
    else {
      const [reply] = await getReviewEngine().analyze(after, 1, DEPTH - 2);
      mine = { uci, san: played.san, cp: reply ? storedEval(reply) : 0, pv: [uci, ...(reply?.pv ?? [])] };
    }
  } catch (e) {
    console.error("plan move not graded", e);
  }
  const now = get();
  if (!now || now.line !== played.line) return;
  if (!best || !mine) return set({ status: "solving", line: emptyLine(p.fen), message: "The engine couldn't look at that. Try again." });

  const same = mine.uci.slice(0, 4) === best.uci.slice(0, 4);
  const loss = same ? 0 : lossFromEvals(best.cp, mine.cp, p.color);
  const status: PlanSession["status"] = loss < 3 ? "right" : loss < 8 ? "close" : "wrong";
  const facts =
    status === "right" ? [] : positionalCost(p.fen, lineEnd(p.fen, mine.pv), lineEnd(p.fen, best.pv), p.color).facts;
  const forMe = (cp: number) => evalText(p.color === "white" ? cp : -cp);
  const [me, eng] = [moveText(mine.san, p.color), moveText(best.san, p.color)];
  const message =
    same
      ? `${me}: the engine's move. That's the plan.`
      : status === "right"
        ? `${me}: as good as the engine's ${eng} (${forMe(mine.cp)} against ${forMe(best.cp)}). That fits the position too.`
        : status === "close"
          ? `${me} is playable (${forMe(mine.cp)}), but ${eng} is more to the point (${forMe(best.cp)}).`
          : `${me} misses the point (${forMe(mine.cp)}). The engine plays ${eng} (${forMe(best.cp)}).`;
  recordPlan(p.id, status);
  const plan = now.plan ?? describePlan(p.fen, best.pv, p.color);
  set({
    status,
    best,
    played: mine,
    plan,
    mine: status === "right" ? null : describePlan(p.fen, mine.pv, p.color),
    facts,
    message,
    // The plan's drawings on the position before the move; the student's move in red after a miss.
    shapes: [...((plan?.shapes ?? []) as SimpleShape[]), ...(status === "wrong" ? [{ orig: from, dest: to, brush: "red" }] : [])],
    view: 0,
    answered: now.answered + 1,
    found: now.found + (status === "wrong" ? 0 : 1),
  });
}

/** The engine's move as an arrow, and the first hint of what it's about. */
export function planHint() {
  const s = get();
  if (!s || s.status !== "solving" || !s.best) return;
  set({ hint: true, shapes: [{ orig: s.best.uci.slice(0, 2) as Key, brush: "green" }] });
}

/** On to the next position (`skipped`: this one wasn't a plan position after all). */
export function nextPlan(skipped = false) {
  const s = get();
  if (!s) return;
  const index = s.index + 1;
  if (!s.queue[index]) {
    return set({ status: "done", message: skipped ? "No more positions for now." : `That's all of them: you found ${s.found} of ${s.answered}.`, shapes: [] });
  }
  usePlan.setState(fresh(s.queue, index, s.answered, s.found), true);
  load();
}

/** Try the same position again, from the start. */
export function retryPlan() {
  const s = get();
  if (!s) return;
  usePlan.setState(fresh(s.queue, s.index, s.answered, s.found), true);
  load();
}

export function planStep(delta: Step) {
  const s = get();
  if (!s) return;
  set({ view: stepView(s.line.sans.length, s.view, delta) });
}

export const setPlanIdea = (i: number) => {
  const s = get();
  if (s?.ideas?.[i]) set({ ideaIndex: i });
};

// ---- The coach's explanation ----

const CACHE_KEY = "cc-plan-why";
const cacheKey = (fen: string, played: string) => `${fenKey(fen)}|${played}`;
function readCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function keep(key: string, text: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), [key]: text }));
  } catch {
    // Private mode or full: asked again next time.
  }
}

async function planPrompt(s: PlanSession, p: PlanPosition): Promise<string> {
  const top = await topMoves(p.fen, 3, 14);
  const pieces: Record<"w" | "b", string[]> = { w: [], b: [] };
  for (const row of new Chess(p.fen).board())
    for (const sq of row) if (sq) pieces[sq.color].push(`${sq.type === "p" ? "" : sq.type.toUpperCase()}${sq.square}`);
  const best = s.best!;
  const mine = s.played!;
  return [
    `A club player is doing a "find the plan" exercise (not a game) from a quiet position in one of their own games. They play ${p.color}.`,
    `Position (FEN, ${p.color} to move): ${p.fen}`,
    `Pieces: White: ${pieces.w.join(" ")}. Black: ${pieces.b.join(" ")}.`,
    `Engine (Stockfish) top moves: ${top.text}`,
    `Engine's move: ${best.san} (${evalWords(best.cp)}); its line for ${p.color}: ${s.plan?.text ?? best.san}`,
    `The student now played ${mine.san} (${evalWords(mine.cp)}). In the game they had played ${p.gameMove}.`,
    ...(s.facts.length ? [`What ${mine.san} costs in the position itself: ${s.facts.join("; ")}.`] : []),
    "",
    "Answer with 2 or 3 ideas, in exactly this format and nothing else:",
    "## <title, 2 to 6 words>",
    "<1 to 3 short sentences: the idea, then how it's carried out here>",
    "draw: <drawings on the position above>",
    "",
    `First idea: what the position is about (pawn structure, weak squares, the worst-placed piece, where each side plays). ` +
      `Then the plan behind ${best.san} and how it continues. ${mine.san === best.san ? "" : `If there's a third, what ${mine.san} misses or allows.`}`,
    "Drawings are space-separated tokens: g:e2e4 a green arrow (a move or pawn break for the player), b:g1f3 a blue arrow (a piece route), " +
      "r:d8h4 a red arrow (the opponent's idea), r:d4 a red circle (a target or weak square), y:a1h8 a yellow line (a diagonal or file), " +
      "y:d5 a yellow circle (a key square). Every green, blue and red arrow starts on a piece in the position above, or where an earlier arrow " +
      "of the same idea ends. 2 to 4 drawings per idea.",
    'Under 90 words in all. No preamble, no move lists. Write Black\'s moves with "..." (...Nf6) and White\'s without (Nf3). Everything you say agrees with the engine numbers above.',
  ].join("\n");
}

/** Asks the coach to explain the plan (cached answers show at once). */
export async function explainPlan() {
  const s = get();
  const p = s && planOf(s);
  if (!s || !p || !answered(s) || !s.best || !s.played || s.explaining || s.ideas) return;
  const gen = trainerGeneration();
  const key = cacheKey(p.fen, s.played.san);
  const line = s.line;
  const show = (text: string) => {
    if (get()?.line !== line) return;
    const ideas = parseIdeas(text, p.fen);
    set({ explaining: false, ideas, ideaIndex: 0, view: 0 });
    if (!ideas) {
      pushTrainer({ kind: "user", text: `What's the plan here? I played ${s.played!.san}, the engine plays ${s.best!.san}.` }, gen);
      pushTrainer({ kind: "coach", text }, gen);
    }
  };
  const hit = readCache()[key];
  if (hit) return show(hit);
  if (!canExplain()) {
    if (hasBackend()) pushTrainer({ kind: "system", text: "Sign in to the coach to have the plan explained." }, gen);
    return;
  }
  set({ explaining: true });
  try {
    const text = await invoke<string>("coach_explain", { prompt: await planPrompt(s, p) });
    if (text) keep(key, text);
    show(text);
  } catch (e) {
    console.error("plan explanation failed", e);
    if (get()?.line === line) set({ explaining: false });
    pushTrainer({ kind: "system", text: `No explanation this time: ${String(e)}` }, gen);
  }
}

/** What the coach sees for a question asked from the plan board. */
export function planContext(): { title: string; fen: string; detail: string } | null {
  const s = get();
  const p = s && planOf(s);
  if (!s || !p) return null;
  return {
    title: "Find the plan (a position from the student's own game)",
    fen: s.line.fens[viewedPly(s.line.sans.length, s.view)],
    detail:
      `the student plays ${p.color} and looks for the plan in a quiet position; in the game they played ${p.gameMove}` +
      (answered(s) && s.best && s.played
        ? `. They now played ${s.played.san}; the engine's move is ${s.best.san}`
        : ". It's the student's turn: don't reveal the engine's move"),
  };
}

export function planQuestion(): string {
  const s = get()!;
  const p = planOf(s)!;
  return answered(s) && s.best && s.played
    ? `In this position from my game (FEN ${p.fen}) I played ${s.played.san}, the engine prefers ${s.best.san}. What's the plan, and what does mine miss? Show it on the board, briefly.`
    : `I'm looking for a plan in this position from my game (FEN ${p.fen}), playing ${p.color}. Without telling me the move, what should I be thinking about?`;
}
