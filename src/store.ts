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

interface State {
  game: Line;
  gamePly: number;
  tangents: Record<string, Tangent>;
  active: string | null;
  orientation: "white" | "black";
  chat: ChatItem[];
  busy: boolean;
  sessionId: string | null;
}

let counter = 0;
export const newId = (prefix: string) => `${prefix}${++counter}`;

export const useStore = create<State>(() => ({
  game: emptyLine(),
  gamePly: 0,
  tangents: {},
  active: null,
  orientation: "white",
  chat: [],
  busy: false,
  sessionId: null,
}));

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

export function newGame() {
  set({ game: emptyLine(), gamePly: 0, active: null });
}

export function flip() {
  set((s) => ({ orientation: s.orientation === "white" ? "black" : "white" }));
}
