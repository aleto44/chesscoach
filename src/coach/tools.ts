// Handlers for the tools declared in src-tauri/src/tools.rs.
import { Chess } from "chess.js";
import { buildLine, formatMoves, sideToMove } from "../chess/line";
import { formatScore, getEngine, pvToSan } from "../engine/stockfish";
import { invoke } from "@tauri-apps/api/core";
import { clockLeft, formatClock } from "../game/clock";
import { gamesText, profileText } from "./profile";
import { continuations, openingName } from "../openings/book";
import { START_FEN } from "../chess/line";
import { getRepertoire } from "../openings/repertoire";
import type { Key } from "chessground/types";
import { addTangent, openTangent, gameDescription, newId, pushChat, screen, screenFen, tangentPath, useStore } from "../store";

export interface ToolResult {
  text: string;
  isError?: boolean;
}

type Args = Record<string, unknown>;

const handlers: Record<string, (args: Args) => Promise<ToolResult>> = {
  async get_state() {
    const s = useStore.getState();
    const { tangent } = screen();
    const state = {
      mode: gameDescription(),
      focus: null,
      onScreenFen: screenFen(),
      game: {
        fen: s.game.fens[s.gamePly],
        moves: formatMoves(s.game),
        viewingPly: s.gamePly,
        totalPlies: s.game.sans.length,
        sideToMove: sideToMove(s.game.fens[s.gamePly]),
        clock: s.meta.timeControl && {
          white: formatClock(clockLeft("white")!),
          black: formatClock(clockLeft("black")!),
          // Seconds each move took, for spotting time trouble or rushed moves.
          moveTimes: moveTimes(),
        },
      },
      openTangent: tangent && {
        breadcrumbs: ["Game", ...tangentPath(tangent.id).map((t) => t.title)].join(" > "),
        startFen: tangent.line.startFen,
        moves: formatMoves(tangent.line),
        viewingPly: tangent.ply,
        fen: tangent.line.fens[tangent.ply],
        author: tangent.author,
      },
    };
    return { text: JSON.stringify(state, null, 2) };
  },

  async analyze(args) {
    const fen = typeof args.fen === "string" && args.fen ? args.fen : screenFen();
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch (e) {
      return { text: `Invalid FEN: ${(e as Error).message}`, isError: true };
    }
    if (chess.isGameOver()) {
      const why = chess.isCheckmate() ? "checkmate" : chess.isStalemate() ? "stalemate" : "draw";
      return { text: `No analysis: the position is over (${why}).` };
    }
    const multipv = clamp(Number(args.multipv ?? 3), 1, 5);
    const depth = clamp(Number(args.depth ?? 16), 8, 22);
    const lines = await getEngine().analyze(fen, multipv, depth);
    const head = `Position ${fen} (${sideToMove(fen)} to move). Scores are from White's point of view.`;
    const body = lines.map((l, i) => `${i + 1}. ${formatScore(l)} (depth ${l.depth})  ${pvToSan(fen, l.pv)}`);
    return { text: [head, ...body].join("\n") };
  },

  async show_line(args) {
    const start = typeof args.start_fen === "string" && args.start_fen ? args.start_fen : screenFen();
    const moves = Array.isArray(args.moves) ? args.moves.map(String) : [];
    const notes = Array.isArray(args.notes) ? args.notes.map(String) : [];
    if (moves.length === 0) return { text: "moves is empty.", isError: true };
    const built = buildLine(start, moves, notes);
    if ("error" in built) return { text: built.error, isError: true };

    const title = String(args.title ?? "Line");
    const tangent = addTangent({
      parentId: useStore.getState().active,
      title,
      author: "coach",
      line: built.line,
      ply: 0,
    });
    pushChat({ kind: "tangent", id: newId("c"), tangentId: tangent.id });
    const end = built.line.fens[built.line.fens.length - 1];
    return { text: `Shown to the student as "${title}": ${formatMoves(built.line)}\nFinal position: ${end}` };
  },
};

const SQUARE = /^[a-h][1-8]$/;
const BRUSHES: Record<string, string> = { green: "green", red: "red", blue: "blue", yellow: "yellow" };

Object.assign(handlers, {
  async book_lookup(args: Args) {
    let sans: string[];
    if (Array.isArray(args.moves)) sans = args.moves.map(String);
    else {
      const { line, ply } = screen();
      if (line.startFen !== START_FEN) return { text: "The board isn't a line from the starting position, so the book doesn't apply." };
      sans = line.sans.slice(0, ply);
    }
    const built = buildLine(START_FEN, sans);
    if ("error" in built) return { text: built.error, isError: true };
    const name = openingName(sans);
    const next = continuations(sans);
    const moves = [...new Set(next.map((n) => n.move))];
    const out = [
      name ? `Opening: ${name.name} (${name.eco})${name.moves.length < sans.length ? ", now out of the named line" : ""}.` : "No named opening.",
      moves.length
        ? `Book continuations: ${moves.map((m) => `${m} (${next.filter((n) => n.move === m).map((n) => n.opening.name).join(" / ")})`).join("; ")}.`
        : "The book has nothing further from here.",
    ];
    const rep = (await getRepertoire()).filter((r) => r.moves.length > sans.length && r.moves.slice(0, sans.length).every((m, i) => m === sans[i]));
    if (rep.length) out.push(`Student's repertoire continues: ${rep.map((r) => `${r.moves[sans.length]} (${r.color}, ${r.name})`).join("; ")}.`);
    return { text: out.join("\n") };
  },

  async setup_position(args: Args) {
    const fen = String(args.fen ?? "").trim();
    try {
      new Chess(fen);
    } catch (e) {
      return { text: `Invalid FEN: ${(e as Error).message}`, isError: true };
    }
    const built = buildLine(fen, []);
    if ("error" in built) return { text: built.error, isError: true };
    const title = String(args.title ?? "Position");
    const note = typeof args.note === "string" ? args.note : "";
    const tangent = addTangent({
      parentId: useStore.getState().active,
      title,
      author: "coach",
      line: { ...built.line, notes: [] },
      ply: 0,
    });
    pushChat({ kind: "tangent", id: newId("c"), tangentId: tangent.id });
    if (note) pushChat({ kind: "system", id: newId("c"), text: note });
    openTangent(tangent.id);
    return { text: `Opened "${title}" on the student's board (${sideToMove(fen)} to move).` };
  },

  async draw_arrows(args: Args) {
    const shapes: { orig: Key; dest?: Key; brush: string }[] = [];
    const bad: string[] = [];
    for (const a of Array.isArray(args.arrows) ? args.arrows : []) {
      const { from, to, color } = a as Record<string, string>;
      if (!SQUARE.test(from) || !SQUARE.test(to) || from === to) bad.push(`${from}-${to}`);
      else shapes.push({ orig: from as Key, dest: to as Key, brush: BRUSHES[color] ?? "green" });
    }
    for (const c of Array.isArray(args.circles) ? args.circles : []) {
      const { square, color } = c as Record<string, string>;
      if (!SQUARE.test(square)) bad.push(square);
      else shapes.push({ orig: square as Key, brush: BRUSHES[color] ?? "green" });
    }
    if (bad.length) return { text: `Not squares: ${bad.join(", ")}. Use e.g. "e4".`, isError: true };
    useStore.setState({ arrows: shapes.length ? { fen: screenFen(), shapes } : null });
    return { text: shapes.length ? `Drew ${shapes.length} on the board.` : "Cleared." };
  },

  async get_profile() {
    return { text: await profileText() };
  },

  async query_games(args: Args) {
    const mode = ["rated", "practice", "all"].includes(String(args.mode)) ? String(args.mode) : "rated";
    const gameId = Number.isFinite(Number(args.game_id)) && args.game_id !== undefined ? Number(args.game_id) : null;
    return { text: await gamesText(mode, clamp(Number(args.limit ?? 5), 1, 20), gameId) };
  },

  async record_observation(args: Args) {
    const tag = String(args.tag ?? "").trim();
    const note = String(args.note ?? "").trim();
    if (!tag || !note) return { text: "tag and note are required.", isError: true };
    await invoke("db_record_observation", {
      gameId: useStore.getState().gameId,
      tag,
      note,
      fen: typeof args.fen === "string" && args.fen ? args.fen : null,
    });
    return { text: "Saved." };
  },
} satisfies typeof handlers);

export async function handleTool(name: string, args: Args): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) return { text: `Unknown tool ${name}`, isError: true };
  try {
    return await handler(args);
  } catch (e) {
    return { text: `${name} failed: ${(e as Error).message}`, isError: true };
  }
}

/** One-line label for the chat's tool log. */
export function describeCall(name: string, args: Args): string {
  if (name === "show_line") return `show_line "${args.title ?? ""}"`;
  if (name === "analyze") return `analyze${args.depth ? ` depth ${args.depth}` : ""}`;
  if (name === "setup_position") return `setup_position "${args.title ?? ""}"`;
  return name;
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo;
}

/** "12. Nf3 (8s, 4:31 left)" for each move of a game with a clock. */
function moveTimes(): string[] {
  const { game, clocks, meta } = useStore.getState();
  if (!meta.timeControl) return [];
  const initial = meta.timeControl.initial * 1000;
  const inc = meta.timeControl.increment * 1000;
  return game.sans.map((san, i) => {
    const after = clocks[i];
    if (after === null || after === undefined) return san;
    const before = i >= 2 ? (clocks[i - 2] ?? initial) : initial;
    const spent = Math.max(0, before - (after - inc));
    const [, turn, , , , full] = game.fens[i].split(" ");
    return `${full}${turn === "w" ? "." : "..."} ${san} (${Math.round(spent / 1000)}s, ${formatClock(after)} left)`;
  });
}
