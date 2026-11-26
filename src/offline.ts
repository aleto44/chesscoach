// Offline mode, on the desktop app and phones alike (docs/server-migration.md, phase 7): whatever
// runs on the device keeps working while the server is out of reach (no signal, the laptop off).
// While it's reachable the device keeps a pack: a batch of puzzles around the student's level and
// the drill cards (the desktop keeps a bigger one). Out of reach, the puzzle and drill calls answer
// from the pack, and what the student did (attempts, grades, new drills) waits in an outbox, kept
// across reloads, until the server can take it, in the order it happened. Games played offline are
// kept whole and sent the same way (game/local.ts).
import { create } from "zustand";
import { invoke, isRemote, isShell, Unreachable, useConnection } from "./backend";
import { syncLocalGames } from "./game/local";
import { resaveAll, withoutSaving } from "./db";
import { useStore } from "./store";
import type { Drill } from "./analysis/drills";
import type { Puzzle } from "./puzzles/puzzles";
import type { NodeProgress } from "./openings/progress";

const PACK_KEY = "cc-offline-pack";
const OUTBOX_KEY = "cc-offline-outbox";
/** How often the pack is renewed while the server is reachable. */
const PACK_EVERY_MS = 30 * 60_000;
/** Puzzles kept for offline use: the desktop has room for more. */
const PACK_PUZZLES = isShell ? 400 : 150;

interface Pack {
  at: number;
  puzzles: Puzzle[];
  drills: Drill[];
}

interface Sent {
  cmd: string;
  args: Record<string, unknown>;
}

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function keep(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full storage: offline just has less to work with.
  }
}

let pack: Pack = load(PACK_KEY, { at: 0, puzzles: [], drills: [] });
let outbox: Sent[] = load(OUTBOX_KEY, []);

/** Results waiting for the server, for the offline note in the top bar. */
export const useOutbox = create<{ pending: number }>(() => ({ pending: outbox.length }));
const saveOutbox = () => {
  keep(OUTBOX_KEY, outbox);
  useOutbox.setState({ pending: outbox.length });
};

/**
 * Course answers given offline and not yet sent, by decision: kept on top of the map the server
 * sends (at boot, or merged from the other device) until they're through.
 */
export function pendingCourse(): Record<string, NodeProgress> {
  const out: Record<string, NodeProgress> = {};
  for (const s of outbox) if (s.cmd === "db_course_progress") out[String(s.args.id)] = s.args.progress as NodeProgress;
  return out;
}

/** Puzzles tried and drills graded since the pack was made: not offered again offline. */
const usedPuzzles = new Set<string>(outbox.filter((s) => s.cmd === "puzzle_record").map((s) => String(s.args.id)));
const usedDrills = new Set<number>(outbox.filter((s) => s.cmd === "db_grade_drill" || s.cmd === "db_retire_drill").map((s) => Number(s.args.id)));

/**
 * Calls the server; when it's out of reach, `offline` answers instead and, if
 * the call changes something, it's queued for later.
 */
export async function orOffline<T>(cmd: string, args: Record<string, unknown>, offline: () => T, queue = false): Promise<T> {
  // Earlier offline writes go first, so the server sees things in the order they happened.
  if (queue && outbox.length) {
    outbox.push({ cmd, args });
    saveOutbox();
    void flushOutbox();
    return offline();
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (!isRemote || !(e instanceof Unreachable)) throw e;
    if (queue) {
      outbox.push({ cmd, args });
      saveOutbox();
    }
    return offline();
  }
}

let flushing: Promise<void> | null = null;
/** Sends the outbox, oldest first, stopping as soon as the server is out of reach again. */
export function flushOutbox(): Promise<void> {
  if (!isRemote || !outbox.length) return Promise.resolve();
  flushing ??= (async () => {
    while (outbox.length) {
      try {
        await invoke(outbox[0].cmd, outbox[0].args);
      } catch (e) {
        if (e instanceof Unreachable) break;
        // Refused for good (e.g. a drill deleted meanwhile): drop it rather than block the rest.
        console.warn("offline result not accepted", outbox[0].cmd, e);
      }
      outbox.shift();
      saveOutbox();
    }
  })().finally(() => (flushing = null));
  return flushing;
}

/**
 * PACK_PUZZLES around the student's rating. The server hands out at most 50 per call (a bigger
 * random pick would hold the database longer), so the pack is filled in batches.
 */
async function packOfPuzzles(rating: number): Promise<Puzzle[]> {
  const got: Puzzle[] = [];
  while (got.length < PACK_PUZZLES) {
    const batch = await invoke<Puzzle[]>("puzzle_find", {
      filter: { themes: [], exclude: got.map((p) => p.id), opening: null, minRating: rating - 300, maxRating: rating + 300, limit: 50 },
    });
    got.push(...batch);
    if (batch.length < 50) break;
  }
  return got.slice(0, PACK_PUZZLES);
}

/** Renews the pack while the server is reachable (at most every half hour). */
export async function refreshPack(force = false) {
  if (!isRemote || (!force && Date.now() - pack.at < PACK_EVERY_MS)) return;
  try {
    const { usePuzzleDb } = await import("./puzzles/puzzles");
    const db = usePuzzleDb.getState();
    const [puzzles, drills] = await Promise.all([
      db.installed ? packOfPuzzles(db.rating) : Promise.resolve([] as Puzzle[]),
      invoke<Drill[]>("db_due_drills", { limit: 200, all: true, tag: null, category: null }),
    ]);
    pack = { at: Date.now(), puzzles, drills };
    keep(PACK_KEY, pack);
    usedPuzzles.clear();
    usedDrills.clear();
    warmEngine();
  } catch (e) {
    if (!(e instanceof Unreachable)) console.warn("offline pack not renewed", e);
  }
}

/** Drills are graded by Stockfish on the phone: make sure its files are kept for offline use. */
function warmEngine() {
  for (const f of ["/stockfish/stockfish-19-lite-single.js", "/stockfish/stockfish-19-lite-single.wasm"])
    fetch(f).catch(() => undefined);
}

// ---- Answers from the pack ----

export function packPuzzles(filter: { themes: string[]; opening: string | null; minRating: number; maxRating: number; limit: number; exclude: string[] }): Puzzle[] {
  const skip = new Set([...filter.exclude, ...usedPuzzles]);
  const fits = pack.puzzles.filter(
    (p) =>
      !skip.has(p.id) &&
      filter.themes.every((t) => p.themes.includes(t)) &&
      (!filter.opening || p.openings.includes(filter.opening)),
  );
  // In the rating window if possible; any puzzle left beats an empty board.
  const inWindow = fits.filter((p) => p.rating >= filter.minRating && p.rating <= filter.maxRating);
  return (inWindow.length ? inWindow : fits).slice(0, filter.limit);
}

export const markPuzzleUsed = (id: string) => usedPuzzles.add(id);
export const packPuzzle = (id: string) => pack.puzzles.find((p) => p.id === id) ?? null;

const nowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");

export function packDrills(limit: number, all: boolean, tag: string | null, category: string | null = null): Drill[] {
  const now = nowSql();
  const picked = pack.drills
    .filter((d) => !usedDrills.has(d.id))
    .filter((d) => !category || (d.category ?? d.kind) === category)
    .filter((d) => (tag ? d.kind === "mistake" && `, ${d.note ?? ""},`.includes(`, ${tag},`) : all || d.dueAt <= now));
  // Due drills come shuffled, the way the server gives them.
  if (!all && !tag) shuffle(picked);
  return picked.slice(0, limit);
}

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

export function packDrillCounts() {
  const left = pack.drills.filter((d) => !usedDrills.has(d.id));
  const now = nowSql();
  return { total: left.length, due: left.filter((d) => d.dueAt <= now).length };
}

/** A graded drill's next date, guessed the way the server schedules it (it decides on sync). */
export function gradedOffline(id: number, correct: boolean): string {
  usedDrills.add(id);
  const d = pack.drills.find((x) => x.id === id);
  const days = correct ? Math.max(1, Math.round(2.5 * Math.max(1, d?.reps ?? 0))) : 1;
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 19).replace("T", " ");
}
export const retiredOffline = (id: number) => usedDrills.add(id);

/**
 * Sends the games played offline. The open one takes its server id and is saved again in full, so
 * moves made while it was being sent aren't lost; then the review backlog reviews them (drills).
 */
export async function sendLocalGames() {
  const sent = await syncLocalGames((local, server) => {
    if (useStore.getState().gameId !== local) return;
    withoutSaving(() => useStore.setState({ gameId: server }));
    void resaveAll();
  });
  if (!sent.size) return;
  const { analyzeBacklog } = await import("./analysis/review");
  analyzeBacklog();
}

/** Keeps the pack fresh and the outbox moving whenever this device is back with the server. */
export function initOffline() {
  if (!isRemote) return;
  const caughtUp = () => flushOutbox().then(sendLocalGames);
  useConnection.subscribe((c, prev) => {
    if (c.reachable && !prev.reachable) {
      void caughtUp();
      void refreshPack();
    }
  });
  window.addEventListener("online", () => void caughtUp());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void caughtUp().then(() => refreshPack());
  });
  void caughtUp();
}
