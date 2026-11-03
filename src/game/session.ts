// Starting, loading and finishing games. Each game owns its chat, tangents and coach session.
import { invoke } from "@tauri-apps/api/core";
import { Chess } from "chess.js";
import { buildLine, emptyLine, START_FEN } from "../chess/line";
import { db, flush, hasBackend, opponentElo, opponentKey, withoutSaving } from "../db";
import { FREE_PLAY, newId, pushChat, useStore, type ChatItem, type Color, type GameMeta, type Tangent } from "../store";

export interface NewGameOptions {
  studentColor: Color | "both";
  opponentElo: number | null;
}

export async function newGame(opts: NewGameOptions) {
  await leaveGame();
  const meta: GameMeta = { ...FREE_PLAY, ...opts };
  const gameId = hasBackend()
    ? await db.createGame({ startFen: START_FEN, studentColor: opts.studentColor, opponent: opponentKey(opts.opponentElo) })
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
  await leaveGame();
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

/** Saves pending writes and stops the coach process (the next message resumes this game's session). */
async function leaveGame() {
  await flush();
  if (hasBackend()) await invoke("coach_reset");
}

/** On launch, reopen the most recent game, or start one against the opponent. */
export async function bootstrap() {
  if (!hasBackend()) return;
  const [latest] = await db.listGames(1);
  if (latest) await loadGame(latest.id);
  else await newGame({ studentColor: "white", opponentElo: 1500 });
}

export async function resign() {
  const { meta } = useStore.getState();
  if (meta.result || meta.studentColor === "both") return;
  await finish(meta.studentColor === "white" ? "0-1" : "1-0", "resignation");
}

async function finish(result: NonNullable<GameMeta["result"]>, termination: string) {
  const { gameId, meta } = useStore.getState();
  useStore.setState({ meta: { ...meta, result, termination } });
  pushChat({ kind: "system", id: newId("c"), text: `Game over: ${result} (${termination}).` });
  if (gameId !== null && hasBackend()) await db.updateGame(gameId, { result, termination });
}

/** Ends the game when the position at the end of the game line is terminal. */
export function initGameOverWatch() {
  useStore.subscribe((s, prev) => {
    if (s.game === prev.game || s.meta.result || s.gameId !== prev.gameId) return;
    const chess = new Chess(s.game.fens[s.game.sans.length]);
    if (chess.isCheckmate()) finish(chess.turn() === "w" ? "0-1" : "1-0", "checkmate");
    else if (chess.isStalemate()) finish("1/2-1/2", "stalemate");
    else if (chess.isThreefoldRepetition()) finish("1/2-1/2", "repetition");
    else if (chess.isInsufficientMaterial()) finish("1/2-1/2", "insufficient material");
    else if (chess.isDraw()) finish("1/2-1/2", "fifty-move rule");
  });
}
