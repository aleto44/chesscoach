// SQLite access (src-tauri/src/db.rs) and the store subscription that keeps it up to date.
import { hasBackend, invoke, Unreachable } from "./backend";
import type { MoveAnnotation } from "./analysis/review";
import type { Line } from "./chess/line";
import { fromEngineElo } from "./engine/stockfish";
import type { RatingPool } from "./rating";
import { useStore, type ChatItem, type GameMeta, type ImportedFrom, type ImportSite, type Tangent } from "./store";

export { hasBackend };

export interface MoveRow {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  byStudent: boolean;
  /** The mover's clock right after the move, ms. */
  clockMs: number | null;
  /** Post-game analysis; read-only (saved by db_save_analysis). */
  analysis?: MoveAnnotation | null;
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
  mode: GameMeta["mode"];
  takebacks: number;
  /** "180+2" (seconds + increment); null = no clock. */
  timeControl: string | null;
  analyzed: boolean;
  openingName: string | null;
  openingFocus: string[] | null;
  plies: number;
  opening: string;
  /** The student's rating before and after this rated game; null = it didn't count. */
  ratingBefore: number | null;
  ratingAfter: number | null;
  /** Which of the student's ratings it moved (rating.ts ratingPool). */
  ratingPool: RatingPool | null;
  /** Imported games (games/import.ts): the site, and the players' ratings in chess.com scale. */
  source: ImportSite | null;
  url: string | null;
  opponentName: string | null;
  opponentRating: number | null;
  studentRating: number | null;
  speed: string | null;
}

export interface GameRecord {
  game: GameSummary;
  moves: MoveRow[];
  tangents: TangentRow[];
  chat: { id: string; seq: number; kind: string; data: ChatItem }[];
}

export const db = {
  createGame: (game: {
    startFen: string;
    studentColor: string;
    opponent: string | null;
    mode: GameMeta["mode"];
    timeControl: string | null;
    openingFocus: string[];
  }) =>
    invoke<number>("db_create_game", { game }).then((id) => (notifyChanged(id), id)),
  /** Resolves once the change is saved, retrying while the computer is out of reach. */
  updateGame: (id: number, patch: GamePatch) => {
    pendingPatches[id] = { ...pendingPatches[id], ...patch };
    savePendingPatches();
    return writePatch(id);
  },
  listGames: (limit = 100) => invoke<GameSummary[]>("db_list_games", { limit }),
  loadGame: (id: number) => invoke<GameRecord | null>("db_load_game", { id }),
  deleteGame: (id: number) => invoke<void>("db_delete_game", { id }),
  /** Deletes games the student never played in or talked about, except `keep`. */
  pruneEmptyGames: (keep: number | null) => invoke<number>("db_prune_empty_games", { keep }),
};

export type GamePatch = {
  coachSessionId?: string;
  result?: NonNullable<GameMeta["result"]>;
  termination?: string;
  mode?: GameMeta["mode"];
  takebacks?: number;
};

// ---- Writes that must not get lost ----
// A phone's connection to the computer drops now and then (screen off, Wi-Fi or Tailscale
// hiccup). A request lost then used to be gone for good: a resignation or a finished review
// stayed on the phone, the desktop never heard of it, and a reload showed the game as before.

let wake: (() => void) | null = null;
const wakeUp = () => wake?.();
if (typeof window !== "undefined") {
  window.addEventListener("online", wakeUp);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && wakeUp());
}

/** Waits `ms`, or less if the device comes back online or to the foreground. */
function pause(ms: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      if (wake === done) wake = null;
      resolve();
    };
    const t = window.setTimeout(done, ms);
    const previous = wake;
    wake = () => {
      previous?.();
      done();
    };
  });
}

/** Runs a backend write, trying again with backoff while the computer can't be reached. */
export async function reliably<T>(what: string, write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (e) {
      if (!(e instanceof Unreachable)) throw e;
      if (attempt === 0) console.warn(`${what}: will retry`, e);
      await pause(Math.min(30_000, 1000 * 2 ** attempt));
    }
  }
}

/** Game patches not yet saved, kept across a reload of the page so they're sent after it. */
const PENDING_KEY = "cc-pending-game-patches";
const pendingPatches: Record<number, GamePatch> = (() => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}");
  } catch {
    return {};
  }
})();
function savePendingPatches() {
  try {
    if (Object.keys(pendingPatches).length) localStorage.setItem(PENDING_KEY, JSON.stringify(pendingPatches));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // No storage (private mode): the in-memory retries still run.
  }
}

/** This device's changes to a game that the database doesn't have yet (a reload mustn't undo them). */
export const unsavedPatch = (id: number): GamePatch | undefined => pendingPatches[id];

const patchWriters = new Map<number, Promise<void>>();

/** Sends a game's pending patch, one request per game at a time so they land in order. */
function writePatch(id: number): Promise<void> {
  const write = (patchWriters.get(id) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const patch = pendingPatches[id];
      if (!patch) return;
      try {
        await reliably("saving the game", () => invoke<void>("db_update_game", { id, patch }));
      } finally {
        // Saved, or refused for good (retrying won't help). A newer patch stays for its own write.
        if (pendingPatches[id] === patch) {
          delete pendingPatches[id];
          savePendingPatches();
        }
      }
      notifyChanged(id);
    });
  const tracked = write.finally(() => patchWriters.get(id) === tracked && patchWriters.delete(id));
  patchWriters.set(id, tracked);
  return write;
}

// "stockfish-cc:" holds a chess.com-scale rating; older games saved the raw UCI_Elo as "stockfish:".
export const opponentKey = (rating: number | null) => (rating ? `stockfish-cc:${rating}` : null);
export const opponentElo = (key: string | null) =>
  key?.startsWith("stockfish-cc:")
    ? Number(key.slice(13))
    : key?.startsWith("stockfish:")
      ? fromEngineElo(Number(key.slice(10)))
      : null;

/** What GameMeta.imported holds for a stored game; null for games played here. */
export function importedFrom(g: GameSummary): ImportedFrom | null {
  if (!g.source) return null;
  return { site: g.source, opponent: g.opponentName ?? "?", opponentRating: g.opponentRating, studentRating: g.studentRating, url: g.url };
}

export function moveRows(line: Line, studentColor: GameMeta["studentColor"], clocks: (number | null)[]): MoveRow[] {
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
      clockMs: clocks[i] ?? null,
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
  // Left over from before a reload of the page.
  for (const id of Object.keys(pendingPatches)) writePatch(Number(id)).catch((e) => console.error("could not save the game", e));
  useStore.subscribe((s, prev) => {
    if (suppressed || s.gameId === null || s.gameId !== prev.gameId) return;
    if (s.game !== prev.game || s.clocks !== prev.clocks) dirtyMoves = true;
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

// A phone that opened on its saved snapshot may be behind the database (the game went on at the
// desktop). Until the boot call says which is right, this device's game writes wait, so a stale
// copy can't overwrite newer moves.
let held: Promise<void> | null = null;
/** Holds game writes back; call the returned function to let them through. */
export function holdWrites(): () => void {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  held = hold;
  return () => {
    if (held === hold) held = null;
    release();
  };
}
export const writesHeld = () => held !== null;

export async function flush() {
  clearTimeout(timer);
  while (held) await held;
  const s = useStore.getState();
  const gameId = s.gameId;
  if (gameId === null) return;
  // Each write with what to mark dirty again if it doesn't reach the computer.
  const writes: { write: Promise<unknown>; redo: () => void }[] = [];
  if (dirtyMoves)
    writes.push({
      write: invoke("db_set_moves", { gameId, moves: moveRows(s.game, s.meta.studentColor, s.clocks) }),
      redo: () => (dirtyMoves = true),
    });
  for (const id of dirtyTangents) {
    const t = s.tangents[id];
    if (t) writes.push({ write: invoke("db_upsert_tangent", { gameId, tangent: tangentRow(t) }), redo: () => dirtyTangents.add(id) });
  }
  s.chat.forEach((item, seq) => {
    if (dirtyChat.has(item.id))
      writes.push({
        write: invoke("db_upsert_chat", { gameId, item: { id: item.id, seq, kind: item.kind, data: item } }),
        redo: () => dirtyChat.add(item.id),
      });
  });
  dirtyMoves = false;
  dirtyTangents.clear();
  dirtyChat.clear();
  const results = await Promise.allSettled(writes.map((w) => w.write));
  let retry = false;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") return;
    console.error("save failed", r.reason);
    // Only worth another try while it's still the open game and the computer was just out of reach.
    if (r.reason instanceof Unreachable && useStore.getState().gameId === gameId) {
      writes[i].redo();
      retry = true;
    }
  });
  if (retry) {
    flushRetries++;
    clearTimeout(timer);
    pause(Math.min(30_000, 1000 * 2 ** flushRetries)).then(() => {
      if (useStore.getState().gameId === gameId) flush();
    });
  } else flushRetries = 0;
  if (results.some((r) => r.status === "fulfilled")) notifyChanged(gameId);
}
let flushRetries = 0;

/** Lets the student's other devices (phone, desktop) know to reload this game (see game/sync.ts). */
export function notifyChanged(gameId: number) {
  reliably("announcing the change", () => invoke("game_changed", { gameId })).catch((e) =>
    console.warn("could not announce the change", e),
  );
}
