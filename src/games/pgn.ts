// Reading PGN: the headers, the main line's moves and the clock comments ({[%clk 0:02:59.9]}) that
// chess.com and Lichess put after each move. Variations and other comments are skipped.
import { buildLine, START_FEN, type Line } from "../chess/line";

export interface ParsedGame {
  headers: Record<string, string>;
  line: Line;
  /** Parallel to line.sans: the mover's clock right after the move, ms (null where the PGN has none). */
  clocks: (number | null)[];
}

/** "0:02:59.9" → 179900. */
function clockMs(s: string): number | null {
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}

/** Splits a PGN file into its games (a blank line before each new header block). */
export function splitPgn(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n(?=\s*\[)/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

/** Parses one game. Throws when a move doesn't replay. */
export function parsePgn(pgn: string): ParsedGame {
  const headers: Record<string, string> = {};
  const text = pgn.replace(/\r\n?/g, "\n");
  let body = text.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, key: string, value: string) => {
    headers[key] = value.replace(/\\(.)/g, "$1");
    return "";
  });
  // Rest-of-line comments; then the movetext token by token.
  body = body.replace(/;[^\n]*/g, "");
  const sans: string[] = [];
  const clocks: (number | null)[] = [];
  let depth = 0;
  const token = /\{([^}]*)\}|(\()|(\))|(\$\d+)|(\d+\.(?:\.\.)?)|(1-0|0-1|1\/2-1\/2|\*)|([^\s{}()]+)/g;
  for (let m; (m = token.exec(body)); ) {
    const [, comment, open, close, , , , move] = m;
    if (open) depth++;
    else if (close) depth = Math.max(0, depth - 1);
    else if (depth > 0) continue;
    else if (comment !== undefined) {
      const clk = comment.match(/\[%clk\s+([\d:.]+)\]/);
      if (clk && clocks.length) clocks[clocks.length - 1] = clockMs(clk[1]);
    } else if (move) {
      const san = move.replace(/^\d+\.+/, "").replace(/[!?]+$/, "");
      if (!san) continue;
      sans.push(san);
      clocks.push(null);
    }
  }
  const startFen = headers.SetUp === "1" && headers.FEN ? headers.FEN : START_FEN;
  const built = buildLine(startFen, sans);
  if ("error" in built) throw new Error(built.error);
  return { headers, line: built.line, clocks };
}
