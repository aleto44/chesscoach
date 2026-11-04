// Lichess puzzles (src-tauri/src/puzzles.rs): the downloaded set, the student's puzzle rating, and
// the tag names shown in the UI and accepted from the coach.
import { create } from "zustand";
import { hasBackend, invoke, listen } from "../backend";

export interface Puzzle {
  id: string;
  /** The position before the opponent's move; moves[0] is that move, the solution starts at moves[1]. */
  fen: string;
  moves: string[];
  rating: number;
  plays: number;
  themes: string[];
  /** Lichess opening tags, family first, e.g. ["Caro-Kann_Defense", "Caro-Kann_Defense_Advance_Variation"]. */
  openings: string[];
  /** The source game's path on lichess.org, e.g. "game/787zsVup/black#48". */
  game: string;
}

export interface TagCount {
  tag: string;
  kind: "theme" | "family" | "variation";
  count: number;
}

export interface ImportProgress {
  phase: "download" | "index" | "done" | "error" | "cancelled";
  done: number;
  total: number;
  kept: number;
  error: string | null;
}

interface PuzzleDb {
  loaded: boolean;
  installed: boolean;
  count: number;
  /** The student's puzzle rating (Lichess scale) and how many rated puzzles it's based on. */
  rating: number;
  attempts: number;
  tags: TagCount[];
  /** A download in progress (or its last outcome). */
  importing: ImportProgress | null;
}

export const usePuzzleDb = create<PuzzleDb>(() => ({
  loaded: false,
  installed: false,
  count: 0,
  rating: 1500,
  attempts: 0,
  tags: [],
  importing: null,
}));

export async function refreshPuzzleDb() {
  if (!hasBackend()) return;
  const s = await invoke<Omit<PuzzleDb, "loaded" | "importing">>("puzzle_status");
  usePuzzleDb.setState({ ...s, tags: s.tags ?? [], count: s.count ?? 0, loaded: true });
}

export function initPuzzles() {
  if (!hasBackend()) return;
  listen<ImportProgress>("puzzle-import", (e) => {
    usePuzzleDb.setState({ importing: e.payload });
    if (e.payload.phase === "done") refreshPuzzleDb();
  });
  refreshPuzzleDb().catch((e) => console.error("puzzle status failed", e));
}

export async function startImport() {
  usePuzzleDb.setState({ importing: { phase: "download", done: 0, total: 0, kept: 0, error: null } });
  try {
    await invoke("puzzle_import_start");
  } catch (e) {
    usePuzzleDb.setState({ importing: { phase: "error", done: 0, total: 0, kept: 0, error: String(e) } });
  }
}

export const cancelImport = () => invoke("puzzle_import_cancel");

export interface Filter {
  themes?: string[];
  opening?: string | null;
  minRating: number;
  maxRating: number;
  limit: number;
  exclude?: string[];
}

export const findPuzzles = (filter: Filter) =>
  invoke<Puzzle[]>("puzzle_find", { filter: { themes: [], exclude: [], opening: null, ...filter } });

/** Saves the attempt; the rating only moves on a puzzle's first try. */
export async function recordAttempt(p: Puzzle, correct: boolean, ms: number) {
  const r = await invoke<{ before: number; after: number; rated: boolean }>("puzzle_record", {
    id: p.id,
    rating: p.rating,
    themes: p.themes,
    correct,
    ms,
  });
  if (r.rated) usePuzzleDb.setState((s) => ({ rating: r.after, attempts: s.attempts + 1 }));
  return r;
}

// ---- Names ----

const LABELS: Record<string, string> = {
  attackingF2F7: "Attacking f2/f7",
  xRayAttack: "X-ray attack",
  enPassant: "En passant",
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
  mateIn4: "Mate in 4",
  mateIn5: "Mate in 5",
  oneMove: "One-move",
  veryLong: "Very long",
  superGM: "Super GM game",
  masterVsMaster: "Master vs master",
  master: "Master game",
  mate: "Checkmate",
};

/** "discoveredAttack" → "Discovered attack". */
export function themeLabel(theme: string): string {
  if (LABELS[theme]) return LABELS[theme];
  const words = theme.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Caro-Kann_Defense_Advance_Variation" → "Caro-Kann Defense Advance Variation". */
export const openingLabel = (tag: string) => tag.replace(/_/g, " ");

/** Themes that describe length or result rather than an idea; not offered as filters. */
export const META_THEMES = new Set(["short", "long", "veryLong", "oneMove", "crushing", "advantage", "equality"]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The Lichess opening tag for a name like "Caro-Kann Defense: Advance Variation" (the app's book
 * and the coach use those). Falls back to the closest variation, then to the family.
 */
export function openingTag(name: string, tags: TagCount[] = usePuzzleDb.getState().tags): string | null {
  const openings = tags.filter((t) => t.kind !== "theme");
  const want = norm(name);
  if (!want) return null;
  const exact = openings.find((t) => norm(t.tag) === want);
  if (exact) return exact.tag;
  // "Sicilian Defense: Najdorf" → Sicilian_Defense_Najdorf_Variation.
  const longer = openings.filter((t) => norm(t.tag).startsWith(want)).sort((a, b) => b.count - a.count)[0];
  if (longer) return longer.tag;
  const family = name.split(":")[0];
  return family !== name ? openingTag(family, tags) : null;
}

/** A theme the coach named loosely ("back rank mate", "Fork") → the Lichess key, if there is one. */
export function themeKey(name: string, tags: TagCount[] = usePuzzleDb.getState().tags): string | null {
  const want = norm(name);
  return tags.find((t) => t.kind === "theme" && norm(t.tag) === want)?.tag ?? null;
}
