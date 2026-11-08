// The sparring partner: Maia-3 (human-like) at club ratings, limited Stockfish above. The coach never
// chooses these moves.
import type { Key } from "chessground/types";
import { playAt, sideToMove } from "../chess/line";
import { maiaMove, preloadMaia } from "../engine/maia";
import { getOpponentEngine, STOCKFISH_RATING, toEngineElo } from "../engine/stockfish";
import { MAIA_MAX_RATING, useStore } from "../store";
import { clockLeft } from "./clock";
import { isFollowing } from "./sync";
import { writesHeld } from "../db";
import { mark } from "../perf";
import { bookMove } from "../openings/book";
import { Chess } from "chess.js";

function sanToUci(fen: string, san: string): string | null {
  try {
    const m = new Chess(fen).move(san);
    return m.from + m.to + (m.promotion ?? "");
  } catch {
    return null;
  }
}

/** The ratings on offer, chess.com scale: Maia's floor up to Stockfish's ceiling. */
export const OPPONENT_RATING = { min: 400, max: STOCKFISH_RATING.max };

const MOVETIME_MS = 600;
/** How long a reply takes, picked at random each move (thinking time included). */
const THINK_MS = { min: 1000, max: 3000 };
/**
 * Maia runs on the main thread and blocks it for a few hundred milliseconds on a phone, which
 * would freeze the student's move halfway through its slide (Board animates for 180ms). The reply
 * isn't due for a second anyway, so let the animation finish first.
 */
const ANIMATION_GAP_MS = 220;
let thinkingOn: string | null = null;

let preloadTimer: number | undefined;
/**
 * Setting Maia up takes the phone a few seconds and briefly blocks it, so on launch it waits
 * until the screen is up rather than competing with it. The first move doesn't wait for this.
 */
function preloadSoon() {
  if (preloadTimer !== undefined) return;
  preloadTimer = window.setTimeout(() => {
    const t = performance.now();
    preloadMaia().then((ok) => ok && mark(`maia ready (took ${Math.round(performance.now() - t)} ms)`));
  }, 1500);
}

/** Replies whenever the end of the game line is the opponent's turn. */
export function initOpponent() {
  useStore.subscribe((s, prev) => {
    if (s.game !== prev.game || s.meta !== prev.meta || s.gameId !== prev.gameId) maybeMove();
  });
}

/** Maia when it covers the rating; Stockfish (as close as it can get) if Maia fails to load. */
async function pickMove(fen: string, rating: number, movetime: number): Promise<string | null> {
  if (rating <= MAIA_MAX_RATING) {
    try {
      return await maiaMove(fen, rating);
    } catch (e) {
      console.error("Maia failed, falling back to Stockfish:", e);
    }
  }
  return getOpponentEngine().bestMove(fen, toEngineElo(rating), movetime);
}

/** After launch: the opponent may owe a move in the game that was on screen. */
export const resumeOpponent = () => void maybeMove();

async function maybeMove() {
  const { game, meta, gameId } = useStore.getState();
  if (!meta.opponentElo || meta.result || meta.studentColor === "both" || isFollowing()) return;
  if (meta.opponentElo <= MAIA_MAX_RATING) preloadSoon();
  // A snapshot on screen may be behind the database; the opponent waits until it's settled (boot.ts).
  if (writesHeld()) return;
  const end = game.sans.length;
  const fen = game.fens[end];
  if (sideToMove(fen) === meta.studentColor || thinkingOn === fen) return;

  thinkingOn = fen;
  useStore.setState({ opponentThinking: true });
  const started = Date.now();
  // On the clock, it spends at most a 40th of what's left, so bullet games don't flag it.
  const left = clockLeft(sideToMove(fen));
  const budget = left === null ? Infinity : left / 40;
  // Practicing an opening: follow the chosen line while the student stays in it.
  const book = bookMove(game.sans, meta.openingFocus);
  if (!book) await new Promise((r) => setTimeout(r, Math.min(ANIMATION_GAP_MS, budget / 4)));
  const uci = book
    ? sanToUci(fen, book)
    : await pickMove(fen, meta.opponentElo, Math.max(50, Math.min(MOVETIME_MS, budget)));
  const delay = Math.min(THINK_MS.min + Math.random() * (THINK_MS.max - THINK_MS.min), budget);
  await new Promise((r) => setTimeout(r, Math.max(0, delay - (Date.now() - started))));
  thinkingOn = null;
  useStore.setState({ opponentThinking: false });

  const now = useStore.getState();
  // Takeback, new game or game over while thinking: start over from the current state.
  if (now.gameId !== gameId || now.game.fens[now.game.sans.length] !== fen || now.meta.result) {
    maybeMove();
    return;
  }
  // The student picked the game up on another device meanwhile; that one replies.
  if (!uci || isFollowing()) return;
  const played = playAt(now.game, end, uci.slice(0, 2) as Key, uci.slice(2, 4) as Key, uci[4] ?? "q");
  if (!played) return;
  // A reply brings the board back to the present even if the student was looking at earlier moves:
  // it's their turn now, and moves are only played at the end.
  useStore.setState({ game: played.line, gamePly: end + 1 });
}
