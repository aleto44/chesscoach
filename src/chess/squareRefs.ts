// Squares and moves the coach names in chat show on the board on hover: a bare square ("h1") is
// highlighted, a move ("Qb3", "Bxh2+", "bxd6") is an arrow from the piece that makes it.
import { useEffect } from "react";
import { create } from "zustand";
import { Chess, type Square } from "chess.js";
import type { Element, ElementContent, Root } from "hast";

/** The square or move the mouse is over in the chat, as written; full-size boards show it. */
export const useHoverSquare = create<{ ref: string | null }>(() => ({ ref: null }));

export const hoverSquare = (ref: string | null) => useHoverSquare.setState({ ref });

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

// A SAN move or a bare square. The destination is the captured group; castling has none, so it's skipped.
const SQUARE_REF = /(?<![\w-])(?:[KQRBN][a-h]?[1-8]?x?|[a-h]x)?([a-h][1-8])(?:=[QRBN])?[+#!?]*(?![\w-])/g;

/**
 * Whose move a piece move in prose is, by the usual notation: "...Nf6" (or "7...Nf6") is Black's,
 * "Nf6" or "7.Nf6" is White's. Bare squares and pawn pushes name no side.
 */
function sideOf(before: string, ref: string): "w" | "b" | null {
  if (!/^[KQRBN]|^[a-h]x/.test(ref)) return null;
  return /(\.\.\.|\u2026)\s*$/.test(before) ? "b" : "w";
}

/** Splits a text into plain strings and square references (`ref`: the text, with the side it names). */
export function splitSquares(text: string): (string | { text: string; square: string; ref: string })[] {
  const out: (string | { text: string; square: string; ref: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(SQUARE_REF)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const side = sideOf(text.slice(0, m.index), m[0]);
    out.push({ text: m[0], square: m[1], ref: side ? `${side}:${m[0]}` : m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Rehype plugin: wraps square references in `<span class="sq-ref" data-square>`, except inside links and code. */
export function rehypeSquares() {
  const walk = (node: Root | Element) => {
    node.children = node.children.flatMap((child): ElementContent[] => {
      if (child.type === "element") {
        if (child.tagName !== "a" && child.tagName !== "code" && child.tagName !== "pre") walk(child);
        return [child];
      }
      if (child.type !== "text") return [child as ElementContent];
      return splitSquares(child.value).map((part) =>
        typeof part === "string"
          ? { type: "text", value: part }
          : {
              type: "element",
              tagName: "span",
              properties: { className: ["sq-ref"], dataRef: part.ref },
              children: [{ type: "text", value: part.text }],
            },
      );
    }) as Root["children"] & Element["children"];
  };
  return (tree: Root) => walk(tree);
}
