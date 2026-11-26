// Live sync of whatever is in progress (docs/server-migration.md, phase 3): a puzzle set, a drill
// run, the opening, endgame, guess-the-move and find-the-plan trainers, and the trainers' coach
// thread. Games sync on their own (game/sync.ts), through the database.
//
// Each session store is mirrored to the server (server/src/live.rs) after every change: one record
// per kind, with a version. A device that's *in* a session sends its changes with the version it
// started from; the server refuses an update from an older version and the device takes the
// server's state instead, so two devices can't split a board. Changes from another device arrive
// as `live-changed` and replace the store's state, so the board, the moves and the messages show
// the same on both. The engine only answers on the device that was played on (sessions answer in
// the code that handled the student's move), so it never moves twice.
//
// A device that isn't in a session doesn't jump into it: the home screen offers "Continue" (Home's
// LiveContinue), and joining stops whatever this device had open, as starting any session does.
// Leaving a session on one device (back, Home) leaves it only there; the other carries on.
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { clientId, invoke, listen, Unreachable } from "./backend";
import { usePuzzle } from "./puzzles/session";
import { useDrill } from "./analysis/drillSession";
import { useOpening } from "./openings/session";
import { useEndgame } from "./endgames/session";
import { useGuess } from "./guess/session";
import { usePlan } from "./plans/session";
import { useTrainerChat } from "./coach/trainerChat";
import { go, type View } from "./nav";

export type LiveKind = "puzzle" | "drill" | "opening" | "endgame" | "guess" | "plan" | "trainer";

export interface LiveRecord {
  kind: LiveKind;
  id: string | null;
  state: unknown;
  version: number;
  device: string;
  at: number;
}

interface Outcome {
  ok: boolean;
  current: LiveRecord | null;
  version: number;
  at: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STORES: Record<LiveKind, UseBoundStore<StoreApi<any>>> = {
  puzzle: usePuzzle,
  drill: useDrill,
  opening: useOpening,
  endgame: useEndgame,
  guess: useGuess,
  plan: usePlan,
  trainer: useTrainerChat,
};
/** The trainers' coach thread isn't a session of its own: it's mirrored whenever it changes. */
const ALWAYS: LiveKind[] = ["trainer"];

/** The latest record the server has for each kind, for the home screen's "Continue". */
export const useLive = create<Partial<Record<LiveKind, LiveRecord>>>(() => ({}));

const KEY = "cc-live";
interface Saved {
  /** Kinds this device is in, and the server version it's in step with. */
  joined: Partial<Record<LiveKind, number>>;
  /** Kinds this device left, at which version: no "Continue" for them until another device moves on. */
  left: Partial<Record<LiveKind, number>>;
}
const saved: Saved = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s && typeof s === "object") return { joined: s.joined ?? {}, left: s.left ?? {} };
  } catch {
    // Fresh start.
  }
  return { joined: {}, left: {} };
})();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Private mode: this device just rejoins from the server's copy after a reload.
  }
};

/** The store's state as JSON: functions and undefined fields drop out, as they would on the wire. */
const jsonOf = (state: unknown) => (state === null || state === undefined ? null : JSON.stringify(state));
const lastJson: Partial<Record<LiveKind, string | null>> = {};
const inflight = new Set<LiveKind>();
const dirty = new Set<LiveKind>();
let applying = false;

function idOf(kind: LiveKind, s: Record<string, unknown>): string | null {
  const id = s.id ?? s.setId ?? (s.course as { id?: string } | undefined)?.id ?? null;
  return id === null ? kind : String(id);
}

function apply(kind: LiveKind, rec: LiveRecord) {
  applying = true;
  try {
    STORES[kind].setState(rec.state ?? (ALWAYS.includes(kind) ? STORES[kind].getInitialState() : null), true);
  } finally {
    applying = false;
  }
  lastJson[kind] = jsonOf(STORES[kind].getState());
  saved.joined[kind] = rec.version;
  delete saved.left[kind];
  save();
}

async function push(kind: LiveKind) {
  if (inflight.has(kind)) {
    dirty.add(kind);
    return;
  }
  const state = STORES[kind].getState();
  const json = jsonOf(state);
  if (json === null || json === lastJson[kind]) return;
  inflight.add(kind);
  try {
    const r = await invoke<Outcome>("live_update", {
      kind,
      id: idOf(kind, state),
      state: JSON.parse(json),
      baseVersion: saved.joined[kind] ?? 0,
    });
    if (r.ok) {
      lastJson[kind] = json;
      saved.joined[kind] = r.version;
      save();
    } else if (r.current) {
      // Another device moved first: the server's state wins here.
      console.info(`live ${kind}: another device moved on (v${r.version}); taking its state`);
      useLive.setState({ [kind]: r.current });
      apply(kind, r.current);
    }
  } catch (e) {
    // Offline: the change goes up with the next one, or when the server is back (resync).
    if (e instanceof Unreachable) dirty.add(kind);
    else console.warn(`live ${kind} not sent`, e);
  } finally {
    inflight.delete(kind);
    if (dirty.delete(kind) && STORES[kind].getState() !== null) void push(kind);
  }
}

function watch(kind: LiveKind) {
  let timer: number | undefined;
  STORES[kind].subscribe((s, prev) => {
    if (applying) return;
    if (s === null) {
      // Left on this device only (back, Home, another session started): the record stays for the others.
      if (prev !== null && saved.joined[kind] !== undefined) {
        saved.left[kind] = saved.joined[kind];
        delete saved.joined[kind];
        lastJson[kind] = null;
        save();
      }
      return;
    }
    // A session started here (not joined from the server) starts over on the server too.
    if (prev === null && saved.joined[kind] === undefined) saved.joined[kind] = 0;
    // Steps come in bursts (a move, then its message); one update carries them.
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void push(kind), 60);
  });
}

/** Brings this device in step with the server's records: at startup and after missing events. */
async function reconcile() {
  let records: LiveRecord[];
  try {
    records = await invoke<LiveRecord[]>("live_get");
  } catch {
    return;
  }
  const byKind: Partial<Record<LiveKind, LiveRecord>> = {};
  for (const r of records) byKind[r.kind] = r;
  useLive.setState(byKind, true);
  for (const kind of Object.keys(STORES) as LiveKind[]) {
    const rec = byKind[kind];
    const here = STORES[kind].getState();
    const mine = saved.joined[kind];
    if (mine === undefined && !ALWAYS.includes(kind)) continue;
    if (here === null && !ALWAYS.includes(kind)) {
      // In it when this device last ran, but the session didn't come back here: offer it instead.
      if (mine !== undefined) saved.left[kind] = mine;
      delete saved.joined[kind];
      continue;
    }
    if (rec && rec.version > (mine ?? 0) && rec.device !== clientId) apply(kind, rec);
    else if (jsonOf(here) !== lastJson[kind]) void push(kind);
  }
  save();
}

export function initLive() {
  for (const kind of Object.keys(STORES) as LiveKind[]) {
    lastJson[kind] = saved.joined[kind] !== undefined ? jsonOf(STORES[kind].getState()) : null;
    watch(kind);
  }
  listen<LiveRecord>("live-changed", ({ payload: r }) => {
    useLive.setState({ [r.kind]: r });
    if (r.device === clientId) return;
    const mine = saved.joined[r.kind];
    const inIt = mine !== undefined || ALWAYS.includes(r.kind);
    if (!inIt || r.version <= (mine ?? 0)) return;
    apply(r.kind, r);
  });
  listen("resync", () => void reconcile());
  void reconcile();
}

/** Where each kind's board lives, so back from a joined session goes where it would have. */
function viewOf(rec: LiveRecord): View {
  const s = (rec.state ?? {}) as Record<string, unknown>;
  switch (rec.kind) {
    case "puzzle":
      return "puzzles";
    case "drill":
      return "drills";
    case "opening":
      return s.course ? "openings-course" : "openings-legacy";
    case "endgame":
      return s.spec ? "convert" : "endgames";
    case "guess":
      return "guess";
    default:
      return "plans";
  }
}

const NAMES: Record<LiveKind, string> = {
  puzzle: "Puzzles",
  drill: "Drills",
  opening: "Opening training",
  endgame: "Endgame trainer",
  guess: "Guess the move",
  plan: "Find the plan",
  trainer: "Coach",
};

/** What "Continue" says about a record: "Puzzles: Forks · 4 of 10". */
export function describe(rec: LiveRecord): string {
  const s = (rec.state ?? {}) as Record<string, unknown>;
  const queue = Array.isArray(s.queue) ? s.queue.length : 0;
  const index = typeof s.index === "number" ? s.index : null;
  const title = (s.set as { title?: string } | undefined)?.title;
  const parts = [title, queue && index !== null ? `${Math.min(index + 1, queue)} of ${queue}` : null].filter(Boolean);
  return parts.length ? `${NAMES[rec.kind]}: ${parts.join(" · ")}` : NAMES[rec.kind];
}

/** Sessions another device has going (or this one left) that this device can pick up, newest first. */
export function joinable(records: Partial<Record<LiveKind, LiveRecord>>): LiveRecord[] {
  const day = 12 * 3600_000;
  return Object.values(records)
    .filter((r): r is LiveRecord => !!r && r.state !== null && !ALWAYS.includes(r.kind))
    .filter((r) => saved.joined[r.kind] === undefined && STORES[r.kind].getState() === null)
    // Left here on purpose: not offered again until another device moves it on.
    .filter((r) => (saved.left[r.kind] ?? -1) < r.version)
    .filter((r) => Date.now() - r.at < day)
    .sort((a, b) => b.at - a.at);
}

/** Picks up a session from the server here: whatever this device had open stops, as for any start. */
export function join(rec: LiveRecord) {
  go(viewOf(rec));
  apply(rec.kind, rec);
}
