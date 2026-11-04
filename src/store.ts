import { create } from "zustand";
import type { Key } from "chessground/types";
import { emptyLine, moveLabel, playAt, type Line } from "./chess/line";

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

export interface GameMeta {
  /** "both" = free play, the student moves for both sides. */
  studentColor: Color | "both";
  /** Stockfish strength; null = no opponent. */
  opponentElo: number | null;
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  termination: string | null;
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
}

/** Ids are stored in SQLite, so they must be unique across app runs. */
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export const FREE_PLAY: GameMeta = { studentColor: "both", opponentElo: null, result: null, termination: null };

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
}));

/** Whether the student may move on the main board right now. */
export function canStudentMove(): boolean {
  const s = get();
  if (s.active) return true;
  if (s.meta.result) return false;
  const turn = s.game.fens[s.gamePly].split(" ")[1] === "w" ? "white" : "black";
  return s.meta.studentColor === "both" || s.meta.studentColor === turn;
}

/** e.g. "student plays White vs Stockfish 1500, in progress". */
export function gameDescription(): string {
  const { meta } = get();
  if (meta.studentColor === "both") return "free play (student moves both sides, no opponent)";
  const side = meta.studentColor === "white" ? "White" : "Black";
  const state = meta.result ? `finished ${meta.result} by ${meta.termination}` : "in progress";
  return `student plays ${side} vs ${opponentLabel(meta)}, ${state}`;
}

export function opponentLabel(meta: GameMeta): string {
  return meta.opponentElo ? `Stockfish ${meta.opponentElo}` : "Free play";
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
