// Starting, loading and finishing games. Each game owns its chat, tangents and coach session.
import { invoke } from "@tauri-apps/api/core";
import { Chess } from "chess.js";
import { buildLine, emptyLine, sideToMove, START_FEN, type Line } from "../chess/line";
import { db, discardPending, flush, hasBackend, opponentElo, opponentKey, withoutSaving } from "../db";
import {
  FREE_PLAY,
  isLocked,
  newId,
  pushChat,
  useStore,
  type ChatItem,
  type Color,
  type GameMeta,
  type GameMode,
  type Tangent,
} from "../store";

export interface NewGameOptions {
  mode: GameMode;
  studentColor: Color | "both";
  opponentElo: number | null;
}

export async function newGame(opts: NewGameOptions) {
  await leaveGame();
  // Rated means against an opponent; free play is always practice.
  const mode: GameMode = opts.studentColor === "both" || !opts.opponentElo ? "practice" : opts.mode;
  const meta: GameMeta = { ...FREE_PLAY, ...opts, mode };
  const gameId = hasBackend()
    ? await db.createGame({
        startFen: START_FEN,
        studentColor: opts.studentColor,
        opponent: opponentKey(opts.opponentElo),
        mode,
      })
    : null;
  withoutSaving(() =>
    useStore.setState({
      gameId,
      meta,
      game: emptyLine(),
      gamePly: 0,
      tangents: {},
      active: null,
      chat: [],
      busy: false,
      sessionId: null,
      orientation: opts.studentColor === "black" ? "black" : "white",
    }),
  );
}

export async function loadGame(id: number) {
  const record = await db.loadGame(id);
  if (!record) return;
  await leaveGame(id);
  const { game, moves, tangents, chat } = record;

  const built = buildLine(game.startFen, moves.map((m) => m.san));
  const line = "line" in built ? built.line : emptyLine(game.startFen);

  const tangentMap: Record<string, Tangent> = {};
  for (const t of tangents) {
    const b = buildLine(t.startFen, t.sans, t.notes);
    if (!("line" in b)) continue;
    tangentMap[t.id] = {
      id: t.id,
      parentId: t.parentId,
      title: t.title,
      author: t.author,
      line: b.line,
      ply: t.author === "coach" ? 0 : b.line.sans.length,
    };
  }

  // A tool call can't still be running in a freshly loaded game.
  const items: ChatItem[] = chat.map(({ data }) =>
    data.kind === "tool" && data.status === "running" ? { ...data, status: "error", detail: "interrupted" } : data,
  );

  withoutSaving(() =>
    useStore.setState({
      gameId: game.id,
      meta: {
        mode: game.mode,
        takebacks: game.takebacks,
        studentColor: game.studentColor,
        opponentElo: opponentElo(game.opponent),
        result: game.result,
        termination: game.termination,
      },
      game: line,
      gamePly: line.sans.length,
      tangents: tangentMap,
      active: null,
      chat: items,
      busy: false,
      sessionId: game.coachSessionId,
      orientation: game.studentColor === "black" ? "black" : "white",
    }),
  );
}

/**
 * Saves pending writes and stops the coach process (the next message resumes this game's
 * session). A game the student never moved in or talked about is deleted on the way out.
 */
async function leaveGame(keep: number | null = null) {
  await flush();
  if (!hasBackend()) return;
  await invoke("coach_reset");
  await db.pruneEmptyGames(keep);
}

/** Deletes a game for good. Deleting the open game moves on to the latest remaining one. */
export async function deleteGame(id: number) {
  const current = useStore.getState().gameId === id;
  if (current) {
    discardPending();
    await invoke("coach_reset");
  }
  await db.deleteGame(id);
  if (!current) return;
  withoutSaving(() => useStore.setState({ gameId: null }));
  const [latest] = await db.listGames(1);
  if (latest) await loadGame(latest.id);
  else await newGame({ mode: "practice", studentColor: "white", opponentElo: 1500 });
}

/** On launch, reopen the most recent game, or start one against the opponent. */
export async function bootstrap() {
  if (!hasBackend()) return;
  // Games abandoned before the student moved (e.g. the app was closed) go on launch.
  await db.pruneEmptyGames(null);
  const [latest] = await db.listGames(1);
  if (latest) await loadGame(latest.id);
  else await newGame({ mode: "practice", studentColor: "white", opponentElo: 1500 });
}

/** Where a takeback would rewind the game to: before the student's last move. Null = nothing to take back. */
export function takebackPly(game: Line, meta: GameMeta): number | null {
  if (meta.mode !== "practice" || meta.result || meta.studentColor === "both") return null;
  for (let ply = game.sans.length - 1; ply >= 0; ply--) {
    if (sideToMove(game.fens[ply]) === meta.studentColor) return ply;
  }
  return null;
}

/** Practice games: undo the student's last move (and the opponent's reply), and count it. */
export async function takeBack() {
  const { game, meta, gameId } = useStore.getState();
  const ply = takebackPly(game, meta);
  if (ply === null) return;
  const line: Line = {
    ...game,
    sans: game.sans.slice(0, ply),
    fens: game.fens.slice(0, ply + 1),
    lastMoves: game.lastMoves.slice(0, ply),
    notes: game.notes.slice(0, ply),
  };
  const takebacks = meta.takebacks + 1;
  useStore.setState({ game: line, gamePly: ply, meta: { ...meta, takebacks } });
  if (gameId !== null && hasBackend()) await db.updateGame(gameId, { takebacks });
}

/**
 * Turns a rated game in progress into a practice game, for good, so the engine and coach can
 * help. It then no longer counts as the student's unaided play.
 */
export async function switchToPractice() {
  const { meta, gameId } = useStore.getState();
  if (!isLocked(meta)) return;
  useStore.setState({ meta: { ...meta, mode: "practice" } });
  pushChat({ kind: "system", id: newId("c"), text: "Switched to practice. This game no longer counts as a rated game." });
  if (gameId !== null && hasBackend()) await db.updateGame(gameId, { mode: "practice" });
}

export async function resign() {
  const { meta } = useStore.getState();
  if (meta.result || meta.studentColor === "both") return;
  await finish(meta.studentColor === "white" ? "0-1" : "1-0", "resignation");
}

async function finish(result: NonNullable<GameMeta["result"]>, termination: string) {
  const { gameId, meta } = useStore.getState();
  useStore.setState({ meta: { ...meta, result, termination } });
  const review = meta.mode === "rated" ? " The coach is on again: ask it to go through the game with you." : "";
  pushChat({ kind: "system", id: newId("c"), text: `Game over: ${result} (${termination}).${review}` });
  if (gameId !== null && hasBackend()) await db.updateGame(gameId, { result, termination });
}

/** Ends the game when the position at the end of the game line is terminal. */
export function initGameOverWatch() {
  useStore.subscribe((s, prev) => {
    if (s.game === prev.game || s.meta.result || s.gameId !== prev.gameId) return;
    // Replay from the start: repetition can't be detected from the final FEN alone.
    const chess = new Chess(s.game.startFen);
    for (const san of s.game.sans) chess.move(san);
    if (chess.isCheckmate()) finish(chess.turn() === "w" ? "0-1" : "1-0", "checkmate");
    else if (chess.isStalemate()) finish("1/2-1/2", "stalemate");
    else if (chess.isThreefoldRepetition()) finish("1/2-1/2", "repetition");
    else if (chess.isInsufficientMaterial()) finish("1/2-1/2", "insufficient material");
    else if (chess.isDraw()) finish("1/2-1/2", "fifty-move rule");
  });
}
