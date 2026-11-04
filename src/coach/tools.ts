// Handlers for the tools declared in src-tauri/src/tools.rs.
import { Chess } from "chess.js";
import { buildLine, formatMoves, sideToMove } from "../chess/line";
import { formatScore, getEngine, pvToSan } from "../engine/stockfish";
import { invoke } from "@tauri-apps/api/core";
import { clockLeft, formatClock } from "../game/clock";
import { gamesText, profileText } from "./profile";
import { addTangent, gameDescription, newId, pushChat, screen, screenFen, tangentPath, useStore } from "../store";

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

Object.assign(handlers, {
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
