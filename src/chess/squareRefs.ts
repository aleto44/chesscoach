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
  // Written square to square: the last hop is right there.
  const route = routeOf(ref);
  if (route) {
    const hop = route.hops[route.hops.length - 1];
    return { from: hop.from as Square, to: hop.to as Square };
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

/** The position with `side` to move (no en passant when that changes it). */
function turnTo(fen: string, side: "w" | "b"): string {
  const f = fen.split(" ");
  if (f[1] !== side) {
    f[1] = side;
    f[3] = "-";
  }
  return f.join(" ");
}

/** The position with `side` to move, or null if chess.js won't take it. */
function withTurn(fen: string, side: "w" | "b"): Chess | null {
  try {
    return new Chess(turnTo(fen, side));
  } catch {
    return null;
  }
}

// A move or route written square to square ("Nf6-e8", "...Nc5-e6-d4", "e2-e4", "Bc4xf7"), a SAN
// move, castling ("O-O", "0-0-0") or a bare square. The destination is the first or second captured
// group (castling has none: its squares depend on the side).
const SQUARE_REF =
  /(?<![\w-])(?:[KQRBN]?[a-h][1-8](?:[-x]([a-h][1-8]))+(?:=?[QRBN])?|(?:[KQRBN][a-h]?[1-8]?x?|[a-h]x)?([a-h][1-8])(?:=[QRBN])?|O-O(?:-O)?|0-0(?:-0)?)[+#!?]*(?![\w-])/g;

/** A token that names a move, not just a square: a piece move, a pawn capture or castling. */
const MOVE_TOKEN = /^[KQRBN]|^[a-h]x|^[O0]-|^[a-h][1-8][-x]/;

type UciMove = { from: string; to: string; promotion?: string };

/** A move or route written square to square: "Nc5-e6-d4" is the knight from c5 to e6, then d4. */
function routeOf(token: string): { piece?: string; hops: UciMove[] } | null {
  const m = token.match(/^([KQRBN])?([a-h][1-8](?:[-x][a-h][1-8])+)=?([QRBN])?/);
  if (!m) return null;
  const squares = m[2].match(/[a-h][1-8]/g)!;
  const hops: UciMove[] = squares.slice(1).map((to, i) => ({ from: squares[i], to }));
  if (m[3]) hops[hops.length - 1].promotion = m[3].toLowerCase();
  return { piece: m[1], hops };
}

/**
 * Whether a token written square to square is a move: any piece's, or a pawn's step or capture
 * ("b5-b4", "e4xd5"), not squares joined by a dash ("the c3-d4 chain", "the h2-b8 diagonal").
 */
function pawnStep(token: string): boolean {
  const route = routeOf(token);
  if (!route || route.piece) return true;
  if (route.hops.length !== 1) return false;
  const { from, to } = route.hops[0];
  const df = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const dr = Math.abs(Number(from[1]) - Number(to[1]));
  return token[2] === "x" ? df === 1 && dr === 1 : df === 0 && (dr === 1 || dr === 2);
}

/** The token as chess.js takes it: SAN, or the first hop of a move written square to square. */
function moveOf(token: string): string | UciMove {
  return routeOf(token)?.hops[0] ?? sanOf(token);
}

/** Castling written with zeros ("0-0") as chess.js reads it ("O-O"). */
const sanOf = (token: string) => token.replace(/[!?]+$/, "").replace(/^0-0(-0)?/, (c) => c.replace(/0/g, "O"));

/**
 * Whose move a move in prose is, by the usual notation: "...Nf6" or "...f5" (or "7...Nf6") is
 * Black's, "Nf6" or "7.Nf6" is White's. Bare squares and pawn pushes without dots name no side.
 */
function sideOf(before: string, ref: string): "w" | "b" | null {
  if (/(\.\.\.|\u2026)\s*$/.test(before)) return "b";
  return MOVE_TOKEN.test(ref) ? "w" : null;
}

/** What a text is about, so the moves it names can be placed. */
export interface RefContext {
  /** The position the text speaks from: a move in it is played from here unless it continues a line. */
  at?: string;
  /** The position after `at`'s move, where the text is read: the other side's threats are played from here. */
  now?: string;
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
const LINE_GAP = /^[\s,]*(?:\d+\s*(?:\.\.\.|…|\.)|\.\.\.|…)?\s*$/;
/** A reply told in words: "Bg3: if ...Bxg3 hxg3", "meet ...f5 with exf5". */
const REPLY_GAP = /^\s*[,;:]?\s*(?:and\s+)?(?:if|after|with|when|then)\s+(?:\d+\s*(?:\.\.\.|…|\.)|\.\.\.|…)?\s*$/;
/** Between two moves of one side's plan: "...g6, ...Bg7 and ...O-O", "Nf1 then Ng3". */
const PLAN_GAP = /^\s*,?\s*(?:(?:and|then|plus|and then|and later)\s+)?(?:\.\.\.|…)?\s*$/;

/** Between two moves that are alternatives from one position: "...Nc6 or ...Nd5". */
const OR_GAP = /^\s*,?\s*or\s+(?:\.\.\.|…)?\s*$/;

/** A line's next move after its last one, by the side to move and the move number. */
const numberFits = (fen: string, n: number, side: "w" | "b") => {
  const f = fen.split(" ");
  return f[1] === side && Number(f[5]) === n;
};

const turnOf = (fen: string) => (fen.split(" ")[1] === "b" ? "b" : "w");

/** The move `san` played from `fen`: its uci and the position after. */
function playSan(fen: string, san: string | UciMove): { uci: string; after: string } | null {
  try {
    const game = new Chess(fen);
    const m = game.move(typeof san === "string" ? moveOf(san) : san);
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
  // The line being written out: the position after its last move, its moves so far, who made the
  // last one, and where that one was played from (for an alternative to it).
  type Line = { fen: string; trail: string[]; side: "w" | "b"; base: { fen: string; trail: string[] } };
  let line: Line | null = null;
  // Bare squares since the last move: one may be the other side's pawn push that a move answers
  // ("White's e5 push is the danger. Answer ...dxe5").
  let squares: Exclude<TextPart, string>[] = [];
  for (const m of text.matchAll(SQUARE_REF)) {
    const gap = text.slice(last, m.index);
    if (m.index > last) out.push(gap);
    const token = m[0];
    const side = sideOf(text.slice(0, m.index), token);
    const num = gap.match(NUMBER);
    // "The c3-d4 chain": two squares, not a move.
    if (!pawnStep(token)) {
      out.push(token);
      last = m.index + token.length;
      line = null;
      continue;
    }
    const route = routeOf(token);
    // Set by playFrom (an object, so the compiler sees the closure's writes).
    const got: { place?: RefPlace; next?: Line } = {};
    const playOne = (fen: string, trail: string[], move: string | UciMove) => {
      const played = playSan(fen, move);
      if (!played) return false;
      got.place = { fen, uci: played.uci, ...(trail.length ? { trail } : {}) };
      got.next = { fen: played.after, trail: [...trail, played.uci], side: turnOf(fen), base: { fen, trail } };
      return true;
    };
    // A route's hops are all one side's moves: each but the last goes into the trail.
    const walk = (fen: string, trail: string[], hops: UciMove[]): boolean => {
      if (hops.length === 1) return playOne(fen, trail, hops[0]);
      const step = playSan(fen, hops[0]);
      return !!step && walk(turnTo(step.after, turnOf(fen)), [...trail, step.uci], hops.slice(1));
    };
    const playFrom = (fen: string, trail: string[] = []) => {
      if (!route) return playOne(fen, trail, token);
      // The piece (or pawn: "...b5-b4" from b7) may not be on the first square yet: it gets there first.
      const step = playSan(fen, (route.piece ?? "") + route.hops[0].from);
      const ok =
        walk(fen, trail, route.hops) ||
        (!!step && walk(turnTo(step.after, turnOf(fen)), [...trail, step.uci], route.hops));
      // An alternative to the route ("...Nc5-e6, or ...Nh5") starts where the route did.
      if (ok) got.next!.base = { fen, trail };
      return ok;
    };
    // Played by the side the text names: the other side's threat, Black's plan with White to move.
    const playAs = (fen: string, trail: string[] = []) => playFrom(side ? turnTo(fen, side) : fen, trail);
    // A move that only works after the other side pushes a pawn to a square named just before it:
    // that square was the push (nearest first), and the move answers it.
    const answersPush = () => {
      if (!side || !ctx.at) return false;
      const before = turnTo(ctx.at, side === "w" ? "b" : "w");
      for (const part of [...squares].reverse()) {
        const push = playSan(before, part.square);
        if (push && playAs(push.after, [push.uci])) {
          part.place = { fen: before, uci: push.uci };
          return true;
        }
      }
      return false;
    };
    // The next move of the line being written out (a bare "e5" counts here: it follows a move), or
    // the same side's next move in a plan ("...g6, ...Bg7"). A comma or "and" between two moves of
    // one side reads as a plan first; "...Bxg3, hxg3" is still a reply.
    // A reply in words needs the notation to name the other side: "...Bxg3" after White's move, a
    // move without dots after Black's.
    const other = !!line && (side === "b" ? line.side === "w" : side === "w" && line.side === "b");
    const reply = () =>
      !!line &&
      ((LINE_GAP.test(gap) && !(side === "b" && line.side === "b")) || (other && REPLY_GAP.test(gap))) &&
      playFrom(line.fen, line.trail);
    const plan = () => !!line && side === line.side && PLAN_GAP.test(gap) && playAs(line.fen, line.trail);
    const planFirst = side === line?.side && /,|\b(?:and|then|plus)\b/.test(gap);
    const alt = () => !!line && OR_GAP.test(gap) && playAs(line.base.fen, line.base.trail);
    if (!(alt() || (planFirst ? plan() || reply() : reply() || plan()))) {
      if (num) {
        const n = Number(num[1]);
        const numSide = num[2] === "." ? "w" : "b";
        const ply = ctx.game ? plyOf(ctx.game, n, numSide) : null;
        if (ctx.game && ply !== null) playFrom(ctx.game.fens[ply]);
        // Past the game's end ("8...dxc4" after "8.c4"): the line's next move, or the position's.
        else if (line && numberFits(line.fen, n, numSide)) playFrom(line.fen, line.trail);
        else if (ctx.at && numberFits(ctx.at, n, numSide)) playFrom(ctx.at);
      }
      // A bare square only counts as a move with a number ("12.e4") or dots ("...f5"); "the e4 pawn" is a square.
      const isMove = !!num || !!side;
      // A move the text names that can be played from where it speaks is about what comes next, even if
      // the same move was made before ("...Nf6" for the other knight); otherwise it may look back.
      const fromHere = !!ctx.at && !!playSan(side ? turnTo(ctx.at, side) : ctx.at, token);
      if (!got.place && !num && ctx.played && isMove && !fromHere) {
        const { fens, sans } = ctx.played;
        for (let i = sans.length - 1; i >= 0; i--)
          // "...Nxe4" is Black's; without the dots it could be either side's.
          if (bare(sans[i]) === bare(token) && (side !== "b" || fens[i].split(" ")[1] === "b")) {
            playFrom(fens[i]);
            break;
          }
      }
      // Where the text speaks from, then the earlier positions: first where it really is that side's
      // turn, then with the turn handed over.
      const natural = (fen: string) => !side || turnOf(fen) === side;
      const near = [ctx.at, ctx.now].filter((fen): fen is string => !!fen);
      const far = ctx.earlier ?? [];
      const tries = [...near.filter(natural), ...near.filter((f) => !natural(f)), ...far.filter(natural), ...far.filter((f) => !natural(f))];
      if (!got.place && isMove && ctx.at && !tries.some((fen) => playAs(fen)) && !answersPush()) {
        // Not legal from there (the other side's threat, a move further on): the old guess, on that
        // position. Not for a route, whose squares are given: an arrow from an empty square says nothing.
        const hit = route ? null : resolveRef(ctx.at, side ? `${side}:${token}` : token);
        if (hit?.from) got.place = { fen: ctx.at, uci: hit.from + hit.to };
      }
    }
    line = got.next ?? null;
    const { place } = got;
    const part = { text: token, square: m[1] ?? m[2] ?? "", ref: side ? `${side}:${token}` : token, ...(place ? { place } : {}) };
    out.push(part);
    squares = place || side || num ? [] : [...squares, part];
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
