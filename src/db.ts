// SQLite access (src-tauri/src/db.rs) and the store subscription that keeps it up to date.
import { invoke } from "@tauri-apps/api/core";
import type { Line } from "./chess/line";
import { useStore, type ChatItem, type GameMeta, type Tangent } from "./store";

export const hasBackend = () => "__TAURI_INTERNALS__" in window;

export interface MoveRow {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  byStudent: boolean;
}

export interface TangentRow {
  id: string;
  parentId: string | null;
  title: string;
  author: "coach" | "student";
  startFen: string;
  sans: string[];
  notes: string[];
}

export interface GameSummary {
  id: number;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  startFen: string;
  studentColor: GameMeta["studentColor"];
  opponent: string | null;
  result: GameMeta["result"];
  termination: string | null;
  coachSessionId: string | null;
  plies: number;
  opening: string;
}

export interface GameRecord {
  game: GameSummary;
  moves: MoveRow[];
  tangents: TangentRow[];
  chat: { id: string; seq: number; kind: string; data: ChatItem }[];
}

export const db = {
  createGame: (game: { startFen: string; studentColor: string; opponent: string | null }) =>
    invoke<number>("db_create_game", { game }),
  updateGame: (id: number, patch: { coachSessionId?: string; result?: string; termination?: string }) =>
    invoke<void>("db_update_game", { id, patch }),
  listGames: (limit = 100) => invoke<GameSummary[]>("db_list_games", { limit }),
  loadGame: (id: number) => invoke<GameRecord | null>("db_load_game", { id }),
  deleteGame: (id: number) => invoke<void>("db_delete_game", { id }),
  /** Deletes games the student never played in or talked about, except `keep`. */
  pruneEmptyGames: (keep: number | null) => invoke<number>("db_prune_empty_games", { keep }),
};

export const opponentKey = (elo: number | null) => (elo ? `stockfish:${elo}` : null);
export const opponentElo = (key: string | null) => (key?.startsWith("stockfish:") ? Number(key.slice(10)) : null);

function moveRows(line: Line, studentColor: GameMeta["studentColor"]): MoveRow[] {
  return line.sans.map((san, i) => {
    const [from, to] = line.lastMoves[i];
    const promo = san.match(/=([QRBN])/)?.[1].toLowerCase() ?? "";
    const mover = line.fens[i].split(" ")[1] === "w" ? "white" : "black";
    return {
      ply: i + 1,
      san,
      uci: from + to + promo,
      fenBefore: line.fens[i],
      fenAfter: line.fens[i + 1],
      byStudent: studentColor === "both" || studentColor === mover,
    };
  });
}

export function tangentRow(t: Tangent): TangentRow {
  return {
    id: t.id,
    parentId: t.parentId,
    title: t.title,
    author: t.author,
    startFen: t.line.startFen,
    sans: t.line.sans,
    notes: t.line.notes,
  };
}

let suppressed = false;
/** Applies a state change (e.g. loading a game) without writing it back to the database. */
export function withoutSaving(fn: () => void) {
  suppressed = true;
  try {
    fn();
  } finally {
    suppressed = false;
  }
}

let dirtyMoves = false;
const dirtyTangents = new Set<string>();
const dirtyChat = new Set<string>();
let timer: number | undefined;

/** Watches the store and writes changes for the current game, debounced (coach text streams in). */
export function initPersistence() {
  if (!hasBackend()) return;
  useStore.subscribe((s, prev) => {
    if (suppressed || s.gameId === null || s.gameId !== prev.gameId) return;
    if (s.game !== prev.game) dirtyMoves = true;
    for (const id in s.tangents) if (s.tangents[id] !== prev.tangents[id]) dirtyTangents.add(id);
    s.chat.forEach((c, i) => c !== prev.chat[i] && dirtyChat.add(c.id));
    if (s.sessionId && s.sessionId !== prev.sessionId) db.updateGame(s.gameId, { coachSessionId: s.sessionId });
    if (dirtyMoves || dirtyTangents.size || dirtyChat.size) {
      clearTimeout(timer);
      timer = window.setTimeout(flush, 300);
    }
  });
}

/** Drops unsaved changes (the game they belong to is being deleted). */
export function discardPending() {
  clearTimeout(timer);
  dirtyMoves = false;
  dirtyTangents.clear();
  dirtyChat.clear();
}

export async function flush() {
  clearTimeout(timer);
  const s = useStore.getState();
  const gameId = s.gameId;
  if (gameId === null) return;
  const writes: Promise<unknown>[] = [];
  if (dirtyMoves) writes.push(invoke("db_set_moves", { gameId, moves: moveRows(s.game, s.meta.studentColor) }));
  for (const id of dirtyTangents) {
    const t = s.tangents[id];
    if (t) writes.push(invoke("db_upsert_tangent", { gameId, tangent: tangentRow(t) }));
  }
  s.chat.forEach((item, seq) => {
    if (dirtyChat.has(item.id)) writes.push(invoke("db_upsert_chat", { gameId, item: { id: item.id, seq, kind: item.kind, data: item } }));
  });
  dirtyMoves = false;
  dirtyTangents.clear();
  dirtyChat.clear();
  const failed = (await Promise.allSettled(writes)).find((r) => r.status === "rejected");
  if (failed) console.error("save failed", (failed as PromiseRejectedResult).reason);
}
