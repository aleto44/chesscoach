// Why a move left the opening line: the engine's verdict on the student's move and the book move
// (computed, so the coach reports it rather than guessing), then the coach's one-off explanation of
// the theory: what the student's move gives up, why the book move is played, what the line is for.
// Answers are kept on this device, so the same slip doesn't cost another coach call.
import { Chess } from "chess.js";
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
    "Explain in three short sections, about 200 words in all, for this player:",
    `### Why not ${played}`,
    `What it gives up, allows or misplaces. If the engine rates it about the same, say honestly that it's playable, and what different kind of position it leads to instead of the line's.`,
    `### Why ${book}`,
    `What the book move does here and why theory plays it.`,
    `### What ${set.color === "white" ? "White" : "Black"} is playing for`,
    `The plans of this line for the player's side: pawn structure, where the pieces go, the pawn breaks to aim for, and what the opponent is trying to do.`,
    "No long move lists; a move or two to illustrate is fine.",
  ].join("\n");
  return { evals, prompt };
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
const CACHE_KEY = "cc-opening-why-2";
const cacheKey = (s: Slip) => [s.target.moves.join(" "), s.fen.split(" ").slice(0, 4).join(" "), s.played, s.book].join("|");

function readCache(): Record<string, string> {
  try {
    // The first cache was keyed by move sequence only, which could show another line's plan.
    localStorage.removeItem("cc-opening-why");
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
