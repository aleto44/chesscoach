// Games played while the server is out of reach (docs/server-migration.md, phase 7). The engines
// run on the device, so a game against Maia or Stockfish, rated or practice, plays the same
// offline. It gets a local id (negative, so it can't clash with the server's) and is kept on the
// device: its moves, chat and result. Once the server answers again, each one is sent: created,
// filled in and finished there, which rates it, makes its drills (the review backlog picks it up)
// and tells the other devices. The game on screen then carries on under its server id.
import { invoke, Unreachable } from "../backend";
import type { GamePatch, MoveRow, TangentRow } from "../db";
import type { ChatItem } from "../store";

const KEY = "cc-local-games";

export interface NewGameArgs {
  startFen: string;
  studentColor: string;
  opponent: string | null;
  mode: string;
  timeControl: string | null;
  openingFocus: string[];
}

interface LocalGame {
  id: number;
  create: NewGameArgs;
  moves: MoveRow[];
  tangents: TangentRow[];
  chat: { id: string; seq: number; kind: string; data: ChatItem }[];
  patch: GamePatch;
  /** Set once the server created it, so a send cut off halfway never creates it twice. */
  serverId?: number;
}

export const isLocalGame = (id: number | null | undefined): id is number => typeof id === "number" && id < 0;

function load(): Record<number, LocalGame> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}
function store(games: Record<number, LocalGame>) {
  try {
    if (Object.keys(games).length) localStorage.setItem(KEY, JSON.stringify(games));
    else localStorage.removeItem(KEY);
  } catch (e) {
    console.error("could not keep the offline game", e);
  }
}

export const localGameCount = () => Object.keys(load()).length;

/** A new game while the server can't be reached: kept here until it can. */
export function createLocalGame(create: NewGameArgs): number {
  const games = load();
  const id = -Date.now();
  games[id] = { id, create, moves: [], tangents: [], chat: [], patch: {} };
  store(games);
  return id;
}

/** The open local game's current moves, side boards and chat (what flush would send). */
export function saveLocalGame(id: number, part: Pick<LocalGame, "moves" | "tangents" | "chat">) {
  const games = load();
  if (!games[id]) return;
  games[id] = { ...games[id], ...part };
  store(games);
}

/** The result, resignation, mode change...: applied on the server when the game is sent. */
export function patchLocalGame(id: number, patch: GamePatch) {
  const games = load();
  if (!games[id]) return;
  games[id].patch = { ...games[id].patch, ...patch };
  store(games);
}

let syncing: Promise<Map<number, number>> | null = null;

/**
 * Sends every local game to the server, oldest first. `onSent(localId, serverId)` runs for each,
 * so the game on screen can take its server id. Stops at the first one the server can't take yet.
 */
export function syncLocalGames(onSent: (local: number, server: number) => void): Promise<Map<number, number>> {
  syncing ??= (async () => {
    const sent = new Map<number, number>();
    // Newest id is the most negative: oldest first means the largest (closest to zero) first.
    const pending = Object.values(load()).sort((a, b) => b.id - a.id);
    for (const g of pending) {
      try {
        const id = g.serverId ?? (await invoke<number>("db_create_game", { game: g.create }));
        if (g.serverId === undefined) {
          const games = load();
          if (games[g.id]) games[g.id].serverId = id;
          store(games);
        }
        if (g.moves.length) await invoke("db_set_moves", { gameId: id, moves: g.moves });
        for (const t of g.tangents) await invoke("db_upsert_tangent", { gameId: id, tangent: t });
        for (const c of g.chat) await invoke("db_upsert_chat", { gameId: id, item: c });
        if (Object.keys(g.patch).length) await invoke("db_update_game", { id, patch: g.patch });
        const games = load();
        delete games[g.id];
        store(games);
        sent.set(g.id, id);
        onSent(g.id, id);
        void invoke("game_changed", { gameId: id }).catch(() => undefined);
        console.info(`offline game ${g.id} saved on the server as ${id}`);
      } catch (e) {
        if (e instanceof Unreachable) break;
        // Refused for good (shouldn't happen): keep it, so nothing played is lost, and say so.
        console.error("the server refused an offline game; it stays on this device", g.id, e);
        break;
      }
    }
    return sent;
  })().finally(() => (syncing = null));
  return syncing;
}
