// Why a move was bad, as lines to step through on a board: what the opponent does after it, played
// out to where the material settles, and the moves that would have been fine instead (one, played
// out, when it stands out; otherwise several, each with just its reply). A caption per move and a
// one-line verdict. Computed on demand (a few short searches), so stored analyses need nothing new.
import { Chess, type Move, type Square } from "chess.js";
import type { Key } from "chessground/types";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import { whiteWinPercent } from "../engine/live";
import { pieceCounts, PIECE_NAMES, PIECE_VALUES, type PieceType } from "../chess/material";
import type { Color } from "../store";
import { positionalCost, type Mark } from "./positional";

const DEPTH = 14;
/** How far a line is followed at most: far enough for an exchange to finish. */
const MAX_PLIES = 12;
/** The line after the move played shows at least this many moves, to show the idea. */
const QUIET_PLIES = 5;
/** A sound alternative shows the move and the reply (more only while captures go on). */
const ALT_PLIES = 2;
/** Plies taken from one search before searching again: a PV's tail is too shallow to trust. */
const CHUNK = 4;
/** Root candidates searched for "better" moves. */
const CANDIDATES = 5;
/** Moves within this many winning-chance points of the best count as just as good. */
const SOUND = 5;
/**
 * How far a line is followed when its first moves show nothing concrete (no material, no mate):
 * far enough for a pawn race to finish, so "the position gets better" can become "the h-pawn queens".
 */
const DEEP_PLIES = 24;
/** A pawn lost further on than this (plies) is too far to give as the reason a move was bad. */
const FAR_PAWN_PLIES = 10;
/** The best move "stands out" when the next best keeps this many points less. */
const STANDOUT = 10;

export interface Step {
  san: string;
  /** "5.Nxf7" / "5...Qxg2", for the move list. */
  label: string;
  from: Key;
  to: Key;
  /** The position after the move. */
  fen: string;
  /** What the move does, in words. */
  note: string;
  /** The pieces the moved piece now attacks and could win (the king too, when it gives check): a fork has two or more. */
  targets?: Key[];
}

export interface ExplainedLine {
  /** Where the line starts (before the move being judged). */
  startFen: string;
  steps: Step[];
  /** What the line comes to, in a sentence. */
  verdict: string;
  /** Eval at the end of the line, mover's view, as text (+1.2, #3). */
  evalText: string;
  /** The mover's winning chances along the line (%). */
  win: number;
  /** Drawn on the line's last position: what the verdict points at (a shut-in bishop, doubled pawns). */
  marks?: Mark[];
}

export interface Explanation {
  mover: Color;
  /** The move played, then the opponent's best answers. */
  played: ExplainedLine;
  /** The best move instead, then its continuation. Null when nothing beats the move played. */
  better: ExplainedLine | null;
  /**
   * Every move that would have been fine, best first (`better` is the first). When the best one
   * stands out (mate, wins material, or clearly ahead of the rest) it's the only one, followed
   * until the material settles; otherwise each shows just the move and the reply, since a solid
   * move needs no long line to justify it.
   */
  alternatives: ExplainedLine[];
  /** The best move is *the* move here, not one of several. */
  standout: boolean;
  /** A sentence about the alternatives together. */
  betterSummary: string;
  evalBefore: string;
  evalAfter: string;
  winBefore: number;
  winAfter: number;
  /**
   * The better move's point is what it attacks (a fork, or a threat that wins material): those
   * pieces, so a drill can ask the student to find them. Null when the point is something else.
   */
  attack: { san: string; from: Key; to: Key; fen: string; targets: Key[] } | null;
  /**
   * What was found concretely, most telling first: why the move played is bad, then what the better
   * move does. Empty when all there is to say is "the position gets better": no lesson to drill.
   */
  themes: Theme[];
  /**
   * Which line teaches the lesson. "better" when the move played isn't bad by anything it allows
   * (no material lost, no mate, no threat) and one move stood out: the mistake is the chance it
   * missed, so the screen opens on that move and what it does. Missing in older stored lessons.
   */
  focus?: "played" | "better";
}

/** A concrete reason a move is bad or another is better (see Explanation.themes). */
export type Theme =
  | "mate"
  | "material"
  | "trapped"
  | "fork"
  | "pin"
  | "recapture"
  | "loose-square"
  | "tempo"
  | "threat"
  | "missed-win"
  | "pawns"
  | "later";

/** How a theme is named to the student. */
export const THEME_NAMES: Record<Theme, string> = {
  mate: "Mate",
  material: "Material",
  trapped: "Trapped piece",
  fork: "Fork",
  pin: "Pin",
  recapture: "Can't take back",
  "loose-square": "Unguarded square",
  tempo: "Gaining a move",
  threat: "Threat",
  "missed-win": "Missed win",
  pawns: "Pawn structure",
  later: "Long-term",
};

export interface MoveToExplain {
  fenBefore: string;
  /** The move played, UCI. */
  uci: string;
  bestUci: string | null;
  /** White's view, centipawns (mates as ±(10000 − distance)), as the review stored them. */
  evalBefore: number;
  evalAfter: number;
  /** Search depth: deeper for a drill's lesson, worked out once (steadier, and it can wait). */
  depth?: number;
}

const other = (c: Color): Color => (c === "white" ? "black" : "white");
const sideName = (c: Color) => (c === "white" ? "White" : "Black");
const colorOf = (fen: string): Color => (fen.split(" ")[1] === "w" ? "white" : "black");
const value = (ps: PieceType[]) => ps.reduce((s, p) => s + PIECE_VALUES[p], 0);

/** "a knight", "two pawns", "a rook and a pawn". */
function listPieces(ps: PieceType[]): string {
  const by = new Map<PieceType, number>();
  for (const p of [...ps].sort((a, b) => PIECE_VALUES[b] - PIECE_VALUES[a])) by.set(p, (by.get(p) ?? 0) + 1);
  const words = ["", "", "two", "three", "four", "five", "six", "seven", "eight"];
  const parts = [...by].map(([p, n]) => (n === 1 ? `a ${PIECE_NAMES[p]}` : `${words[n] ?? n} ${PIECE_NAMES[p]}s`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

/**
 * What one side comes out ahead by, in one phrase: "a bishop", "a bishop for a pawn". A bishop and
 * a knight count as the same, so "two bishops for a knight and a pawn" reads "a bishop for a pawn".
 */
function netGain(won: PieceType[], gave: PieceType[]): string {
  const [w, g] = minorsCancelled(won, gave);
  if (!w.length) return (won.length ? listPieces(won) : "nothing") + (gave.length ? ` for ${listPieces(gave)}` : "");
  return listPieces(w) + (g.length ? ` for ${listPieces(g)}` : "");
}

/** Two lists of pieces with bishops and knights paired off against each other (they're worth the same). */
function minorsCancelled(a: PieceType[], b: PieceType[]): [PieceType[], PieceType[]] {
  const [x, y] = [[...a], [...b]];
  for (;;) {
    const i = x.findIndex((p) => p === "b" || p === "n");
    const j = y.findIndex((p) => p === "b" || p === "n");
    if (i < 0 || j < 0) return [x, y];
    x.splice(i, 1);
    y.splice(j, 1);
  }
}

/** Pieces each side lost between two positions, with the ones both lost (trades) taken out. */
function netLosses(a: string, b: string): Record<Color, PieceType[]> {
  const [ca, cb] = [pieceCounts(a), pieceCounts(b)];
  const out = { white: [] as PieceType[], black: [] as PieceType[] };
  for (const t of ["q", "r", "b", "n", "p"] as const) {
    const w = ca.white[t] - cb.white[t];
    const k = ca.black[t] - cb.black[t];
    const traded = Math.min(Math.max(w, 0), Math.max(k, 0));
    for (let i = 0; i < w - traded; i++) out.white.push(t);
    for (let i = 0; i < k - traded; i++) out.black.push(t);
  }
  return out;
}

/**
 * The pieces (not pawns) the piece on `sq` now attacks and could win, most valuable first: an
 * undefended one, one worth more, or one whose only guards are themselves under that kind of attack
 * (a fork: the queen on d3 guards the bishop on c4, but the queen has to move).
 */
function threatsFrom(chess: Chess, sq: Square): { type: PieceType; sq: Square }[] {
  const me = chess.get(sq);
  if (!me) return [];
  const them = me.color === "w" ? "b" : "w";
  const own = me.type === "k" ? 100 : PIECE_VALUES[me.type as PieceType];
  const hits: { type: PieceType; sq: Square; v: number; guards: Square[]; strong: boolean }[] = [];
  for (const p of chess.board().flat()) {
    if (!p || p.color !== them || p.type === "k" || p.type === "p") continue;
    if (!chess.attackers(p.square, me.color).includes(sq)) continue;
    const v = PIECE_VALUES[p.type as PieceType];
    const guards = chess.attackers(p.square, them);
    hits.push({ type: p.type as PieceType, sq: p.square, v, guards, strong: !guards.length || v > own });
  }
  const strong = hits.filter((h) => h.strong);
  return hits
    .filter((h) => h.strong || (strong.length > 0 && h.guards.every((g) => strong.some((s) => s.sq === g))))
    .sort((a, b) => b.v - a.v)
    .map(({ type, sq }) => ({ type, sq }));
}

/** What the piece that just moved attacks: its targets, and whether it gives check itself. */
function attacksOf(chess: Chess, m: Move): { threats: { type: PieceType; sq: Square }[]; check: Square | null } {
  const king = chess.inCheck() ? chess.board().flat().find((p) => p?.type === "k" && p.color === chess.turn())?.square : undefined;
  const check = king && chess.attackers(king, m.color).includes(m.to as Square) ? king : null;
  return { threats: threatsFrom(chess, m.to as Square), check };
}

/** A caption for a move: what it takes, threatens, or that it mates. */
function caption(chess: Chess, m: Move, prev: Move | undefined, mover: Color): string {
  const you = m.color === (mover === "white" ? "w" : "b");
  const who = you ? "You" : sideName(m.color === "w" ? "white" : "black");
  const verb = (s: string) => (you ? s : `${s}s`);
  if (chess.isCheckmate()) return `${who} ${verb("deliver")} checkmate.`;
  let text: string;
  if (m.isKingsideCastle() || m.isQueensideCastle()) text = `${who} ${verb("castle")}`;
  else if (m.captured && prev?.captured && prev.to === m.to) text = `${who} ${verb("take")} back on ${m.to}`;
  else if (m.captured) text = `${who} ${verb("take")} the ${PIECE_NAMES[m.captured as PieceType]} on ${m.to}`;
  else if (m.promotion) text = `${who} ${verb("promote")} to a ${PIECE_NAMES[m.promotion as PieceType]}`;
  else text = `${who} ${verb("play")} ${m.san}`;
  if (m.promotion && m.captured) text += ` and ${verb("promote")} to a ${PIECE_NAMES[m.promotion as PieceType]}`;
  const { threats } = attacksOf(chess, m);
  const named = andList(threats.map((t) => `the ${PIECE_NAMES[t.type]} on ${t.sq}`));
  if (chess.inCheck()) text += threats.length ? `, with check, also attacking ${named}` : ", with check";
  // "Attacking", not "forking": whether it wins one of them is for the verdict, which follows the line
  // (Nxe5 hits the queen and the bishop, but Qe2 saves both).
  else if (threats.length) text += `, attacking ${threats.length === 2 ? "both " : ""}${named}`;
  return `${text}.`;
}

interface Followed {
  steps: Step[];
  mate: boolean;
  /** Net material each side lost over the line. */
  lost: Record<Color, PieceType[]>;
  /** The line's eval (White's view, stored format), from the latest search along it. */
  eval: number | null;
  mateFor: number | undefined;
  /** The first promotion along the line, if any. */
  promo: Step & { color: Color } | null;
  /** The engine's next move where the line stopped (UCI), if it had one. */
  next?: string;
}

/**
 * `first`, then the engine's best play, followed until the material settles: at least `quiet`
 * plies, and on past that while the next move is a capture (so an exchange or a hanging piece is
 * always finished). The engine searches again every CHUNK plies: the tail of one long PV is
 * shallow and can contain moves the engine wouldn't really play (a piece left hanging), which made
 * lines end on a blunder that had nothing to do with the move being judged. `pv` (the engine's
 * line after `first`, if already known) saves the first search.
 */
async function followLine(fen: string, first: string, mover: Color, quiet: number, pv?: string[], pvEval?: EngineLine, deep = false, depth = DEPTH): Promise<Followed> {
  const chess = new Chess(fen);
  const steps: Step[] = [];
  let prev: Move | undefined;
  let promo: Followed["promo"] = null;
  const startValue = (c: Color) => value(netLosses(fen, chess.fen())[c]);
  let queue: string[] = [];
  let latest: EngineLine | undefined = pvEval;
  let stopNext: string | undefined;
  const play = (uci: string) => {
    const [, turn, , , , full] = chess.fen().split(" ");
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const hit = attacksOf(chess, m);
    const targets = [...(hit.check ? [hit.check] : []), ...hit.threats.map((t) => t.sq)] as Key[];
    steps.push({
      ...(targets.length ? { targets } : {}),
      san: m.san,
      label: `${full}${turn === "w" ? "." : "..."}${m.san}`,
      from: m.from as Key,
      to: m.to as Key,
      fen: chess.fen(),
      note: caption(chess, m, prev, mover),
    });
    prev = m;
    if (m.promotion && !promo) promo = { ...steps[steps.length - 1], color: m.color === "w" ? "white" : "black" };
  };
  play(first);
  if (pv) queue = pv.slice(0, CHUNK);
  // Deep: on until something concrete happens: a promotion, or a piece changes hands (a pawn alone
  // often goes back and forth on the way to the real point, as in a race).
  const happened = () => promo !== null || Math.abs(startValue("white") - startValue("black")) >= 3;
  while (!chess.isGameOver() && steps.length < (deep ? DEEP_PLIES : MAX_PLIES)) {
    if (!queue.length) {
      const [l] = await getReviewEngine().analyze(chess.fen(), 1, depth);
      if (!l?.pv.length) break;
      latest = l;
      queue = l.pv.slice(0, CHUNK);
    }
    const next = queue[0];
    // Stop once the idea is shown and nothing is left hanging mid-exchange.
    if (steps.length >= quiet && !chess.get(next.slice(2, 4) as Square) && (!deep || happened())) {
      stopNext = next;
      break;
    }
    try {
      play(next);
    } catch {
      break;
    }
    queue.shift();
  }
  const mate = chess.isCheckmate();
  // Mated: the side to move lost. Otherwise the latest search's eval is the line's.
  const mateEval = chess.turn() === "w" ? -10000 : 10000;
  return {
    steps,
    mate,
    lost: netLosses(fen, chess.fen()),
    eval: mate ? mateEval : latest ? stored(latest) : null,
    mateFor: mate ? undefined : latest?.mate,
    promo,
    ...(stopNext ? { next: stopNext } : {}),
  };
}

const pawns = (cp: number) => (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
/** Mover's view, from a White's-view eval (mates as ±(10000 − distance)). */
const evalFor = (cp: number, side: Color) => {
  const v = side === "white" ? cp : -cp;
  return Math.abs(v) >= 9000 ? `${v > 0 ? "" : "-"}#${10000 - Math.abs(v)}` : pawns(v);
};
const winFor = (cp: number, side: Color) => {
  const w = Math.abs(cp) >= 9000 ? (cp > 0 ? 100 : 0) : whiteWinPercent({ cp });
  return Math.round(side === "white" ? w : 100 - w);
};
/** An engine line's eval as stored evals are (White's view, mates as ±(10000 − distance)). */
const stored = (l: { cp?: number; mate?: number }) =>
  l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0);

/** Whether a stored eval is a forced mate for `side`. */
const matesFor = (cp: number | null, side: Color) => cp !== null && Math.abs(cp) >= 9000 && cp > 0 === (side === "white");

/** `a` with one of each piece in `b` taken out. */
function without(a: PieceType[], b: PieceType[]): PieceType[] {
  const rest = [...b];
  return a.filter((p) => {
    const i = rest.indexOf(p);
    if (i < 0) return true;
    rest.splice(i, 1);
    return false;
  });
}

const NAME: Record<string, string> = { ...PIECE_NAMES, k: "king" };
const pieceAt = (chess: Chess, sq: Square) => NAME[chess.get(sq)?.type ?? ""] ?? "piece";

/**
 * What the move played gives up that the better move doesn't, in concrete terms: the square the
 * opponent's reply goes for, and the piece of ours that guarded it before the move or would guard it
 * after the better one. "The position gets better" teaches nothing; "after Nxg1 nothing guards f2,
 * after Kxg1 the king does" does. Null when the reply isn't about a square losing its guard.
 */
function lostGuard(fen: string, played: Step, reply: Step | undefined, betterUci: string, mover: Color): { played: string; better: string } | null {
  if (!reply) return null;
  const c = mover === "white" ? "w" : "b";
  const x = reply.to as Square;
  const afterPlayed = new Chess(played.fen);
  const afterBetter = new Chess(fen);
  let betterSan: string;
  try {
    betterSan = afterBetter.move({ from: betterUci.slice(0, 2), to: betterUci.slice(2, 4), promotion: betterUci[4] }).san;
  } catch {
    return null;
  }
  // Only a reply that wins something or checks is about a weak square; a quiet move isn't.
  let r: Move;
  try {
    r = new Chess(played.fen).move(reply.san);
  } catch {
    return null;
  }
  if (!r.captured && !r.san.includes("+")) return null;
  const guardsNow = afterPlayed.attackers(x, c);
  const guardsBetter = afterBetter.attackers(x, c);
  if (guardsBetter.length <= guardsNow.length) return null;
  const before = new Chess(fen);
  const movedGuard = before.attackers(x, c).includes(played.from as Square) && !guardsNow.includes(played.to as Square);
  const guard = guardsBetter.find((s) => !guardsNow.includes(s)) ?? guardsBetter[0];
  const guardName = guard === betterUci.slice(2, 4) ? `your ${pieceAt(afterBetter, guard)}` : `your ${pieceAt(afterBetter, guard)} on ${guard}`;
  const loose = guardsNow.length ? `${x} one guard short` : `${x} unguarded`;
  return {
    played: movedGuard
      ? `${played.san} moves the ${pieceAt(before, played.from as Square)} that guarded ${x}, which leaves ${loose}; after ${betterSan} ${guardName} would guard it.`
      : `${played.san} leaves ${loose}; after ${betterSan} ${guardName} would guard it.`,
    better: `${betterSan} keeps ${x} guarded (${guardName.replace(/^your /, "by your ")}), so ${reply.san} isn't there.`,
  };
}

/**
 * The reply comes with check after the move played but wouldn't after the better move: the check
 * wins the opponent a move (in an endgame, often the whole race). Null otherwise.
 */
function lostTempo(fen: string, played: Step, reply: Step | undefined, betterUci: string, mover: Color): { played: string; better: string } | null {
  if (!reply?.san.includes("+")) return null;
  const b = new Chess(fen);
  let betterSan: string;
  try {
    betterSan = b.move({ from: betterUci.slice(0, 2), to: betterUci.slice(2, 4), promotion: betterUci[4] }).san;
  } catch {
    return null;
  }
  const same = b.moves({ verbose: true }).find((x) => x.from === reply.from && x.to === reply.to);
  const opp = sideName(other(mover));
  const bare = reply.san.replace(/[+#]$/, "");
  if (!same) return { played: `${played.san} allows ${reply.san}, which wins ${opp} a move.`, better: `After ${betterSan}, ${bare} isn't possible.` };
  if (same.san.includes("+")) return null;
  b.move(same);
  const take = b.moves({ verbose: true }).find((x) => x.to === reply.to && x.captured && x.piece !== "k") ?? b.moves({ verbose: true }).find((x) => x.to === reply.to && x.captured);
  const answer = take ? ` (${take.san} takes it)` : "";
  return {
    played: `${played.san} lets ${bare} come with check, which wins ${opp} a move; after ${betterSan} it wouldn't be check${answer}.`,
    better: `After ${betterSan}, ${bare} is no longer check${answer}.`,
  };
}

/**
 * The opponent's next move when it's a pawn driving one of the mover's pieces back (12.f3 at the
 * knight on g4): the piece that just traded itself onto an exposed square has to move again. As a
 * step to add to the line, and the words for the verdict.
 */
function chase(fen: string, uci: string, mover: Color): { step: Step; text: string } | null {
  const chess = new Chess(fen);
  const [, turn, , , , full] = fen.split(" ");
  let m: Move;
  try {
    m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
  const mine = mover === "white" ? "w" : "b";
  if (m.piece !== "p" || m.captured || m.color === mine || chess.inCheck()) return null;
  const hit = chess
    .board()
    .flat()
    .filter((p) => p && p.color === mine && p.type !== "p" && p.type !== "k" && chess.attackers(p.square, m.color).includes(m.to as Square));
  if (!hit.length) return null;
  const label = `${full}${turn === "w" ? "." : "..."}${m.san}`;
  const step: Step = {
    san: m.san,
    label,
    from: m.from as Key,
    to: m.to as Key,
    fen: chess.fen(),
    note: caption(chess, m, undefined, mover),
    targets: hit.map((p) => p!.square as Key),
  };
  const what = andList(hit.map((p) => `${PIECE_NAMES[p!.type as PieceType]} on ${p!.square}`));
  return { step, text: `${label} drives your ${what} back` };
}

/** "Black's h-pawn queens (52...h1=Q)". */
function promoText(pr: NonNullable<Followed["promo"]>, mover: Color): string {
  const who = pr.color === mover ? "your" : `${sideName(pr.color)}'s`;
  return `${who} ${pr.from[0]}-pawn queens (${pr.label})`;
}

/** "a, b and c". */
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

const FILES = "abcdefgh";

/** Pawns per file (a..h) for one side. */
function pawnFiles(chess: Chess, side: "w" | "b"): number[] {
  const n: number[] = Array(8).fill(0);
  for (const row of chess.board()) for (const p of row) if (p?.type === "p" && p.color === side) n[FILES.indexOf(p.square[0])]++;
  return n;
}

/**
 * What the move played does to the student's pawns that the better move doesn't: a file opened for
 * the opponent (only when the line shows a rook or queen of theirs taking it), pawns doubled or left
 * isolated. Often the whole difference between two ways of taking the same piece (dxe5 or Bxe5),
 * where "the position gets better" says nothing. Null when the move played isn't a pawn move or
 * leaves the pawns no worse.
 */
function pawnCost(fen: string, played: Step, line: Step[], betterUci: string, mover: Color): { played: string; better: string } | null {
  if (!/^[a-h]/.test(played.san) || betterUci.slice(0, 2) === played.from) return null;
  const alt = new Chess(fen);
  try {
    alt.move({ from: betterUci.slice(0, 2), to: betterUci.slice(2, 4), promotion: betterUci[4] });
  } catch {
    return null;
  }
  const [us, them] = mover === "white" ? (["w", "b"] as const) : (["b", "w"] as const);
  const after = new Chess(played.fen);
  const [mine, mineAlt, theirs] = [pawnFiles(after, us), pawnFiles(alt, us), pawnFiles(after, them)];
  const isolated = (n: number[], k: number) => n[k] > 0 && !(n[k - 1] > 0) && !(n[k + 1] > 0);
  const opp = sideName(other(mover));
  const worse: string[] = [];
  const kept: string[] = [];
  for (let k = 0; k < 8; k++) {
    const f = FILES[k];
    // Open for them: no pawn of theirs in the way, and ours only there after the better move.
    if (mine[k] === 0 && mineAlt[k] > 0 && theirs[k] === 0) {
      const by = line.find((s, i) => i % 2 === 1 && /^[RQ]/.test(s.san) && s.to[0] === f);
      if (by) {
        worse.push(`opens the ${f}-file for ${opp}'s ${by.san[0] === "Q" ? "queen" : "rooks"} (${by.label})`);
        kept.push(`the ${f}-file stays closed`);
      }
    }
    const doubled = mine[k] >= 2 && mineAlt[k] < 2;
    const lonely = isolated(mine, k) && !isolated(mineAlt, k);
    if (doubled || lonely) {
      const what = doubled && lonely ? "doubled and isolated" : doubled ? "doubled" : "isolated";
      worse.push(`leaves your ${f}-pawn${mine[k] > 1 ? "s" : ""} ${what}`);
      kept.push(`your ${f}-pawn${mine[k] > 1 ? "s aren't" : " isn't"} ${what}`);
    }
  }
  if (!worse.length) return null;
  return { played: `${andList(worse)}.`, better: `keeps your pawn on ${played.from}, so ${andList(kept)}.` };
}

/** Whether `mid` lies strictly between `a` and `b` on one rank, file or diagonal. */
function between(a: Square, mid: Square, b: Square): boolean {
  const xy = (s: Square) => [s.charCodeAt(0) - 97, Number(s[1]) - 1];
  const [[ax, ay], [mx, my], [bx, by]] = [xy(a), xy(mid), xy(b)];
  const [dx, dy] = [Math.sign(bx - ax), Math.sign(by - ay)];
  if (!(ax === bx || ay === by || Math.abs(bx - ax) === Math.abs(by - ay))) return false;
  for (let x = ax + dx, y = ay + dy; x !== bx || y !== by; x += dx, y += dy) if (x === mx && y === my) return true;
  return false;
}

/** Whether a piece of `us` on `sq` would be lost there: attacked and unguarded, or attacked by something cheaper. */
function lostOn(chess: Chess, sq: Square, us: "w" | "b"): boolean {
  const p = chess.get(sq);
  if (!p) return false;
  const them = us === "w" ? "b" : "w";
  const attackers = chess.attackers(sq, them);
  if (!attackers.length) return false;
  const v = p.type === "k" ? 100 : PIECE_VALUES[p.type as PieceType];
  const cheaper = attackers.some((a) => {
    const t = chess.get(a)?.type;
    return t !== undefined && t !== "k" && PIECE_VALUES[t as PieceType] < v;
  });
  return cheaper || !chess.attackers(sq, us).length;
}

/**
 * The reply attacks a piece of ours that has no safe square: it's trapped. Often the move played is
 * why, by taking the square the piece would have escaped to (Re8 takes e8 from the knight on f6).
 */
async function trappedPiece(
  played: Step,
  reply: Step | undefined,
  mover: Color,
  lineEval: number,
  depth = DEPTH,
): Promise<{ sq: Square; type: PieceType; text: string } | null> {
  if (!reply) return null;
  const us = mover === "white" ? "w" : "b";
  const sign = mover === "white" ? 1 : -1;
  let pos: Chess;
  try {
    pos = new Chess(reply.fen);
  } catch {
    return null;
  }
  if (pos.inCheck()) return null;
  /** The answer that refutes moving the piece there, or null if that square is safe. */
  const refute = async (board: Chess, mv: Move): Promise<string | null> => {
    board.move(mv);
    try {
      if (lostOn(board, mv.to as Square, us)) {
        // Plainly lost there: the cheapest piece that takes it.
        const take = board
          .moves({ verbose: true })
          .filter((r) => r.to === mv.to && r.captured)
          .sort((a, b) => PIECE_VALUES[a.piece as PieceType] - PIECE_VALUES[b.piece as PieceType])[0];
        return take?.san ?? "";
      }
      if (board.isGameOver()) return null;
      // Looks safe: the engine says whether it is (no better than the line, which loses the piece).
      const [l] = await getReviewEngine().analyze(board.fen(), 1, depth - 2);
      if (!l?.pv[0] || sign * (stored(l) - lineEval) > TRAP_MARGIN) return null;
      const r = new Chess(board.fen()).move({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] });
      return r.san;
    } catch {
      return null;
    } finally {
      board.undo();
    }
  };
  for (const t of threatsFrom(pos, reply.to as Square)) {
    const moves = pos.moves({ square: t.sq, verbose: true });
    const answers: string[] = [];
    let safe = false;
    for (const mv of moves) {
      const r = await refute(pos, mv);
      if (r === null) {
        safe = true;
        break;
      }
      answers.push(r ? `${mv.san} runs into ${r}` : `${mv.san} loses it`);
    }
    if (safe) continue;
    const name = PIECE_NAMES[t.type];
    // The same position with the move played taken back: a square that would be a safe way out was taken by it.
    let took = "";
    const back = new Chess(reply.fen);
    const mine = back.get(played.to as Square);
    if (mine && played.to !== t.sq && played.from !== t.sq) {
      back.remove(played.to as Square);
      back.put(mine, played.from as Square);
      const out = back.moves({ square: t.sq, verbose: true }).find((mv) => mv.to === played.to);
      if (out && (await refute(back, out)) === null) took = ` ${played.to} would have been its way out, but ${played.san} took that square.`;
    }
    const where = moves.length ? `: ${answers.slice(0, 4).join(", ")}` : "";
    return { sq: t.sq, type: t.type, text: `The ${name} on ${t.sq} has no safe square${where}.${took}` };
  }
  return null;
}

/** An escape square counts as safe when the engine rates it this much (centipawns) above the line that loses the piece. */
const TRAP_MARGIN = 100;

/** How much more (centipawns) the threat has to be worth than the line for it to be the move's point. */
const THREAT_GAP = 100;

/**
 * What a quiet move threatens: the move its side would play next if the other side passed. That's
 * how a move that wins nothing yet is explained ("Qc7 threatens Rxh6"), so the opponent's answer
 * (Rh8) makes sense too. Only a concrete threat (mate, a check, a capture) that's clearly worth
 * something more than the line; null otherwise.
 */
async function threatOf(step: Step, side: Color, lineEval: number, depth = DEPTH): Promise<string | null> {
  const now = new Chess(step.fen);
  if (now.inCheck() || now.isGameOver()) return null;
  const f = step.fen.split(" ");
  f[1] = f[1] === "w" ? "b" : "w";
  f[3] = "-";
  let pass: Chess;
  try {
    pass = new Chess(f.join(" "));
  } catch {
    return null;
  }
  const [l] = await getReviewEngine().analyze(pass.fen(), 1, depth);
  if (!l?.pv[0]) return null;
  const mates = matesFor(stored(l), side);
  if (!mates && (side === "white" ? 1 : -1) * (stored(l) - lineEval) < THREAT_GAP) return null;
  let mv: Move;
  try {
    mv = pass.move({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] });
  } catch {
    return null;
  }
  if (pass.isCheckmate()) return `threatens ${mv.san}, mate`;
  if (mates) return `threatens mate, starting with ${mv.san}`;
  if (mv.captured) return `threatens ${mv.san}, winning the ${NAME[mv.captured]} on ${mv.to}`;
  return null;
}

/** How much a gap in evaluation has to be (centipawns) before "taking back fails" is a reason. */
const RECAPTURE_GAP = 150;

/**
 * The better move takes something and the opponent doesn't simply take back: why not. A student
 * expects the recapture ("the bishop just takes back") and misses the reason it fails, most often a
 * pin: to the king (it can't), or to a bigger piece behind it (it loses that piece). Null when the
 * recapture is fine (the line plays it) or there's nothing to take back with.
 */
async function failedRecapture(first: Step, reply: Step | undefined, lineEval: number, mover: Color, depth = DEPTH): Promise<string | null> {
  const after = new Chess(first.fen);
  const x = first.to as Square;
  const them = after.turn();
  const opp = sideName(other(mover));
  const legal = after.moves({ verbose: true }).filter((mv) => mv.to === x && mv.captured);
  // A piece that attacks the square but has no legal capture there is pinned to its king.
  const stuck = after
    .attackers(x, them)
    .filter((sq) => after.get(sq)?.type !== "k" && !legal.some((mv) => mv.from === sq));
  const cheapest = legal.filter((mv) => mv.piece !== "k").sort((a, b) => PIECE_VALUES[a.piece as PieceType] - PIECE_VALUES[b.piece as PieceType])[0];
  if (!cheapest) {
    if (!stuck.length) return null;
    return `${opp} can't take back: the ${pieceAt(after, stuck[0])} on ${stuck[0]} is pinned to the king.`;
  }
  if (reply && reply.from === cheapest.from && reply.to === cheapest.to) return null;
  const probe = new Chess(first.fen);
  probe.move(cheapest);
  if (probe.isGameOver()) return null;
  const [l] = await getReviewEngine().analyze(probe.fen(), 1, depth);
  if (!l?.pv[0]) return null;
  // Taking back has to be clearly worse for them than what the line plays.
  const sign = mover === "white" ? 1 : -1;
  if (sign * (stored(l) - lineEval) < RECAPTURE_GAP) return null;
  let ans: Move;
  try {
    ans = probe.move({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] });
  } catch {
    return null;
  }
  const take = cheapest.san;
  if (probe.isCheckmate()) return `${opp} can't take back: ${take} runs into ${ans.san}, mate.`;
  if (!ans.captured) return null; // the reason is something quieter than a capture: not one we can name
  const won = `the ${NAME[ans.captured]} on ${ans.to}`;
  // A slider takes what the recapturing piece was shielding: it was pinned.
  if ("qrb".includes(ans.piece) && between(ans.from as Square, cheapest.from as Square, ans.to as Square))
    return `${opp} can't simply take back: the ${NAME[cheapest.piece]} on ${cheapest.from} is pinned to ${won}, so ${take} loses it to ${ans.san}.`;
  return `${opp} can't simply take back: after ${take}, ${ans.san} wins ${won}.`;
}

export async function explainMove(m: MoveToExplain): Promise<Explanation> {
  const mover = colorOf(m.fenBefore);
  const opp = other(mover);
  const [winBefore, winAfter] = [winFor(m.evalBefore, mover), winFor(m.evalAfter, mover)];

  const depth = m.depth ?? DEPTH;
  const p = await followLine(m.fenBefore, m.uci, mover, QUIET_PLIES, undefined, undefined, false, depth);
  const [lost, got] = [p.lost[mover], p.lost[opp]];
  const playedNet = value(got) - value(lost);
  const playedSan = p.steps[0]?.san ?? "";
  const played: ExplainedLine = {
    startFen: m.fenBefore,
    steps: p.steps,
    verdict: "",
    evalText: evalFor(p.eval ?? m.evalAfter, mover),
    win: winAfter,
  };

  // The moves that would have been fine. Usually there are several, and showing only the engine's
  // favourite with a long PV teaches little: the deep line is often moves only an engine would
  // find. So a lone best move gets its full line only when it really stands out.
  const root = await getReviewEngine().analyze(m.fenBefore, CANDIDATES, depth);
  const winOf = (l: EngineLine) => winFor(stored(l), mover);
  const candidates = root.filter((l) => l.pv[0] && l.pv[0] !== m.uci);
  // The caller's better move (the review's best, or the student's right answer in a drill) when the
  // search has it among the candidates, so the explanation is about that move.
  const top = candidates.find((l) => l.pv[0] === m.bestUci) ?? candidates[0];
  const alternatives: ExplainedLine[] = [];
  let standout = false;
  let betterSummary = "";
  const beats = !!top && winOf(top) > winAfter;
  // Only when the reply really wins something or checks (Rxh6 leaves e1 to Qe1+): after an even
  // trade (Qa4 Nxc5 dxc5) "c5 is one guard short" isn't a reason, just where the pieces were traded.
  const replyChecks = !!p.steps[1] && /[+#]/.test(p.steps[1].san);
  const guard = beats && (playedNet <= -1 || replyChecks) ? lostGuard(m.fenBefore, p.steps[0], p.steps[1], top.pv[0], mover) : null;
  const tempo = beats && !guard ? lostTempo(m.fenBefore, p.steps[0], p.steps[1], top.pv[0], mover) : null;
  const pawns = beats && !guard && !tempo && p.steps[0] ? pawnCost(m.fenBefore, p.steps[0], p.steps, top.pv[0], mover) : null;

  // What the better move comes to, for "what the move played misses" (set with the alternatives).
  let topGain: { mate: boolean; net: number; won: PieceType[]; gave: PieceType[] } | null = null;
  const betterThemes: Theme[] = [];
  const playedThemes: Theme[] = [];
  let attack: Explanation["attack"] = null;

  if (beats) {
    const runnerUp = root.find((l) => l !== top && l.pv[0]);
    const topWin = winOf(top);
    standout = !runnerUp || matesFor(stored(top), mover) || topWin - winOf(runnerUp) >= STANDOUT;
    const picks = standout ? [top] : [top, ...candidates.filter((l) => l !== top && winOf(l) >= topWin - SOUND && winOf(l) >= winAfter + SOUND)].slice(0, 4);
    for (const l of picks) {
      const b = await followLine(m.fenBefore, l.pv[0], mover, standout ? QUIET_PLIES : ALT_PLIES, l.pv.slice(1), l, false, depth);
      const [gave, won] = [b.lost[mover], b.lost[opp]];
      const san = b.steps[0]?.san ?? "";
      const w = winOf(l);
      // Material the move played also gets isn't a reason to prefer this one: both Nxg1 and Kxg1
      // take the rook, so "Kxg1 wins a rook" says nothing about why it's the better of the two.
      const sameTake = b.steps[0] && p.steps[0] && b.steps[0].to === p.steps[0].to && /x/.test(b.steps[0].san) && /x/.test(playedSan);
      const net = value(won) - value(gave);
      const mates = matesFor(stored(l), mover);
      const wins = net >= 1 && net - playedNet >= 1 && !sameTake;
      const first = b.steps[0];
      const targets = first?.targets ?? [];
      const checks = !!first && new Chess(first.fen).inCheck();
      // The point of a winning move is often what it attacks: a fork (the king counts, with check),
      // or a quiet move with one threat. Not a capture with one threat, whose point is the capture.
      const isAttack = (mates || wins) && (targets.length >= 2 || (targets.length === 1 && !/x/.test(san) && !checks));
      if (l === top) {
        topGain = mates || wins ? { mate: mates, net, won, gave } : null;
        if (isAttack && first) attack = { san, from: first.from, to: first.to, fen: first.fen, targets };
      }
      // Whoever has to deal with a fork can't save everything: that's the reason in one line.
      const why =
        isAttack && targets.length >= 2
          ? checks
            ? `${sideName(opp)} has to answer the check, so `
            : `${sideName(opp)} can't save ${targets.length === 2 ? "both" : "them all"}: `
          : "";
      // Both take the same thing: the difference is what comes with it. Said about this move alone,
      // since naming the move played next to it ("both dxe5 and Nxe5…") read as if it were fine too.
      let same = "";
      if (sameTake && first) {
        const at = new Chess(first.fen);
        const hits = targets.filter((sq) => at.get(sq as Square)?.type !== "k").map((sq) => `the ${pieceAt(at, sq as Square)} on ${sq}`);
        const tempoBy = checks ? "with check" : hits.length ? `while attacking ${andList(hits)}` : "";
        const reply = p.steps[1];
        const answer = b.steps[1];
        // The opponent has to answer this move, so the reply that punished the move played doesn't come.
        const instead = tempoBy && reply && answer && answer.san !== reply.san ? `, so ${sideName(opp)} has to answer that (${answer.label}) instead of playing ${reply.san}` : "";
        same = `${san} takes the same ${pieceAt(new Chess(m.fenBefore), first.to as Square)}${tempoBy ? ` ${tempoBy}` : ""}${instead}.`;
      }
      const sameLead = same ? `${same} ` : "";
      const diff = listPieces([...without(lost, gave), ...without(won, got)]);
      let v: string;
      let threat: string | null = null;
      if (mates) v = `${why}${san} leads to mate.`;
      else if (wins) v = `${why}${san} wins ${netGain(won, gave)}.`;
      else if (guard && l === top) v = `${sameLead}${guard.better}`;
      else if (tempo && l === top) v = `${sameLead}${tempo.better} Your winning chances stay at ${w}%.`;
      else if (pawns && l === top)
        v =
          `${same ? `${same} It also` : san} ${pawns.better} That's how it holds your winning chances at ${w}%` +
          (standout && runnerUp ? `; the next best move keeps ${winOf(runnerUp)}%.` : ".");
      else if (same && net - playedNet >= 1) v = `${same} You come out ${diff} better off.`;
      // Nothing won outright: what the move threatens is its point, and why the opponent answers as
      // they do. Ahead of "comes out a pawn better off", which says how much but not why.
      else if (l === top && first && (threat = await threatOf(first, mover, stored(l), depth).catch(() => null))) {
        const answer = b.steps[1];
        v =
          `${san} ${threat}, so ${sideName(opp)} has to spend a move on it${answer ? ` (${answer.label})` : ""}. ` +
          (net - playedNet >= 1
            ? `You come out ${diff} better off than after ${playedSan}.`
            : standout && runnerUp
              ? `It keeps your winning chances at ${w}%; the next best move keeps ${winOf(runnerUp)}%.`
              : `Your winning chances stay at ${w}%.`);
      } else if (net - playedNet >= 1) v = `${san} comes out ${diff} better off than ${playedSan}.`;
      else if (standout)
        v = `${san} is the move here: it keeps your winning chances at ${w}%, and every other move gives some away (the next best keeps ${runnerUp ? winOf(runnerUp) : w}%).`;
      else if (w >= winBefore + 3) v = `${san} improves your position: your winning chances go to ${w}%.`;
      else v = `${san} is solid: your winning chances stay at ${w}%.`;
      // A capture the opponent can't simply answer by taking back: say why first (often a pin).
      if (l === top && first && /x/.test(san) && !mates) {
        const no = await failedRecapture(first, b.steps[1], stored(l), mover, depth).catch(() => null);
        if (no) v = `${no} ${v}`;
        if (no) betterThemes.push(/pinned/.test(no) ? "pin" : "recapture");
      }
      if (l === top) {
        if (mates) betterThemes.push("mate");
        else if (wins) betterThemes.push(isAttack && targets.length >= 2 ? "fork" : "material");
        if (guard) betterThemes.push("loose-square");
        if (pawns) betterThemes.push("pawns");
        if (tempo || (same && /while attacking|with check/.test(same))) betterThemes.push("tempo");
        if (threat) betterThemes.push("threat");
      }
      alternatives.push({ startFen: m.fenBefore, steps: b.steps, verdict: v, evalText: evalFor(stored(l), mover), win: w });
    }
    if (alternatives.length > 1)
      betterSummary =
        `No single move stands out: ${andList(alternatives.map((a) => a.steps[0].san))} ${alternatives.length === 2 ? "both" : "all"} keep your winning chances ` +
        `around ${alternatives[0].win}%, against ${winAfter}% after the move you played. Pick one to see the reply.`;
  }

  // The move played loses nothing by itself, but the better one wins something or mates: the
  // problem is what was missed, and saying what the move played "allows" twelve moves on would
  // only be engine noise (the drop in winning chances is the missed win).
  const forcedMate = matesFor(p.eval, opp);
  // Only when the better move stands out: when several moves keep the same chances, the drop is
  // about what the move played allows, not one move it missed.
  const missed = !forcedMate && playedNet > -1 && !guard && topGain !== null && standout;

  // Nothing concrete in the first moves: follow the line on until something happens (a pawn
  // queens, a piece goes), so the student learns what the winning chances are about. Only the move
  // played: a long line after the better move drifts into engine noise at this depth (both sides
  // queening in a race that's really equal), which explained nothing.
  let playedEvent = "";
  let deepLost: PieceType[] = [];
  if (beats && !guard && !forcedMate && !missed && playedNet > -1) {
    const pd = await followLine(m.fenBefore, m.uci, mover, QUIET_PLIES, undefined, undefined, true, depth);
    deepLost = pd.lost[mover];
    const last = pd.steps[pd.steps.length - 1];
    const deepNet = value(pd.lost[opp]) - value(pd.lost[mover]);
    // A pawn or two that goes many moves on is rarely why the move was bad: too far to follow as a
    // reason (by net value: "a knight and a pawn for a bishop" is still just a pawn).
    const farPawns = minorsCancelled(pd.lost[mover], pd.lost[opp])[0].every((t) => t === "p") && pd.steps.length > FAR_PAWN_PLIES;
    if (pd.mate) playedEvent = `In the end ${sideName(opp)} mates (${last.label}).`;
    else if (pd.promo && pd.promo.color === opp) playedEvent = `Then ${promoText(pd.promo, mover)}.`;
    // Only when you end up behind: still ahead (a bishop and a knight for a pawn) while the chances
    // drop means the material isn't the story (an attack is), and "you've lost" would be false.
    else if (deepNet < 0 && deepNet <= playedNet - 1 && !farPawns) playedEvent = `By ${last.label} you've lost ${netGain(pd.lost[mover], pd.lost[opp])}.`;
    if (playedEvent) played.steps = pd.steps;
  }

  const drop = winBefore - winAfter;
  const chances = `Your winning chances drop from ${winBefore}% to ${winAfter}%.`;
  const better0 = alternatives[0]?.steps[0]?.san ?? "";
  // The reply traps a piece, and the line does win it: that's the reason, said before what it costs.
  const losesPiece = [...lost, ...deepLost].some((t) => t !== "p");
  const trapped = beats && !forcedMate && !missed && losesPiece ? await trappedPiece(p.steps[0], p.steps[1], mover, m.evalAfter, depth).catch(() => null) : null;
  const trap = trapped && (lost.includes(trapped.type) || (playedEvent && deepLost.includes(trapped.type))) ? `${trapped.text} ` : "";
  if (trap) playedThemes.push("trapped");
  // The move played allows nothing concrete and one move stood out: the lesson is that move, so
  // the verdict starts from what it keeps (and the screen opens on it, see `focus`).
  const lone = beats && standout && alternatives.length === 1 && drop >= SOUND;
  const topWin = alternatives[0]?.win ?? winAfter;
  const keepsLead =
    winBefore >= 65 && topWin >= winBefore - SOUND
      ? `You were clearly ahead here, and ${better0} keeps it (${topWin}%). `
      : `${better0} was the move here: it keeps your winning chances at ${topWin}%. `;
  let focusBetter = false;
  if (forcedMate) {
    played.verdict = `${sideName(opp)} has a forced mate.`;
    playedThemes.push("mate");
  } else if (playedNet <= -1) {
    played.verdict = `${trap}You lose ${netGain(lost, got)}.${guard ? ` ${guard.played}` : ""}`;
    playedThemes.push("material");
    if (guard) playedThemes.push("loose-square");
  } else if (guard) {
    played.verdict = `${guard.played} ${chances}`;
    playedThemes.push("loose-square");
  } else if (missed && topGain) {
    playedThemes.push(topGain.mate ? "mate" : attack && attack.targets.length >= 2 ? "fork" : "missed-win");
    const what = topGain.mate ? `a forced mate (${better0})` : better0;
    const a = attack;
    const fork = a && a.targets.length >= 2 && !topGain.mate ? `, a fork of ${andList(a.targets.map((sq) => `the ${pieceAt(new Chess(a.fen), sq as Square)} on ${sq}`))}` : "";
    const lead =
      playedNet >= 1
        ? `${playedSan} wins ${netGain(got, lost)}, but ${what} wins more.`
        : `${playedSan} doesn't lose anything right away. The problem is what it misses: ${what}${fork}.`;
    played.verdict = `${lead} ${chances}`;
    focusBetter = lone;
  } else if (tempo || playedEvent) {
    played.verdict = [trap.trim(), tempo?.played, playedEvent, chances].filter(Boolean).join(" ");
    if (tempo) playedThemes.push("tempo");
    if (playedEvent) playedThemes.push("later");
  } else if (pawns) {
    focusBetter = lone;
    const took = playedNet >= 1 ? `wins ${listPieces(got)} too, but it ` : "";
    played.verdict = `${focusBetter ? keepsLead : ""}${playedSan} ${took}${pawns.played} ${chances}`;
    playedThemes.push("pawns");
  } else {
    // Nothing concrete found: say how much worse it gets, in the student's winning chances. The
    // stored evals, so the numbers agree with the header and the rest of the review.
    const much = drop >= 20 ? "a lot " : drop >= 10 ? "clearly " : "";
    // A small slip (as after a right drill answer, against a game move that was nearly as good):
    // say so, rather than make "White's position gets better" sound like a reason.
    const start = playedNet >= 1 ? `You do win ${listPieces(got)}${lost.length ? ` for ${listPieces(lost)}` : ""}, but` : "No material goes right away, but";
    // A quiet reply: what it threatens is often the concrete thing to see.
    const reply = p.steps[1];
    const replyThreat =
      drop >= SOUND && reply && !/[x+#]/.test(reply.san) ? await threatOf(reply, opp, p.eval ?? m.evalAfter, depth).catch(() => null) : null;
    if (replyThreat) playedThemes.push("threat");
    // Nothing lost or threatened: what the move does to the position itself, where the line
    // settles, against where the better move's line ends (a cost both pay isn't the reason).
    const end = p.steps[p.steps.length - 1];
    const pos = drop >= SOUND && end ? positionalCost(m.fenBefore, end.fen, alternatives[0]?.steps[alternatives[0].steps.length - 1]?.fen ?? null, mover) : null;
    const chased = drop >= SOUND && end && p.next ? chase(end.fen, p.next, mover) : null;
    if (chased) played.steps = [...p.steps, chased.step];
    if (pos?.marks.length) played.marks = pos.marks;
    const facts = [...(pos?.facts ?? []), ...(chased ? [chased.text] : [])];
    focusBetter = lone && !replyThreat && !facts.length;
    played.verdict =
      (focusBetter ? keepsLead : "") +
      (replyThreat ? `${reply.san} ${replyThreat}. ` : "") +
      (drop < SOUND
        ? `It was nearly as good: your winning chances only go from ${winBefore}% to ${winAfter}%, so there's no big lesson here.`
        : facts.length
          ? `${start} look at the position after ${end.label}: ${andList(facts)}. ${sideName(opp)}'s position gets ${much}better: your winning chances drop from ${winBefore}% to ${winAfter}%.`
          : `${start} ${sideName(opp)}'s position gets ${much}better: your winning chances drop from ${winBefore}% to ${winAfter}%.`);
  }

  return {
    mover,
    played,
    better: alternatives[0] ?? null,
    alternatives,
    standout,
    betterSummary,
    evalBefore: evalFor(m.evalBefore, mover),
    evalAfter: evalFor(m.evalAfter, mover),
    winBefore,
    winAfter,
    attack,
    // The better move's themes count only when it's the one move shown with its reasons; several
    // equal moves are shown as a summary, which teaches none of them.
    themes: [...new Set([...playedThemes, ...(alternatives.length === 1 ? betterThemes : [])])],
    focus: focusBetter ? "better" : "played",
  };
}

const cache = new Map<string, Promise<Explanation>>();

/** explainMove, once per move (key: the position and the move). */
export function explainCached(m: MoveToExplain): Promise<Explanation> {
  const key = `${m.fenBefore}|${m.uci}|${m.bestUci}|${m.depth ?? DEPTH}`;
  let p = cache.get(key);
  if (!p) {
    p = explainMove(m);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
