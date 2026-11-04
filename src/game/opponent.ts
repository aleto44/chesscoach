// The sparring partner: Maia-3 (human-like) at club ratings, limited Stockfish above. The coach never
// chooses these moves.
import type { Key } from "chessground/types";
import { playAt, sideToMove } from "../chess/line";
import { maiaMove, preloadMaia } from "../engine/maia";
import { getOpponentEngine, STOCKFISH_RATING, toEngineElo } from "../engine/stockfish";
import { MAIA_MAX_RATING, useStore } from "../store";
import { clockLeft } from "./clock";

/** The ratings on offer, chess.com scale: Maia's floor up to Stockfish's ceiling. */
export const OPPONENT_RATING = { min: 400, max: STOCKFISH_RATING.max };

const MOVETIME_MS = 600;
let thinkingOn: string | null = null;

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

async function maybeMove() {
  const { game, meta, gameId } = useStore.getState();
  if (!meta.opponentElo || meta.result || meta.studentColor === "both") return;
  if (meta.opponentElo <= MAIA_MAX_RATING) preloadMaia();
  const end = game.sans.length;
  const fen = game.fens[end];
  if (sideToMove(fen) === meta.studentColor || thinkingOn === fen) return;

  thinkingOn = fen;
  useStore.setState({ opponentThinking: true });
  // On the clock, Stockfish spends at most a 40th of what's left, so bullet games don't flag it.
  const left = clockLeft(sideToMove(fen));
  const budget = left === null ? Infinity : left / 40;
  const uci = await pickMove(fen, meta.opponentElo, Math.max(50, Math.min(MOVETIME_MS, budget)));
  thinkingOn = null;
  useStore.setState({ opponentThinking: false });

  const now = useStore.getState();
  // Takeback, new game or game over while thinking: start over from the current state.
  if (now.gameId !== gameId || now.game.fens[now.game.sans.length] !== fen || now.meta.result) {
    maybeMove();
    return;
  }
  if (!uci) return;
  const played = playAt(now.game, end, uci.slice(0, 2) as Key, uci.slice(2, 4) as Key, uci[4] ?? "q");
  if (!played) return;
  const followingEnd = now.gamePly === end;
  useStore.setState({ game: played.line, gamePly: followingEnd ? end + 1 : now.gamePly });
}
