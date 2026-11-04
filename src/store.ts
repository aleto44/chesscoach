import { create } from "zustand";
import type { Key } from "chessground/types";
import { emptyLine, moveLabel, playAt, sideToMove, type Line } from "./chess/line";

/** A side board. Tangents form a tree: parentId is the tangent it branched from (null = the game). */
export interface Tangent {
  id: string;
  parentId: string | null;
  title: string;
  author: "coach" | "student";
  line: Line;
  ply: number;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "coach"; id: string; text: string }
  | { kind: "tangent"; id: string; tangentId: string }
  | { kind: "tool"; id: string; text: string; status: "running" | "ok" | "error"; detail?: string }
  | { kind: "system"; id: string; text: string; error?: boolean };

export type Color = "white" | "black";

/**
 * Fixed when a game starts (a rated game can only be downgraded to practice).
 * rated: no engine, coach or takebacks until it's over, so it shows the student's real play.
 * practice: everything allowed.
 */
export type GameMode = "rated" | "practice";

/** A chess clock: starting time and increment per move, in seconds (3+2 blitz = 180, 2). */
export interface TimeControl {
  initial: number;
  increment: number;
}

export interface GameMeta {
  mode: GameMode;
  /** Null = no clock. */
  timeControl: TimeControl | null;
  /** "both" = free play, the student moves for both sides. */
  studentColor: Color | "both";
  /** Stockfish strength as a chess.com-scale rating (see toEngineElo); null = no opponent. */
  opponentElo: number | null;
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  termination: string | null;
  /** Practice games only. */
  takebacks: number;
}

interface State {
  gameId: number | null;
  meta: GameMeta;
  game: Line;
  gamePly: number;
  tangents: Record<string, Tangent>;
  active: string | null;
  orientation: Color;
  chat: ChatItem[];
  busy: boolean;
  /** When the current coach turn started, for the thinking indicator. */
  busySince: number | null;
  /** Coach text is streaming in right now. */
  streaming: boolean;
  sessionId: string | null;
  opponentThinking: boolean;
  /** Parallel to game.sans: the mover's clock in ms right after each move (null without a clock). */
  clocks: (number | null)[];
  /** When the side to move started thinking; their clock runs from here. */
  turnStartedAt: number | null;
}

/** Ids are stored in SQLite, so they must be unique across app runs. */
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export const FREE_PLAY: GameMeta = {
  mode: "practice",
  timeControl: null,
  studentColor: "both",
  opponentElo: null,
  result: null,
  termination: null,
  takebacks: 0,
};

export const useStore = create<State>(() => ({
  gameId: null,
  meta: FREE_PLAY,
  game: emptyLine(),
  gamePly: 0,
  tangents: {},
  active: null,
  orientation: "white",
  chat: [],
  busy: false,
  busySince: null,
  streaming: false,
  sessionId: null,
  opponentThinking: false,
  clocks: [],
  turnStartedAt: null,
}));

/** A rated game still being played: engine, coach, takebacks and side boards are off. */
export function isLocked(meta: GameMeta = get().meta): boolean {
  return meta.mode === "rated" && !meta.result;
}

/** Whether the student may move on the main board right now. */
export function canStudentMove(): boolean {
  const s = get();
  if (s.active) return true;
  if (s.meta.result) return false;
  if (s.meta.studentColor === "both") return true;
  // Against an opponent, moves are played at the end of the game only (going back is a takeback).
  const end = s.game.sans.length;
  return s.gamePly === end && sideToMove(s.game.fens[end]) === s.meta.studentColor;
}

/** e.g. "rated game: student plays White vs Stockfish 1500, in progress". */
export function gameDescription(): string {
  const { meta } = get();
  if (meta.studentColor === "both") return "practice, free play (student moves both sides, no opponent)";
  const side = meta.studentColor === "white" ? "White" : "Black";
  const state = meta.result ? `finished ${meta.result} by ${meta.termination}` : "in progress";
  const clock = meta.timeControl ? `, ${formatTimeControl(meta.timeControl)} clock` : ", no clock";
  const mode =
    meta.mode === "rated"
      ? "rated game (played without engine, coach or takebacks)"
      : `practice game (help allowed${meta.takebacks ? `, ${meta.takebacks} takeback${meta.takebacks > 1 ? "s" : ""}` : ""})`;
  const maia = meta.opponentElo && meta.opponentElo <= MAIA_MAX_RATING ? " (a bot trained to play like humans of that rating)" : "";
  return `${mode}: student plays ${side} vs ${opponentLabel(meta)}${maia}${clock}, ${state}`;
}

/** Maia-3 (human-like) plays up to this chess.com-scale rating, Stockfish above it. */
export const MAIA_MAX_RATING = 2000;
export const opponentName = (rating: number) => (rating <= MAIA_MAX_RATING ? "Maia" : "Stockfish");

/** "3+2", "10+0". */
export const formatTimeControl = (tc: TimeControl) => `${tc.initial / 60}+${tc.increment}`;

export function opponentLabel(meta: GameMeta): string {
  return meta.opponentElo ? `${opponentName(meta.opponentElo)} ${meta.opponentElo}` : "Free play";
}

const set = useStore.setState;
const get = useStore.getState;

/** The line and ply on the main board right now (game or open tangent). */
export function screen(): { line: Line; ply: number; tangent: Tangent | null } {
  const s = get();
  const t = s.active ? s.tangents[s.active] : null;
  return t ? { line: t.line, ply: t.ply, tangent: t } : { line: s.game, ply: s.gamePly, tangent: null };
}

export function screenFen(): string {
  const { line, ply } = screen();
  return line.fens[ply];
}

/** Ancestors of a tangent, root first, including itself. */
export function tangentPath(id: string | null): Tangent[] {
  const { tangents } = get();
  const path: Tangent[] = [];
  for (let t = id ? tangents[id] : undefined; t; t = t.parentId ? tangents[t.parentId] : undefined) {
    path.unshift(t);
  }
  return path;
}

export function pushChat(item: ChatItem) {
  set((s) => ({ chat: [...s.chat, item] }));
}

export function updateChat(id: string, patch: Partial<ChatItem>) {
  set((s) => ({ chat: s.chat.map((c) => (c.id === id ? ({ ...c, ...patch } as ChatItem) : c)) }));
}

export function addTangent(t: Omit<Tangent, "id">): Tangent {
  const tangent = { ...t, id: newId("t") };
  set((s) => ({ tangents: { ...s.tangents, [tangent.id]: tangent } }));
  return tangent;
}

export function openTangent(id: string | null) {
  set({ active: id });
}

export function goto(ply: number) {
  const { line, tangent } = screen();
  const p = Math.max(0, Math.min(line.sans.length, ply));
  if (tangent) set((s) => ({ tangents: { ...s.tangents, [tangent.id]: { ...tangent, ply: p } } }));
  else set({ gamePly: p });
}

export function step(delta: number) {
  goto(screen().ply + delta);
}

/**
 * A move made on the main board. In the game it truncates and appends. In a coach tangent,
 * playing the line's next move steps forward and anything else branches into a student tangent
 * (reusing one that starts the same way). Student tangents simply extend.
 */
export function boardMove(from: Key, to: Key) {
  const { line, ply, tangent } = screen();
  const played = playAt(line, ply, from, to);
  if (!played) return;

  if (!tangent) {
    if (!canStudentMove()) return;
    set({ game: played.line, gamePly: ply + 1 });
    return;
  }
  if (line.sans[ply] === played.san) {
    goto(ply + 1);
    return;
  }
  if (tangent.author === "student") {
    set((s) => ({ tangents: { ...s.tangents, [tangent.id]: { ...tangent, line: played.line, ply: ply + 1 } } }));
    return;
  }
  const fen = line.fens[ply];
  const existing = Object.values(get().tangents).find(
    (t) => t.parentId === tangent.id && t.line.startFen === fen && t.line.sans[0] === played.san,
  );
  if (existing) {
    set((s) => ({ active: existing.id, tangents: { ...s.tangents, [existing.id]: { ...existing, ply: 1 } } }));
    return;
  }
  const branch = playAt(emptyLine(fen), 0, from, to)!;
  const child = addTangent({
    parentId: tangent.id,
    title: `What if ${moveLabel(fen, branch.san)}?`,
    author: "student",
    line: branch.line,
    ply: 1,
  });
  openTangent(child.id);
}

export function flip() {
  set((s) => ({ orientation: s.orientation === "white" ? "black" : "white" }));
}
