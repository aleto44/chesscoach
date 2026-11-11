import { create } from "zustand";
import type { Key } from "chessground/types";
import { emptyLine, moveLabel, playAt, sideToMove, type Line } from "./chess/line";
import type { DrawShape } from "chessground/draw";
import type { MoveAnnotation } from "./analysis/review";
import { exploreGoto, exploreMove, type Explore } from "./chess/explore";
import type { RatingPool } from "./rating";

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
  | {
      kind: "tangent";
      id: string;
      tangentId: string;
      /** The coach's name for it ("s2"): its messages link to it as [words](#s2). */
      key?: string;
      /** The coach's arrows and circles, by ply of the tangent's line (0 = its start position). */
      shapes?: Record<number, DrawShape[]>;
      /** The side at the bottom of the board: the student's side in the position it's about. */
      orientation?: Color;
    }
  | { kind: "tool"; id: string; text: string; status: "running" | "ok" | "error"; detail?: string }
  | { kind: "system"; id: string; text: string; error?: boolean }
  | {
      kind: "quiz";
      id: string;
      tangentId: string;
      prompt: string;
      status: "waiting" | "checking" | "right" | "wrong" | "skipped";
      result?: string;
      /** The side at the bottom: the side the student is asked to move for. */
      orientation?: Color;
    };

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
  /** The opening line (SAN from the start) the opponent steers toward; null = free choice. */
  openingFocus: string[] | null;
  /** "both" = free play, the student moves for both sides. */
  studentColor: Color | "both";
  /** Stockfish strength as a chess.com-scale rating (see toEngineElo); null = no opponent. */
  opponentElo: number | null;
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  termination: string | null;
  /** Practice games only. */
  takebacks: number;
  /** A finished rated game: the student's rating before and after it (chess.com scale). */
  rating: { before: number; after: number; pool: RatingPool } | null;
  /** A game imported from chess.com or Lichess (games/import.ts); null for games played here. */
  imported?: ImportedFrom | null;
}

export type ImportSite = "chesscom" | "lichess";
export const SITE_NAME: Record<ImportSite, string> = { chesscom: "chess.com", lichess: "Lichess" };

export interface ImportedFrom {
  site: ImportSite;
  opponent: string;
  /** chess.com scale (Lichess ratings are converted on import). */
  opponentRating: number | null;
  studentRating: number | null;
  url: string | null;
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
  /** Post-game analysis, parallel to game.sans (empty until the game is over and analyzed). */
  annotations: (MoveAnnotation | null)[];
  /** Analysis in progress for the open game. */
  review: { done: number; total: number } | null;
  /** The game report (accuracy, move counts) is showing in the side column instead of the moves. */
  reportOpen: boolean;
  /** Arrows and circles the coach drew (draw_arrows), shown while that position is on screen. */
  arrows: { fen: string; shapes: DrawShape[] } | null;
  /**
   * "What if" moves on a finished game (see chess/explore.ts): the game up to gamePly, then the
   * student's moves. gamePly stays at the fork point; stepping back to it drops the fork.
   */
  gameFork: { line: Line; ply: number } | null;
}

/** Ids are stored in SQLite, so they must be unique across app runs. */
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export const FREE_PLAY: GameMeta = {
  mode: "practice",
  timeControl: null,
  openingFocus: null,
  studentColor: "both",
  opponentElo: null,
  result: null,
  termination: null,
  takebacks: 0,
  rating: null,
  imported: null,
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
  annotations: [],
  review: null,
  reportOpen: false,
  arrows: null,
  gameFork: null,
}));

// A different game (loaded, new or a move played) ends any what-if exploration of the old one.
useStore.subscribe((s, prev) => {
  if (s.game !== prev.game && s.gameFork) useStore.setState({ gameFork: null });
});

/** A rated game still being played: engine, coach, takebacks and side boards are off. */
export function isLocked(meta: GameMeta = get().meta): boolean {
  return meta.mode === "rated" && !meta.result;
}

/**
 * Whether the main board shows the eval bar and engine lines: always when reviewing a finished game,
 * otherwise the student's setting (`showEval`), and never during a rated game.
 */
export function evalShown(showEval: boolean, meta: GameMeta = get().meta): boolean {
  return !isLocked(meta) && (showEval || !!meta.result);
}

/** Whether the student may move on the main board right now. */
export function canStudentMove(): boolean {
  const s = get();
  if (s.active) return true;
  // A finished game: moves are "what if" moves (see boardMove).
  if (s.meta.result) return true;
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
  if (meta.imported) {
    const own = meta.imported.studentRating ? `, student rated ${meta.imported.studentRating}` : "";
    const tc = meta.timeControl ? `, ${formatTimeControl(meta.timeControl)}` : "";
    return (
      `game imported from the student's ${SITE_NAME[meta.imported.site]} account (a real game against a person, ` +
      `no help, so it counts like a rated game): student played ${side} vs ${opponentLabel(meta)}${own}${tc}, ` +
      `finished ${meta.result} by ${meta.termination}. Ratings are chess.com scale`
    );
  }
  const state = meta.result ? `finished ${meta.result} by ${meta.termination}` : "in progress";
  const clock = meta.timeControl ? `, ${formatTimeControl(meta.timeControl)} clock` : ", no clock";
  const focus = meta.openingFocus ? `, practicing the opening ${meta.openingFocus.join(" ")}` : "";
  const mode =
    meta.mode === "rated"
      ? "rated game (played without engine, coach or takebacks)"
      : `practice game (help allowed${meta.takebacks ? `, ${meta.takebacks} takeback${meta.takebacks > 1 ? "s" : ""}` : ""})`;
  const maia = meta.opponentElo && meta.opponentElo <= MAIA_MAX_RATING ? " (a bot trained to play like humans of that rating)" : "";
  return `${mode}: student plays ${side} vs ${opponentLabel(meta)}${maia}${clock}${focus}, ${state}`;
}

/** Maia-3 (human-like) plays up to this chess.com-scale rating, Stockfish above it. */
export const MAIA_MAX_RATING = 2000;
export const opponentName = (rating: number) => (rating <= MAIA_MAX_RATING ? "Maia" : "Stockfish");

/** "3+2", "10+0". */
export const formatTimeControl = (tc: TimeControl) => `${tc.initial / 60}+${tc.increment}`;

export function opponentLabel(meta: GameMeta): string {
  if (meta.imported) return meta.imported.opponent + (meta.imported.opponentRating ? ` (${meta.imported.opponentRating})` : "");
  return meta.opponentElo ? `${opponentName(meta.opponentElo)} ${meta.opponentElo}` : "Free play";
}

const set = useStore.setState;
const get = useStore.getState;

/** The line and ply on the main board right now (game or open tangent). */
export function screen(): { line: Line; ply: number; tangent: Tangent | null } {
  const s = get();
  const t = s.active ? s.tangents[s.active] : null;
  if (t) return { line: t.line, ply: t.ply, tangent: t };
  if (s.gameFork) return { line: s.gameFork.line, ply: s.gameFork.ply, tangent: null };
  return { line: s.game, ply: s.gamePly, tangent: null };
}

/** The game as an Explore (its fork, if any). */
function gameExplore(): Explore {
  const { game, gamePly, gameFork } = get();
  return gameFork
    ? { base: game, line: gameFork.line, ply: gameFork.ply, forkAt: gamePly }
    : { base: game, line: game, ply: gamePly, forkAt: null };
}

function setGameExplore(x: Explore) {
  if (x.forkAt === null) set({ gamePly: x.ply, gameFork: null });
  else set({ gamePly: x.forkAt, gameFork: { line: x.line, ply: x.ply } });
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

type ScenarioItem = Extract<ChatItem, { kind: "tangent" }>;

/** The chat card for a tangent the coach made (its key and drawings), if there is one. */
export function scenarioOf(chat: ChatItem[], tangentId: string | null): ScenarioItem | undefined {
  if (!tangentId) return undefined;
  return chat.find((c): c is ScenarioItem => c.kind === "tangent" && c.tangentId === tangentId);
}

type PovItem = Extract<ChatItem, { kind: "tangent" | "quiz" }>;

/**
 * The chat card that sets a side board's point of view: its own, or that of the nearest coach board
 * it branched from. A scenario keeps the side it was made for, not the game's.
 */
function povCard(s: State, tangentId: string | null): PovItem | undefined {
  for (let t = tangentId ? s.tangents[tangentId] : undefined; t; t = t.parentId ? s.tangents[t.parentId] : undefined) {
    const id = t.id;
    const card = s.chat.find((c): c is PovItem => (c.kind === "tangent" || c.kind === "quiz") && c.tangentId === id);
    if (card?.orientation) return card;
  }
  return undefined;
}

/** The side at the bottom of the main board: the open scenario's, else the game's. */
export function boardOrientation(s: State = get()): Color {
  return povCard(s, s.active)?.orientation ?? s.orientation;
}

/** The side at the bottom of a side board's thumbnail and when it opens. */
export function tangentOrientation(s: State, tangentId: string): Color {
  return povCard(s, tangentId)?.orientation ?? s.orientation;
}

/** The scenario a key ("s2") names. */
export function scenarioByKey(key: string): ScenarioItem | undefined {
  return get().chat.find((c): c is ScenarioItem => c.kind === "tangent" && c.key === key);
}

/** The next unused scenario key for this game's chat. */
export function nextScenarioKey(): string {
  const used = get().chat.filter((c) => c.kind === "tangent" && c.key).length;
  return `s${used + 1}`;
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
  else setGameExplore(exploreGoto(gameExplore(), p));
}

export function step(delta: number) {
  goto(screen().ply + delta);
}

/**
 * A move made on the main board. In the game it truncates and appends. In a coach tangent,
 * playing the line's next move steps forward and anything else branches into a student tangent
 * (reusing one that starts the same way). Student tangents simply extend.
 */
type MoveInterceptor = (tangent: Tangent, from: Key, to: Key, promotion?: string) => boolean;
let interceptor: MoveInterceptor | null = null;
/** Lets a feature (ask_move quizzes) claim moves on a tangent before the normal handling. */
export function setMoveInterceptor(fn: MoveInterceptor) {
  interceptor = fn;
}

/** `promotion`: "q", "r", "b" or "n" when a pawn reaches the last rank (default queen). */
export function boardMove(from: Key, to: Key, promotion?: string) {
  const { line, ply, tangent } = screen();
  if (tangent && interceptor?.(tangent, from, to, promotion)) return;
  const played = playAt(line, ply, from, to, promotion);
  if (!played) return;

  if (!tangent) {
    // A finished game takes "what if" moves; they fork off without changing the game.
    if (get().meta.result) {
      const x = exploreMove(gameExplore(), from, to, promotion);
      if (x) setGameExplore(x);
      return;
    }
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
  const branch = playAt(emptyLine(fen), 0, from, to, promotion)!;
  const child = addTangent({
    parentId: tangent.id,
    title: `What if ${moveLabel(fen, branch.san)}?`,
    author: "student",
    line: branch.line,
    ply: 1,
  });
  openTangent(child.id);
}

/** Flips the board on screen: an open scenario's own side, or the game's. */
export function flip() {
  const card = povCard(get(), get().active);
  if (card) updateChat(card.id, { orientation: card.orientation === "white" ? "black" : "white" });
  else set((s) => ({ orientation: s.orientation === "white" ? "black" : "white" }));
}
