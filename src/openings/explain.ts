// Why a move left the opening line: the engine's verdict on the student's move and the book move
// (computed, so the coach reports it rather than guessing), then the coach's one-off explanation of
// the theory: what the student's move gives up, why the book move is played, what the line is for.
// Answers are kept on this device, so the same slip doesn't cost another coach call.
import { Chess, type Square } from "chess.js";
import type { PlanIdea } from "./plans";
import { invoke, hasBackend } from "../backend";
import { useAuth } from "../coach/auth";
import { evalWords, storedEval, topMoves } from "../coach/insight";
import { formatMoves, moveLabel, type Line } from "../chess/line";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import type { TrainingLine, TrainingSet } from "./training";

const DEPTH = 14;

export interface MoveEvals {
  /** Centipawns for the student after each move (mates as ±(10000 − distance)). */
  book: number;
  played: number;
}

const forStudent = (white: number, color: "white" | "black") => (color === "white" ? white : -white);

function uciToSan(fen: string, uci: string | undefined): string | null {
  if (!uci) return null;
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

async function after(fen: string, san: string): Promise<{ fen: string; line: EngineLine | undefined }> {
  const chess = new Chess(fen);
  chess.move(san);
  const next = chess.fen();
  const [line] = await getReviewEngine().analyze(next, 1, DEPTH);
  return { fen: next, line };
}

/** Within this many centipawns (the student's view) a move counts as just as good as the book move. */
export const CLOSE = 35;

/** The engine on the student's move and the book move, each from the position it leads to, the student's view. */
export async function compareMoves(fen: string, played: string, book: string, color: "white" | "black"): Promise<MoveEvals> {
  const [b, p] = await Promise.all([after(fen, book), after(fen, played)]);
  return {
    book: forStudent(b.line ? storedEval(b.line) : 0, color),
    played: forStudent(p.line ? storedEval(p.line) : 0, color),
  };
}

/** "+0.35" / "−1.20" / "mates in 3", the student's side. */
export function evalText(cp: number): string {
  if (Math.abs(cp) >= 9000) return cp > 0 ? `mates in ${10000 - cp}` : `gets mated in ${10000 + cp}`;
  return `${cp >= 0 ? "+" : "−"}${(Math.abs(cp) / 100).toFixed(2)}`;
}

export interface OffLineFacts {
  evals: MoveEvals;
  prompt: string;
}

/** The engine's view of both moves, and the question for the coach built on it. */
export async function offLineFacts(
  set: TrainingSet,
  target: TrainingLine,
  before: Line,
  played: string,
  book: string,
  /** The student's move is one the line plays later: a move order that doesn't work here. */
  early = false,
): Promise<OffLineFacts> {
  const fen = before.fens[before.sans.length];
  const [b, p, top] = await Promise.all([after(fen, book), after(fen, played), topMoves(fen, 3, DEPTH)]);
  const white = { book: b.line ? storedEval(b.line) : 0, played: p.line ? storedEval(p.line) : 0 };
  const evals = { book: forStudent(white.book, set.color), played: forStudent(white.played, set.color) };
  const reply = (r: { fen: string; line: EngineLine | undefined }) => {
    const san = uciToSan(r.fen, r.line?.pv[0]);
    return san ? `, best reply ${moveLabel(r.fen, san)}` : "";
  };
  const diff = evals.book - evals.played;
  const verdict =
    Math.abs(diff) <= CLOSE
      ? "The engine rates the two moves about the same."
      : diff > 0
        ? `The book move is better by ${(diff / 100).toFixed(2)} pawns for the student.`
        : `The engine slightly prefers the student's move (by ${(-diff / 100).toFixed(2)} pawns); the book move is the one the line is built on.`;
  const numbered = (moves: string[]) => moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");

  const prompt = [
    `A club player is practising the ${set.name} as ${set.color} in an opening trainer (not a game).`,
    `The book line they're training: ${target.name}: ${numbered(target.moves)}`,
    `Moves so far: ${before.sans.length ? formatMoves(before) : "(none)"}`,
    `Position before their move (FEN): ${fen}`,
    `They played ${moveLabel(fen, played)}; the book move is ${moveLabel(fen, book)}.`,
    `Engine (Stockfish, depth ${DEPTH}), position after each move:`,
    `- book ${book}: ${evalWords(white.book)}${reply(b)}`,
    `- their ${played}: ${evalWords(white.played)}${reply(p)}`,
    `Engine's top moves in the position: ${top.text}`,
    verdict,
    ...(early ? [`${played} is a move this line plays later: the student played it too early, and the engine says the move order costs something here.`] : []),
    "",
    `Pieces in that position: ${pieceList(fen)}`,
    "",
    ...IDEAS_FORMAT(played, book),
  ].join("\n");
  return { evals, prompt };
}

/**
 * How the answer is laid out: the same shape as the trainer's own move notes and line plans, which
 * read well because they're short, about one thing each, and drawn on the board. Read by parseIdeas.
 */
const IDEAS_FORMAT = (played: string, book: string) => [
  "Answer with 2 or 3 ideas, in exactly this format and nothing else:",
  "## <title, 2 to 6 words>",
  "<1 to 3 short sentences: the idea, then how it's carried out here>",
  "draw: <drawings on the position above, before their move>",
  "",
  `First idea: what ${played} gives up or allows (if the engine rates it about the same, say it's playable and what it changes). ` +
    `Then what ${book} does, and, if there's a third, what the line is aiming for.`,
  "Drawings are space-separated tokens: g:e2e4 a green arrow (a move or pawn break for the player), b:g1f3 a blue arrow (a piece route), " +
    "r:d8h4 a red arrow (the opponent's threat or reply), r:d4 a red circle (a target or weak square), y:a1h8 a yellow line (a diagonal or file), " +
    "y:d5 a yellow circle (a key square). Every green, blue and red arrow starts on a piece in the position above, or where an earlier arrow " +
    "of the same idea ends. 2 to 4 drawings per idea; they should show exactly what the sentences say.",
  "Under 90 words in all. No preamble, no summary, no move lists (a move or two to illustrate is fine). " +
    'Write Black\'s moves with "..." (...Nf6) and White\'s without (Nf3). Everything you say agrees with the engine numbers above.',
];

/** "White: Kg1 Qd1 Ra1 ... Black: Kg8 ...", so drawings start on real pieces. */
function pieceList(fen: string): string {
  const out: Record<"w" | "b", string[]> = { w: [], b: [] };
  for (const row of new Chess(fen).board())
    for (const p of row) if (p) out[p.color].push(`${p.type === "p" ? "" : p.type.toUpperCase()}${p.square}`);
  return `White: ${out.w.join(" ")}. Black: ${out.b.join(" ")}.`;
}

/**
 * The coach's answer as ideas (the plans' shape), its drawings checked against the position they're
 * drawn on: an arrow that doesn't start on a piece or an earlier arrow's end is dropped. Null when
 * the answer isn't in the format at all.
 */
export function parseIdeas(text: string, fen: string): PlanIdea[] | null {
  const chess = new Chess(fen);
  const ideas: PlanIdea[] = [];
  for (const block of text.split(/^#{2,3}\s+/m).slice(1)) {
    const lines = block.split("\n").map((l) => l.trim());
    const title = lines[0].replace(/[*#]/g, "").trim();
    const drawLine = lines.find((l) => /^draw:/i.test(l)) ?? "";
    const body = lines
      .slice(1)
      .filter((l) => l && !/^draw:/i.test(l))
      .join(" ");
    const reached = new Set<string>();
    const draw = drawLine
      .replace(/^draw:/i, "")
      .split(/\s+/)
      .filter((t) => {
        const m = t.match(/^([gbry]):([a-h][1-8])([a-h][1-8])?$/);
        if (!m) return false;
        const [, brush, from, to] = m;
        if (to && brush !== "y" && !chess.get(from as Square) && !reached.has(from)) return false;
        if (to) reached.add(to);
        return true;
      })
      .join(" ");
    if (title && body) ideas.push({ title, text: body, draw });
  }
  return ideas.length ? ideas : null;
}

/** Whether the coach can be asked at all here (a signed-in desktop or a phone linked to one). */
export const canExplain = () => hasBackend() && useAuth.getState().status === "signed-in";

/** One slip to explain: the line being trained, the position, the student's move and the book move. */
export interface Slip {
  target: TrainingLine;
  fen: string;
  played: string;
  book: string;
}

/**
 * Saved answers are keyed by the line (its plan is part of the answer) and the position, not the
 * moves that led there: a different move order to the same position reuses the answer.
 */
// 3: answers in the ideas format (parseIdeas); older prose answers are asked again.
const CACHE_KEY = "cc-opening-why-3";
const cacheKey = (s: Slip) => [s.target.moves.join(" "), s.fen.split(" ").slice(0, 4).join(" "), s.played, s.book].join("|");

function readCache(): Record<string, string> {
  try {
    // The first cache was keyed by move sequence only, which could show another line's plan.
    localStorage.removeItem("cc-opening-why");
    localStorage.removeItem("cc-opening-why-2");
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** This device's earlier explanation of the same slip, if any: shown at once, no coach call. */
export const cachedExplanation = (slip: Slip): string | null => readCache()[cacheKey(slip)] ?? null;

function keep(slip: Slip, text: string) {
  try {
    const all = readCache();
    all[cacheKey(slip)] = text;
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // Private mode or full: asked again next time.
  }
}

/** Asks the coach (a one-off call, see coach_explain) and keeps the answer on this device. */
export async function explainOffLine(slip: Slip, prompt: string): Promise<string> {
  const text = await invoke<string>("coach_explain", { prompt });
  if (text) keep(slip, text);
  return text;
}
