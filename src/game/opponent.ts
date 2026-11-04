// The sparring partner: Stockfish at limited strength. The coach never chooses these moves.
import type { Key } from "chessground/types";
import { playAt, sideToMove } from "../chess/line";
import { getOpponentEngine, toEngineElo } from "../engine/stockfish";
import { useStore } from "../store";

const MOVETIME_MS = 600;
let thinkingOn: string | null = null;

/** Replies whenever the end of the game line is the opponent's turn. */
export function initOpponent() {
  useStore.subscribe((s, prev) => {
    if (s.game !== prev.game || s.meta !== prev.meta || s.gameId !== prev.gameId) maybeMove();
  });
}

async function maybeMove() {
  const { game, meta, gameId } = useStore.getState();
  if (!meta.opponentElo || meta.result || meta.studentColor === "both") return;
  const end = game.sans.length;
  const fen = game.fens[end];
  if (sideToMove(fen) === meta.studentColor || thinkingOn === fen) return;

  thinkingOn = fen;
  useStore.setState({ opponentThinking: true });
  const started = Date.now();
  const uci = await getOpponentEngine().bestMove(fen, toEngineElo(meta.opponentElo), MOVETIME_MS);
  // Short pause so instant replies don't feel robotic.
  await new Promise((r) => setTimeout(r, Math.max(0, 350 - (Date.now() - started))));
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
