// "What if" moves on a line the student is reading (a game under review, the why-screen's lines).
// Playing a move that isn't the line's next one forks: the moves after it are set aside and the
// student's moves stack on from there. Stepping back to where the fork started drops it and the
// line's own moves come back.
import type { Key } from "chessground/types";
import { playAt, type Line } from "./line";

export interface Explore {
  /** The line as given. */
  base: Line;
  /** What's on the board: `base`, or base up to `forkAt` plus the student's moves. */
  line: Line;
  ply: number;
  /** Plies of `base` the fork keeps; null = not forked. */
  forkAt: number | null;
}

export const explore = (base: Line, ply = 0): Explore => ({ base, line: base, ply: clamp(ply, base), forkAt: null });

const clamp = (ply: number, line: Line) => Math.max(0, Math.min(line.sans.length, ply));

/** Steps to `ply`. Going back to the fork point (or before it) drops the fork. */
export function exploreGoto(x: Explore, ply: number): Explore {
  if (x.forkAt !== null && ply <= x.forkAt) return { ...x, line: x.base, forkAt: null, ply: clamp(ply, x.base) };
  return { ...x, ply: clamp(ply, x.line) };
}

/** A move on the board: the line's own next move steps forward, anything else forks. Null if illegal. */
export function exploreMove(x: Explore, from: Key, to: Key, promotion?: string): Explore | null {
  const played = playAt(x.line, x.ply, from, to, promotion);
  if (!played) return null;
  if (x.line.sans[x.ply] === played.san) return { ...x, ply: x.ply + 1 };
  return { ...x, line: played.line, ply: x.ply + 1, forkAt: x.forkAt ?? x.ply };
}

/** Whether ply index `i` (the move from fens[i] to fens[i+1]) is one of the student's own. */
export const isForkMove = (x: Pick<Explore, "forkAt">, i: number) => x.forkAt !== null && i >= x.forkAt;
