// What a quiet mistake costs in the position itself, when nothing is lost and nothing is threatened:
// a bishop shut in by its own pawns, pawns left doubled or isolated, a passed pawn handed over, the
// right to castle or the bishop pair gone. "White's position gets better" teaches nothing; "your pawn
// on e5 now blocks your bishop on g7" does. Worked out by comparing positions, no engine.
import { Chess, type Square } from "chess.js";
import type { Key } from "chessground/types";
import type { Color } from "../store";

/** A drawing for the position the fact is about (an arrow with `dest`, a circle without). */
export interface Mark {
  orig: Key;
  dest?: Key;
  brush: string;
}

export interface PositionalCost {
  /** The facts, as clauses that read after "but": "your pawn on e5 now blocks …". */
  facts: string[];
  marks: Mark[];
}

const FILES = "abcdefgh";
const at = (x: number, y: number) => `${FILES[x]}${y + 1}` as Square;
const xy = (s: string) => [s.charCodeAt(0) - 97, Number(s[1]) - 1] as const;
const side = (c: Color) => (c === "white" ? "w" : "b");
const sideName = (c: Color) => (c === "white" ? "White" : "Black");
const other = (c: Color): Color => (c === "white" ? "black" : "white");
const light = (s: string) => {
  const [x, y] = xy(s);
  return (x + y) % 2 === 1;
};

/** A side's bishop on light or dark squares, if it has exactly one. */
function bishopOn(chess: Chess, c: Color, lightSq: boolean): Square | null {
  const found = chess.findPiece({ type: "b", color: side(c) }).filter((s) => light(s) === lightSq);
  return found.length === 1 ? found[0] : null;
}

/**
 * The squares a bishop reaches with only pawns in the way (pieces move off a diagonal, pawns rarely
 * do), and its own pawns that stop it.
 */
function bishopReach(chess: Chess, sq: Square): { n: number; blockers: Square[] } {
  const me = chess.get(sq)!.color;
  const [x0, y0] = xy(sq);
  let n = 0;
  const blockers: Square[] = [];
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let x = x0 + dx, y = y0 + dy; x >= 0 && x < 8 && y >= 0 && y < 8; x += dx, y += dy) {
      const p = chess.get(at(x, y));
      if (p?.type === "p") {
        if (p.color === me) blockers.push(at(x, y));
        else n++;
        break;
      }
      n++;
    }
  }
  return { n, blockers };
}

/** Pawns per file for one side. */
function files(chess: Chess, c: Color): number[] {
  const n = Array(8).fill(0);
  for (const s of chess.findPiece({ type: "p", color: side(c) })) n[xy(s)[0]]++;
  return n;
}

const doubled = (chess: Chess, c: Color) => files(chess, c).flatMap((n, f) => (n >= 2 ? [f] : []));
const isolated = (chess: Chess, c: Color) => {
  const n = files(chess, c);
  return n.flatMap((k, f) => (k > 0 && !(n[f - 1] > 0) && !(n[f + 1] > 0) ? [f] : []));
};

/** A side's passed pawns. */
function passed(chess: Chess, c: Color): Square[] {
  const theirs = chess.findPiece({ type: "p", color: side(other(c)) }).map(xy);
  const up = c === "white" ? 1 : -1;
  return chess
    .findPiece({ type: "p", color: side(c) })
    .filter((s) => {
      const [x, y] = xy(s);
      return !theirs.some(([tx, ty]) => Math.abs(tx - x) <= 1 && (ty - y) * up > 0);
    });
}

/** Whether a side can still castle, or already has. */
function castles(chess: Chess, c: Color): boolean {
  const r = chess.getCastlingRights(side(c));
  const king = chess.findPiece({ type: "k", color: side(c) })[0];
  return r.k || r.q || (c === "white" ? ["g1", "c1", "b1", "h1"] : ["g8", "c8", "b8", "h8"]).includes(king);
}

const load = (fen: string) => {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
};

/**
 * What `mover` is worse off by in `end` (where the line after the move played settles) than at
 * `start` (before the move), leaving out anything `alt` (where the better move's line ends) has too:
 * a cost the better move also pays isn't why the move played was bad.
 */
export function positionalCost(start: string, end: string, alt: string | null, mover: Color): PositionalCost {
  const out: PositionalCost = { facts: [], marks: [] };
  const [s, e, a] = [load(start), load(end), alt ? load(alt) : null];
  if (!s || !e) return out;
  const opp = other(mover);

  // A bishop shut in by its own pawns.
  for (const lightSq of [true, false]) {
    const [bs, be] = [bishopOn(s, mover, lightSq), bishopOn(e, mover, lightSq)];
    if (!bs || !be) continue;
    const [rs, re] = [bishopReach(s, bs), bishopReach(e, be)];
    if (rs.n - re.n < 3 || re.n > 5) continue;
    const ba = a && bishopOn(a, mover, lightSq);
    if (ba && bishopReach(a, ba).n < re.n + 3) continue;
    const fresh = re.blockers.filter((p) => s.get(p)?.type !== "p" || s.get(p)?.color !== side(mover));
    if (!fresh.length) continue;
    const pawns = fresh.length === 1 ? `pawn on ${fresh[0]}` : `pawns on ${fresh.join(" and ")}`;
    out.facts.push(`your own ${pawns} now ${re.n <= 3 ? "shut" + (fresh.length === 1 ? "s" : "") + " in" : "block" + (fresh.length === 1 ? "s" : "")} your bishop on ${be}`);
    for (const p of fresh) out.marks.push({ orig: be as Key, dest: p as Key, brush: "red" });
  }

  // Pawns left doubled or isolated.
  const newOnly = (f: (c: Chess, m: Color) => number[]) => {
    const was = new Set(f(s, mover));
    const alsoAlt = new Set(a ? f(a, mover) : []);
    return f(e, mover).filter((k) => !was.has(k) && !alsoAlt.has(k));
  };
  const dbl = newOnly(doubled);
  const iso = newOnly(isolated);
  for (const k of new Set([...dbl, ...iso])) {
    const what = dbl.includes(k) && iso.includes(k) ? "doubled and isolated" : dbl.includes(k) ? "doubled" : "isolated";
    const many = files(e, mover)[k] > 1;
    out.facts.push(`your ${FILES[k]}-pawn${many ? "s are" : " is"} ${what}`);
    for (const p of e.findPiece({ type: "p", color: side(mover) }).filter((p) => p[0] === FILES[k])) out.marks.push({ orig: p as Key, brush: "red" });
  }

  // A passed pawn for the opponent.
  const wasPassed = new Set(passed(s, opp).map((p) => p[0]));
  const altPassed = new Set(a ? passed(a, opp).map((p) => p[0]) : []);
  for (const p of passed(e, opp).filter((p) => !wasPassed.has(p[0]) && !altPassed.has(p[0]))) {
    out.facts.push(`${sideName(opp)} gets a passed pawn on ${p}`);
    out.marks.push({ orig: p as Key, brush: "red" });
  }

  // The king stuck in the middle.
  if (castles(s, mover) && !castles(e, mover) && (!a || castles(a, mover))) {
    const king = e.findPiece({ type: "k", color: side(mover) })[0];
    out.facts.push(`your king can't castle any more`);
    if (king) out.marks.push({ orig: king as Key, brush: "red" });
  }

  // The bishop pair handed over.
  const pair = (c: Chess, m: Color) => c.findPiece({ type: "b", color: side(m) }).length >= 2;
  if (pair(s, mover) && !pair(e, mover) && pair(e, opp) && (!a || pair(a, mover))) out.facts.push(`${sideName(opp)} keeps the two bishops and you don't`);

  return out;
}
