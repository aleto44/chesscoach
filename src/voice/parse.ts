import { Chess, type Move } from "chess.js";

/**
 * Spoken moves, read against the position. Any way of saying a move works: "d3", "pawn to d3", "play
 * the pawn to d3", "knight takes e4", "N e4", "b knight to d4", "castles queen side", "e8 promote to
 * queen", "bishop e4 check". The words become a query (piece, squares, capture, ...) that is matched
 * against the legal moves, so the position settles most of what speech gets wrong: a misheard "b4"
 * when only d4 is legal still finds d4, it just isn't `sure` and waits for a yes.
 *
 * No imports from the app, so scripts/check-voice.mjs can run it under node.
 */

export interface VoiceMove {
  from: string;
  to: string;
  /** Unset on a promotion whose piece wasn't said (see `needsPromotion`). */
  promotion?: string;
  san: string;
}

export type Heard =
  /**
   * `moves` has one entry when the words name one move, more when they fit several ("knight e4" with
   * two knights). `sure`: the words named it as said; false when something had to be dropped or
   * guessed (a misheard letter, a "takes" that isn't a capture).
   */
  | { kind: "move"; moves: VoiceMove[]; sure: boolean; needsPromotion: boolean }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "nothing" };

export interface VoiceWords {
  /** Phrases that play the move waiting for a yes, e.g. ["yes", "confirm"]. */
  confirm: string[];
  cancel: string[];
}

export const DEFAULT_CONFIRM = ["yes", "confirm"];
export const DEFAULT_CANCEL = ["no", "cancel"];

const FILES: Record<string, string> = {
  a: "a", alpha: "a", ay: "a",
  b: "b", bee: "b", be: "b", bravo: "b",
  c: "c", see: "c", sea: "c", charlie: "c",
  d: "d", dee: "d", delta: "d",
  e: "e", echo: "e",
  f: "f", ef: "f", eff: "f", foxtrot: "f",
  g: "g", gee: "g", golf: "g",
  h: "h", aitch: "h", hotel: "h",
};
const RANKS: Record<string, string> = {
  one: "1", won: "1", two: "2", too: "2", three: "3", four: "4", fore: "4", five: "5",
  six: "6", seven: "7", eight: "8", ate: "8",
  "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8",
};
const PIECES: Record<string, string> = {
  pawn: "p", pawns: "p", knight: "n", knights: "n", night: "n", bishop: "b", bishops: "b",
  rook: "r", rooks: "r", rock: "r", queen: "q", queens: "q", king: "k", kings: "k",
};
const CAPTURE = new Set(["takes", "take", "taking", "captures", "capture", "capturing", "x", "by", "eats"]);
const CASTLE = new Set(["castle", "castles", "castling", "castled"]);
const SHORT = new Set(["short", "kingside"]);
const LONG = new Set(["long", "queenside"]);
const PROMOTE = new Set(["promote", "promotes", "promoting", "promotion", "promoted", "equals"]);
const FROM = new Set(["from", "on"]);
const CHECK = new Set(["check", "checkmate", "mate"]);
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };
/** Words that carry nothing: "play the pawn to d3" is "pawn d3". */
const FILLER = new Set([
  "play", "move", "moves", "the", "my", "to", "then", "please", "go", "goes", "with", "side", "and", "at",
  "into", "his", "her", "your", "one's", "it", "piece", "square", "i", "um", "uh", "okay", "ok",
]);

/** Letters that sound alike (the "e-set"), tried when the words as heard name no legal move. */
const SOUND_ALIKE: Record<string, string[]> = {
  b: ["d", "e", "g", "c"], c: ["e", "g", "b", "d"], d: ["b", "e", "g", "c"], e: ["b", "d", "g", "c"],
  g: ["b", "d", "e", "c"], a: ["h"], h: ["a"], f: [],
};

/** Every word the parser knows, for the recognizer's grammar (plus the student's confirm/cancel words). */
export function vocabulary(words: VoiceWords): string[] {
  const all = new Set<string>([
    ...["a", "b", "c", "d", "e", "f", "g", "h", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"],
    ...["one", "two", "three", "four", "five", "six", "seven", "eight"],
    ...["pawn", "knight", "bishop", "rook", "queen", "king"],
    ...["takes", "captures", "castle", "castles", "short", "long", "kingside", "queenside", "side"],
    ...["promote", "promotes", "equals", "from", "on", "check", "checkmate", "mate", "first", "second", "third"],
    ...["play", "move", "the", "my", "to", "then"],
    ...[...words.confirm, ...words.cancel].flatMap((w) => normalize(w).split(" ")),
  ]);
  return [...all].filter(Boolean);
}

type Tok =
  | { t: "piece"; p: string }
  | { t: "file"; f: string; word: string }
  | { t: "rank"; r: string; word: string }
  | { t: "capture" | "castle" | "short" | "long" | "promote" | "from" | "check" | "to" }
  | { t: "ordinal"; n: number };

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/king side/g, "kingside")
    .replace(/queen side/g, "queenside")
    .replace(/[^a-z0-9#+=\-' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** One word, or a written move a recognizer may hand over ("e4", "Nf3", "exd5", "O-O"), as tokens. */
function wordTokens(w: string): Tok[] {
  if (/^[o0]-[o0](-[o0])?$/.test(w)) return [{ t: "castle" }, { t: w.length > 3 ? "long" : "short" }];
  const san = /^([nbrqk])?([a-h])?([1-8])?(x)?([a-h])([1-8])(=?([qrbn]))?[+#]?$/.exec(w);
  if (san && w.length > 1) {
    const out: Tok[] = [];
    if (san[1]) out.push({ t: "piece", p: san[1] });
    if (san[2]) out.push({ t: "file", f: san[2], word: san[2] });
    if (san[3]) out.push({ t: "rank", r: san[3], word: san[3] });
    if (san[4]) out.push({ t: "capture" });
    out.push({ t: "file", f: san[5], word: san[5] }, { t: "rank", r: san[6], word: san[6] });
    if (san[8]) out.push({ t: "promote" }, { t: "piece", p: san[8] });
    return out;
  }
  if (w in FILES) return [{ t: "file", f: FILES[w], word: w }];
  if (w in RANKS) return [{ t: "rank", r: RANKS[w], word: w }];
  if (w in PIECES) return [{ t: "piece", p: PIECES[w] }];
  if (w in ORDINALS) return [{ t: "ordinal", n: ORDINALS[w] }];
  if (CAPTURE.has(w)) return [{ t: "capture" }];
  if (CASTLE.has(w)) return [{ t: "castle" }];
  if (SHORT.has(w)) return [{ t: "short" }];
  if (LONG.has(w)) return [{ t: "long" }];
  if (PROMOTE.has(w)) return [{ t: "promote" }];
  if (FROM.has(w)) return [{ t: "from" }];
  if (CHECK.has(w)) return [{ t: "check" }];
  if (w === "to") return [{ t: "to" }];
  return [];
}

function tokenize(text: string): Tok[] {
  const said = normalize(text)
    .split(" ")
    .filter((w) => w && !(FILLER.has(w) && w !== "to"));
  // "Move a pawn to d4": an "a" in front of a piece is the article, not the a-file.
  const toks = said.filter((w, i) => !(w === "a" && said[i + 1] in PIECES && !(said[i - 1] in FILES))).flatMap(wordTokens);
  // "knight to e4" is often heard as "knight two e4": a "two" that isn't after a file and comes
  // right before one is the word "to".
  // And "e8" as "e a": an "a" right after a file, with no rank after it, is the eight.
  return toks.map((tok, i): Tok =>
    tok.t === "rank" && tok.r === "2" && /^(two|too)$/.test(tok.word) && toks[i - 1]?.t !== "file" && toks[i + 1]?.t === "file"
      ? { t: "to" }
      : tok.t === "file" && tok.word === "a" && toks[i - 1]?.t === "file" && toks[i + 1]?.t !== "rank"
        ? { t: "rank", r: "8", word: "a" }
        : tok,
  );
}

interface Query {
  piece?: string;
  to?: string;
  /** The destination's file alone: "e takes d" (exd5). */
  toFile?: string;
  fromSq?: string;
  fromFile?: string;
  fromRank?: string;
  capture: boolean;
  check: boolean;
  castle?: "k" | "q" | "any";
  promotion?: string;
  promote: boolean;
  ordinal?: number;
}

function query(toks: Tok[]): Query {
  const q: Query = { capture: toks.some((t) => t.t === "capture"), check: toks.some((t) => t.t === "check"), promote: false };
  const used = new Set<number>();
  const squares: { sq: string; at: number }[] = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (a.t === "file" && b.t === "rank" && !used.has(i)) {
      squares.push({ sq: a.f + b.r, at: i });
      used.add(i).add(i + 1);
    }
  }
  if (toks.some((t) => t.t === "castle")) {
    const short = toks.some((t) => t.t === "short" || (t.t === "piece" && t.p === "k"));
    const long = toks.some((t) => t.t === "long" || (t.t === "piece" && t.p === "q"));
    q.castle = short && !long ? "k" : long && !short ? "q" : "any";
    return q;
  }
  let destAt = toks.length;
  if (squares.length === 1 && toks[squares[0].at - 1]?.t === "from") q.fromSq = squares[0].sq;
  else if (squares.length) {
    const dest = squares[squares.length - 1];
    q.to = dest.sq;
    destAt = dest.at;
    if (squares.length > 1) q.fromSq = squares[0].sq;
  }
  const promoteAt = toks.findIndex((t) => t.t === "promote");
  q.promote = promoteAt >= 0;
  const promoFrom = promoteAt >= 0 ? promoteAt : q.to ? destAt : toks.length;
  toks.forEach((t, i) => {
    if (t.t === "piece") {
      if (i > promoFrom) q.promotion ??= t.p === "p" || t.p === "k" ? undefined : t.p;
      else q.piece ??= t.p;
    }
  });
  if (q.promotion) q.piece ??= "p";
  const captureAt = toks.findIndex((t) => t.t === "capture");
  toks.forEach((t, i) => {
    if (used.has(i)) return;
    if (t.t === "file") {
      if (!q.to && captureAt >= 0 && i > captureAt) q.toFile = t.f;
      else if (i < destAt) q.fromFile = t.f;
    } else if (t.t === "rank" && i < destAt) q.fromRank = t.r;
    else if (t.t === "ordinal") q.ordinal = t.n;
  });
  // A lone number is a pick from a list ("two"), not a rank.
  if (!q.to && !q.toFile && !q.fromSq && !q.fromFile && !q.piece && q.fromRank && toks.length === 1) {
    q.ordinal = Number(q.fromRank);
    delete q.fromRank;
  }
  return q;
}

const isCastle = (m: Move, side: "k" | "q" | "any") => {
  const san = m.san.replace(/[+#]/g, "");
  return side === "any" ? san.startsWith("O-O") : san === (side === "k" ? "O-O" : "O-O-O");
};

function fits(m: Move, q: Query, o: { capture: boolean; hints: boolean; piece?: string }): boolean {
  const piece = o.piece ?? q.piece;
  return (
    (!q.castle || isCastle(m, q.castle)) &&
    (!q.to || m.to === q.to) &&
    (!q.toFile || m.to[0] === q.toFile) &&
    (!q.fromSq || m.from === q.fromSq) &&
    (!o.hints || ((!q.fromFile || m.from[0] === q.fromFile) && (!q.fromRank || m.from[1] === q.fromRank))) &&
    (!piece || m.piece === piece) &&
    (!o.capture || !!m.captured) &&
    (!q.promotion || m.promotion === q.promotion) &&
    (!q.promote || !!m.promotion)
  );
}

/** Legal moves fitting the query. A bare square is a pawn move first, like SAN; any piece if no pawn can go there. */
function find(legal: Move[], q: Query, o: { capture: boolean; hints: boolean }): { moves: Move[]; exact: boolean } {
  const pawnFirst = !q.piece && !q.castle && !q.fromSq && (!!q.to || !!q.toFile);
  if (pawnFirst) {
    const pawns = legal.filter((m) => fits(m, q, { ...o, piece: "p" }));
    if (pawns.length) return { moves: pawns, exact: true };
  }
  return { moves: legal.filter((m) => fits(m, q, o)), exact: !pawnFirst };
}

/** The destination with its file read as a letter that sounds like it ("b5" for "d5"). */
function soundAlikeQueries(q: Query): Query[] {
  if (!q.to) return [];
  return (SOUND_ALIKE[q.to[0]] ?? []).map((f) => ({ ...q, to: f + q.to![1] }));
}

const key = (m: Move) => m.from + m.to;

function result(found: Move[], sure: boolean, q: Query): Heard {
  let moves = found;
  // "Bishop e4 check" with two bishops: the check says which.
  if (q.check && moves.length > 1) {
    const checks = moves.filter((m) => /[+#]/.test(m.san));
    if (checks.length) moves = checks;
  }
  // A promotion with no piece said is one move with a question left: which piece.
  const byKey = new Map<string, Move[]>();
  for (const m of moves) byKey.set(key(m), [...(byKey.get(key(m)) ?? []), m]);
  const groups = [...byKey.values()];
  const out: VoiceMove[] = groups.map((ms) =>
    ms.length > 1 && ms[0].promotion
      ? { from: ms[0].from, to: ms[0].to, san: ms[0].san.replace(/=[QRBN]/, "=?") }
      : { from: ms[0].from, to: ms[0].to, promotion: ms[0].promotion, san: ms[0].san },
  );
  if (!out.length) return { kind: "nothing" };
  const needsPromotion = out.length === 1 && !out[0].promotion && !!groups[0][0].promotion;
  return { kind: "move", moves: out, sure: sure && out.length === 1, needsPromotion };
}

function isPhrase(text: string, phrases: string[]): boolean {
  const said = normalize(text).split(" ").filter((w) => !FILLER.has(w) || phrases.some((p) => normalize(p).split(" ").includes(w)));
  return phrases.some((p) => normalize(p) === said.join(" ")) || (said.length > 1 && said.every((w) => phrases.map(normalize).includes(w)));
}

/** What the student said, against the position `fen` (whoever is to move there moves). */
export function hearMove(fen: string, text: string, words: VoiceWords): Heard {
  if (isPhrase(text, words.confirm)) return { kind: "confirm" };
  if (isPhrase(text, words.cancel)) return { kind: "cancel" };
  const toks = tokenize(text);
  const q = query(toks);
  const named = q.to || q.toFile || q.castle || q.fromSq || q.promote || (q.capture && (q.piece || q.fromFile));
  if (!named) return { kind: "nothing" };
  const legal = new Chess(fen).moves({ verbose: true });

  const strict = find(legal, q, { capture: q.capture, hints: true });
  if (strict.moves.length) return result(strict.moves, strict.exact, q);
  // Dropping what didn't fit, one thing at a time: a "takes" that isn't a capture, then the hints
  // ("b knight" with no knight on b), then letters that sound like the ones heard.
  if (q.capture) {
    const r = find(legal, q, { capture: false, hints: true });
    if (r.moves.length) return result(r.moves, false, q);
  }
  const loose = find(legal, q, { capture: false, hints: false });
  if (loose.moves.length) return result(loose.moves, false, q);
  const alt = soundAlikeQueries(q).flatMap((a) => find(legal, a, { capture: false, hints: true }).moves);
  return result(alt, false, q);
}

/**
 * Which of several candidate moves the student meant, from what they said next: a square ("from
 * b1", "d2"), a file ("b", "the b knight"), a rank, the piece, a side for castling, or a number from
 * the list ("one", "second"). Null when it doesn't settle on one.
 */
export function pickMove(fen: string, moves: VoiceMove[], text: string): number | null {
  const toks = tokenize(text);
  // "King side" alone answers "castles": no castle word this time.
  const side = toks.some((t) => t.t === "short") ? "k" : toks.some((t) => t.t === "long") ? "q" : undefined;
  const q = query(side ? [{ t: "castle" }, ...toks] : toks);
  const legal = new Chess(fen).moves({ verbose: true });
  const ofMove = (vm: VoiceMove) => legal.find((m) => m.from === vm.from && m.to === vm.to);
  const squares = toks.flatMap((t, i) => (t.t === "file" && toks[i + 1]?.t === "rank" ? [t.f + (toks[i + 1] as { r: string }).r] : []));
  const files = toks.flatMap((t, i) => (t.t === "file" && toks[i + 1]?.t !== "rank" ? [t.f] : []));
  const ranks = toks.flatMap((t, i) => (t.t === "rank" && toks[i - 1]?.t !== "file" ? [t.r] : []));
  const pieces = toks.flatMap((t) => (t.t === "piece" ? [t.p] : []));
  const hits = moves
    .map((vm, i) => ({ vm, i, m: ofMove(vm) }))
    .filter(({ vm, m }) => {
      if (q.castle && m && !isCastle(m, q.castle)) return false;
      if (squares.some((s) => s !== vm.from && s !== vm.to)) return false;
      if (files.some((f) => f !== vm.from[0])) return false;
      if (ranks.length && !ranks.includes(vm.from[1]) && !q.ordinal) return false;
      if (pieces.length && m && !pieces.includes(m.piece)) return false;
      return true;
    });
  const said = squares.length || files.length || pieces.length || q.castle;
  if (said && hits.length === 1) return hits[0].i;
  // "One", "two": the numbered arrows on the board.
  const n = q.ordinal ?? (ranks.length === 1 && !said ? Number(ranks[0]) : undefined);
  if (n === -1) return moves.length - 1;
  if (n && n >= 1 && n <= moves.length) return n - 1;
  if (ranks.length && hits.length === 1) return hits[0].i;
  return null;
}

/** A promotion piece the student named ("queen", "knight"), for the promotion picker. */
export function promotionPiece(text: string): string | null {
  for (const t of tokenize(text)) if (t.t === "piece" && "qrbn".includes(t.p)) return t.p;
  return null;
}

/** How a move reads back to the student: "Knight to f3", "Pawn takes d5", "Castles king side". */
export function sayMove(fen: string, vm: VoiceMove): string {
  const m = new Chess(fen).moves({ verbose: true }).find((x) => x.from === vm.from && x.to === vm.to);
  if (!m) return vm.san;
  if (m.san.startsWith("O-O-O")) return "Castles queen side";
  if (m.san.startsWith("O-O")) return "Castles king side";
  const name = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" }[m.piece];
  const promo = vm.promotion ? `, promotes to ${{ q: "queen", r: "rook", b: "bishop", n: "knight" }[vm.promotion]}` : "";
  return `${name} ${m.captured ? "takes" : "to"} ${m.to}${promo}`;
}
