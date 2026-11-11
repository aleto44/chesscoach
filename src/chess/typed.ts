import { Chess } from "chess.js";
import type { Key } from "chessground/types";

/**
 * A move typed on the keyboard, read against the position: `ok` is a whole legal move, `partial`
 * could still become one, `bad` can't. Coordinates (e2e4, e7e8q, e2-e4) and SAN (Nf3, exd5, O-O,
 * nf3 in lower case) both work; x, +, # and = are optional.
 */
export interface Typed {
  status: "partial" | "ok" | "bad";
  from?: Key;
  to?: Key;
  /** Set when the text names the promotion piece; a promotion without one asks for it. */
  promotion?: string;
  needsPromotion?: boolean;
}

/** Characters a typed move can start with: a file, a piece letter, or castling. */
export const MOVE_START = /^[a-hA-HnNbBrRqQkKoO0]$/;
/** Characters a typed move can contain. */
export const MOVE_CHAR = /^[a-hA-H1-8nNbBrRqQkKoO0xX+#=-]$/;

const clean = (s: string) => s.replace(/[x+#=\-\s]/g, "").replace(/X/g, "").replace(/0/g, "O");

/** A move waiting in the typed premove queue. */
export interface Queued {
  from: Key;
  to: Key;
  promotion?: string;
}

/** The same position with `color` to move (the other side passes); en passant belongs to the passer, so it goes. */
function withTurn(fen: string, color: "w" | "b"): string {
  const parts = fen.split(" ");
  if (parts[1] === color) return fen;
  parts[1] = color;
  parts[3] = "-";
  return parts.join(" ");
}

/**
 * Where the student's next typed premove is read from: the position with the queued moves played and
 * the opponent passing in between, since their replies aren't known yet. Null when a queued move
 * isn't legal there.
 */
export function queuedPosition(fen: string, color: "white" | "black", queue: Queued[]): string | null {
  const c = color === "white" ? "w" : "b";
  let at = withTurn(fen, c);
  for (const m of queue) {
    try {
      const chess = new Chess(at);
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      at = withTurn(chess.fen(), c);
    } catch {
      return null;
    }
  }
  return at;
}

/** Whether a queued move is legal in the real position, now that it's the student's turn. */
export function legalNow(fen: string, m: Queued): boolean {
  try {
    new Chess(fen).move({ from: m.from, to: m.to, promotion: m.promotion });
    return true;
  } catch {
    return false;
  }
}

/**
 * `selected` is the square of a piece the student picked on the board: when two pieces can make the
 * typed move (Nd7 with knights on b8 and f6), the picked one plays it.
 */
export function readTyped(fen: string, text: string, selected?: Key): Typed {
  const input = clean(text);
  if (!input) return { status: "partial" };
  const lower = input.toLowerCase();
  const exact: { spelling: string; from: Key; to: Key; promotion?: string; needsPromotion?: boolean }[] = [];
  let prefix = false;
  for (const m of new Chess(fen).moves({ verbose: true })) {
    const from = m.from as Key;
    const to = m.to as Key;
    const san = clean(m.san);
    const spellings: [string, boolean][] = [
      [m.from + m.to + (m.promotion ?? ""), false],
      [san, false],
    ];
    // Leaving the piece off a promotion is fine: the picker asks for it.
    if (m.promotion) spellings.push([m.from + m.to, true], [san.slice(0, -1), true]);
    // Nd7 for Nbd7: leaving the disambiguation off still names the move, just not always one piece.
    const bare = m.piece.toUpperCase() + m.to;
    if (m.piece !== "p" && bare !== san && !san.startsWith("O")) spellings.push([bare, false]);
    for (const [spelling, needsPromotion] of spellings) {
      const sl = spelling.toLowerCase();
      if (sl === lower) exact.push({ spelling, from, to, promotion: needsPromotion ? undefined : m.promotion, needsPromotion });
      else if (sl.startsWith(lower)) prefix = true;
    }
  }
  // "bc3" is a pawn and "Bc3" a bishop: when lower case leaves two moves, the case decides.
  let hits = exact;
  const distinct = (list: typeof exact) => new Set(list.map((h) => h.from + h.to + (h.promotion ?? ""))).size;
  if (distinct(hits) > 1) {
    const byCase = hits.filter((h) => h.spelling[0] === input[0]);
    if (byCase.length) hits = byCase;
  }
  if (distinct(hits) > 1 && selected) {
    const picked = hits.filter((h) => h.from === selected);
    if (picked.length) hits = picked;
  }
  if (hits.length && distinct(hits) === 1) {
    const { from, to, promotion, needsPromotion } = hits[0];
    return { status: "ok", from, to, promotion, needsPromotion };
  }
  if (hits.length) return { status: "partial" };
  if (!prefix) return { status: "bad" };
  // Two characters that are one of the mover's pieces: that's where the move starts.
  const sq = /^[a-h][1-8]/.test(lower) ? (lower.slice(0, 2) as Key) : undefined;
  return { status: "partial", from: sq };
}
