// Squares and moves the coach names in chat show on the board on hover: a bare square ("h1") is
// highlighted, a move ("Qb3", "Bxh2+", "bxd6") is an arrow from the piece that makes it.
import { useEffect } from "react";
import { create } from "zustand";
import { Chess, type Square } from "chess.js";
import type { Element, ElementContent, Root } from "hast";

/**
 * Where a move named in text is played from, when the text makes that clear: the position the
 * text speaks from, a move further down a line written out, or a numbered move of the game.
 * Without one, the move is looked for on whatever position the board shows.
 */
export interface RefPlace {
  /** The position before the move. */
  fen: string;
  /** The move itself, "e2e4" (none for a move only guessed at). */
  uci?: string;
  /** The line's earlier moves that led to `fen` (uci), drawn on the board while it's shown. */
  trail?: string[];
}

/** The square or move the mouse is over in text, as written, and where it's played from; full-size boards show it. */
export const useHoverSquare = create<{ ref: string | null; place: RefPlace | null }>(() => ({ ref: null, place: null }));

export const hoverSquare = (ref: string | null, place: RefPlace | null = null) =>
  useHoverSquare.setState({ ref, place: ref ? place : null });

/** Whether the hovered reference is this one: the same words from the same position. */
export const sameRef = (a: { ref: string | null; place: RefPlace | null }, ref: string, place?: RefPlace | null) =>
  a.ref === ref && (a.place?.fen ?? null) === (place?.fen ?? null) && (a.place?.uci ?? null) === (place?.uci ?? null);

/** Same position, ignoring the move counters (and en passant, which chess.js writes only sometimes). */
export const samePosition = (a: string, b: string) => a.split(" ").slice(0, 3).join(" ") === b.split(" ").slice(0, 3).join(" ");

/** The position after `uci` from `fen`, or null if it isn't legal there. */
export function afterUci(fen: string, uci: string): string | null {
  try {
    const game = new Chess(fen);
    game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
    return game.fen();
  } catch {
    return null;
  }
}

/** Phones: a tapped move stays on the board until a tap anywhere else (not a mouse click). */
export function useTapAway() {
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !useHoverSquare.getState().ref) return;
      if (!(e.target instanceof Element && e.target.closest(".sq-ref"))) hoverSquare(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, []);
}

const REF_PARTS = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])/;

/**
 * Where a hovered reference points on a board showing `fen`: `from` is set for a move whose piece
 * can be found. A ref may start with the side the text names ("w:" or "b:", see splitSquares); that
 * side is tried first, then the other, since the coach talks about both. Failing that (a move further
 * down a line), a piece of the right kind that attacks the square, or the only one.
 */
export function resolveRef(fen: string, ref: string): { from?: Square; to: Square } | null {
  const named = ref.match(/^([wb]):/)?.[1] as "w" | "b" | undefined;
  if (named) ref = ref.slice(2);
  const turn0 = fen.split(" ")[1] === "b" ? "b" : "w";
  const castle = ref.match(/^[O0]-[O0](-[O0])?/);
  if (castle) {
    // The king's move, for the side that can castle that way (the named side, else the one to move,
    // else the other); failing that, the named side's king from its home square.
    const first = named ?? turn0;
    for (const side of first === "w" ? (["w", "b"] as const) : (["b", "w"] as const)) {
      try {
        const move = withTurn(fen, side)?.move(sanOf(ref));
        if (move) return { from: move.from, to: move.to };
      } catch {
        // Can't castle that way here.
      }
    }
    const rank = first === "w" ? "1" : "8";
    return { from: `e${rank}` as Square, to: `${castle[1] ? "c" : "g"}${rank}` as Square };
  }
  const m = ref.match(REF_PARTS);
  if (!m) return null;
  const [, piece, file, rank, capture] = m;
  const to = m[5] as Square;
  if (!piece && !capture) return { to };
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const first = named ?? turn;
  const sides = first === "w" ? (["w", "b"] as const) : (["b", "w"] as const);
  for (const side of sides) {
    const game = withTurn(fen, side);
    if (!game) continue;
    try {
      const move = game.move(ref.replace(/[!?]+$/, ""));
      if (move.to === to) return { from: move.from, to };
    } catch {
      // Not legal for this side here.
    }
  }
  const game = withTurn(fen, turn);
  if (!game) return { to };
  const type = (piece ?? "p").toLowerCase();
  for (const side of sides) {
    const from = game
      .attackers(to, side)
      .find((sq) => game.get(sq)?.type === type && (!file || sq[0] === file) && (!rank || sq[1] === rank));
    if (from) return { from, to };
  }
  // Still nothing (the path is blocked now): the only piece of that kind, side to move first.
  if (type !== "p") {
    for (const side of sides) {
      const pieces = game
        .board()
        .flat()
        .filter((p) => p && p.type === type && p.color === side && (!file || p.square[0] === file) && (!rank || p.square[1] === rank));
      if (pieces.length === 1) return { from: pieces[0]!.square, to };
    }
  }
  return { to };
}

/** The position with `side` to move (no en passant), or null if chess.js won't take it. */
function withTurn(fen: string, side: "w" | "b"): Chess | null {
  const f = fen.split(" ");
  if (f[1] !== side) {
    f[1] = side;
    f[3] = "-";
  }
  try {
    return new Chess(f.join(" "));
  } catch {
    return null;
  }
}

// A SAN move, castling ("O-O", "0-0-0") or a bare square. The destination is the captured group
// (castling has none: its squares depend on the side).
const SQUARE_REF =
  /(?<![\w-])(?:(?:[KQRBN][a-h]?[1-8]?x?|[a-h]x)?([a-h][1-8])(?:=[QRBN])?|O-O(?:-O)?|0-0(?:-0)?)[+#!?]*(?![\w-])/g;

/** A token that names a move, not just a square: a piece move, a pawn capture or castling. */
const MOVE_TOKEN = /^[KQRBN]|^[a-h]x|^[O0]-/;

/** Castling written with zeros ("0-0") as chess.js reads it ("O-O"). */
const sanOf = (token: string) => token.replace(/[!?]+$/, "").replace(/^0-0(-0)?/, (c) => c.replace(/0/g, "O"));

/**
 * Whose move a piece move in prose is, by the usual notation: "...Nf6" (or "7...Nf6") is Black's,
 * "Nf6" or "7.Nf6" is White's. Bare squares and pawn pushes name no side.
 */
function sideOf(before: string, ref: string): "w" | "b" | null {
  if (!MOVE_TOKEN.test(ref)) return null;
  return /(\.\.\.|\u2026)\s*$/.test(before) ? "b" : "w";
}

/** What a text is about, so the moves it names can be placed. */
export interface RefContext {
  /** The position the text speaks from: a move in it is played from here unless it continues a line. */
  at?: string;
  /** Positions just before `at`, nearest first: a move that isn't legal at `at` may be from one of these. */
  earlier?: string[];
  /** A game the text quotes by move number ("35...Kf6"): fens[i] is the position before ply i. */
  game?: { fens: string[] };
  /**
   * Moves the text looks back on (a plan at the end of a line: "...Nxe4 won the pawn"): a move it
   * names that was played there is shown where it was played (the latest time), not from `at`.
   */
  played?: { fens: string[]; sans: string[] };
}

const bare = (san: string) => san.replace(/[+#!?]/g, "");

export type TextPart = string | { text: string; square: string; ref: string; place?: RefPlace };

/** A move number right before a move: "35." or "35..." (and so the side). */
const NUMBER = /(\d+)\s*(\.\.\.|…|\.)\s*$/;
/** Between two moves of one line there's only space, a comma, or the next move number. */
const LINE_GAP = /^[\s,]*(?:\d+\s*(?:\.\.\.|…|\.)\s*)?$/;

/** The move `san` played from `fen`: its uci and the position after. */
function playSan(fen: string, san: string): { uci: string; after: string } | null {
  try {
    const game = new Chess(fen);
    const m = game.move(sanOf(san));
    return { uci: m.from + m.to + (m.promotion ?? ""), after: game.fen() };
  } catch {
    return null;
  }
}

/** The ply a numbered move is in `game` ("35..." is Black's 35th move), if the game reaches it. */
function plyOf(game: { fens: string[] }, n: number, side: "w" | "b"): number | null {
  const [, turn, , , , full] = game.fens[0].split(" ");
  const ply = (n - Number(full)) * 2 + (side === "b" ? 1 : 0) - (turn === "b" ? 1 : 0);
  return ply >= 0 && ply < game.fens.length ? ply : null;
}

/**
 * Splits a text into plain strings and square references (`ref`: the text, with the side it names).
 * With a context, each move gets the position it's played from: a run of moves written as a line
 * ("35...Qe4 36.Qc3 Qg4+") is played out one after another, a numbered move is found in the game,
 * and any other move is played from the position the text speaks from.
 */
export function splitSquares(text: string, ctx: RefContext = {}): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  // The line being written out: the position after its last move, and its moves so far.
  let line: { fen: string; trail: string[] } | null = null;
  for (const m of text.matchAll(SQUARE_REF)) {
    const gap = text.slice(last, m.index);
    if (m.index > last) out.push(gap);
    const token = m[0];
    const side = sideOf(text.slice(0, m.index), token);
    const num = gap.match(NUMBER);
    // Set by playFrom (an object, so the compiler sees the closure's writes).
    const got: { place?: RefPlace; next?: { fen: string; trail: string[] } } = {};
    const playFrom = (fen: string, trail: string[] = []) => {
      const played = playSan(fen, token);
      if (!played) return false;
      got.place = { fen, uci: played.uci, ...(trail.length ? { trail } : {}) };
      got.next = { fen: played.after, trail: [...trail, played.uci] };
      return true;
    };
    // The next move of the line being written out (a bare "e5" counts here: it follows a move).
    if (!(line && LINE_GAP.test(gap) && playFrom(line.fen, line.trail))) {
      if (num && ctx.game) {
        const ply = plyOf(ctx.game, Number(num[1]), num[2] === "." ? "w" : "b");
        if (ply !== null) playFrom(ctx.game.fens[ply]);
      }
      if (!got.place && !num && ctx.played && MOVE_TOKEN.test(token)) {
        const { fens, sans } = ctx.played;
        for (let i = sans.length - 1; i >= 0; i--)
          // "...Nxe4" is Black's; without the dots it could be either side's.
          if (bare(sans[i]) === bare(token) && (side !== "b" || fens[i].split(" ")[1] === "b")) {
            playFrom(fens[i]);
            break;
          }
      }
      // A bare square only counts as a move with a number ("12.e4"); "the e4 pawn" is a square.
      const isMove = !!num || MOVE_TOKEN.test(token);
      if (!got.place && isMove && ctx.at && !playFrom(ctx.at) && !ctx.earlier?.some((fen) => playFrom(fen))) {
        // Not legal from there (the other side's threat, a move further on): the old guess, on that position.
        const hit = resolveRef(ctx.at, side ? `${side}:${token}` : token);
        if (hit?.from) got.place = { fen: ctx.at, uci: hit.from + hit.to };
      }
    }
    line = got.next ?? null;
    const { place } = got;
    out.push({ text: token, square: m[1] ?? "", ref: side ? `${side}:${token}` : token, ...(place ? { place } : {}) });
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Rehype plugin: wraps square references in `<span class="sq-ref" data-ref>`, except inside links
 * and code. A reference with a place carries it as data-fen / data-uci / data-trail.
 */
export function rehypeSquares(ctx: RefContext = {}) {
  const walk = (node: Root | Element) => {
    node.children = node.children.flatMap((child): ElementContent[] => {
      if (child.type === "element") {
        if (child.tagName !== "a" && child.tagName !== "code" && child.tagName !== "pre") walk(child);
        return [child];
      }
      if (child.type !== "text") return [child as ElementContent];
      return splitSquares(child.value, ctx).map((part) =>
        typeof part === "string"
          ? { type: "text", value: part }
          : {
              type: "element",
              tagName: "span",
              properties: {
                className: ["sq-ref"],
                dataRef: part.ref,
                ...(part.place ? { dataFen: part.place.fen } : {}),
                ...(part.place?.uci ? { dataUci: part.place.uci } : {}),
                ...(part.place?.trail ? { dataTrail: part.place.trail.join(" ") } : {}),
              },
              children: [{ type: "text", value: part.text }],
            },
      );
    }) as Root["children"] & Element["children"];
  };
  return (tree: Root) => walk(tree);
}

/** A place read back from a rehype span's data attributes. */
export function placeFromData(props: Record<string, unknown>): RefPlace | null {
  const fen = props["data-fen"];
  if (typeof fen !== "string") return null;
  const uci = props["data-uci"];
  const trail = props["data-trail"];
  return {
    fen,
    ...(typeof uci === "string" ? { uci } : {}),
    ...(typeof trail === "string" && trail ? { trail: trail.split(" ") } : {}),
  };
}
