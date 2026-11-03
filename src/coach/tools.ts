// Handlers for the tools declared in src-tauri/src/tools.rs.
import { Chess } from "chess.js";
import { buildLine, formatMoves, sideToMove } from "../chess/line";
import { formatScore, getEngine, pvToSan } from "../engine/stockfish";
import { addTangent, newId, pushChat, screen, screenFen, tangentPath, useStore } from "../store";

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
      mode: "free play",
      focus: null,
      onScreenFen: screenFen(),
      game: {
        fen: s.game.fens[s.gamePly],
        moves: formatMoves(s.game),
        viewingPly: s.gamePly,
        totalPlies: s.game.sans.length,
        sideToMove: sideToMove(s.game.fens[s.gamePly]),
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
