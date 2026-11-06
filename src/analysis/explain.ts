// Why a move was bad, as lines to step through on a board: what the opponent does after it, and
// what the better move would have done, each played out to where the material settles, with a
// caption per move and a one-line verdict. Computed on demand (two short searches), so stored
// analyses need nothing new.
import { Chess, type Move, type Square } from "chess.js";
import type { Key } from "chessground/types";
import { getReviewEngine } from "../engine/stockfish";
import { whiteWinPercent } from "../engine/live";
import { pieceCounts, PIECE_NAMES, PIECE_VALUES, type PieceType } from "../chess/material";
import type { Color } from "../store";

const DEPTH = 14;
/** How far a line is followed when judging what it wins: far enough for an exchange to finish. */
const MAX_PLIES = 9;
/** A line where nothing is captured still shows a few moves, to show the idea. */
const QUIET_PLIES = 5;

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
}

export interface ExplainedLine {
  /** Where the line starts (before the move being judged). */
  startFen: string;
  steps: Step[];
  /** What the line comes to, in a sentence. */
  verdict: string;
  /** Eval at the end of the line, mover's view, as text (+1.2, #3). */
  evalText: string;
}

export interface Explanation {
  mover: Color;
  /** The move played, then the opponent's best answers. */
  played: ExplainedLine;
  /** The engine's move instead, then its continuation. Null when it's the move played. */
  better: ExplainedLine | null;
  evalBefore: string;
  evalAfter: string;
  winBefore: number;
  winAfter: number;
}

export interface MoveToExplain {
  fenBefore: string;
  /** The move played, UCI. */
  uci: string;
  bestUci: string | null;
  /** White's view, centipawns (mates as ±(10000 − distance)), as the review stored them. */
  evalBefore: number;
  evalAfter: number;
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

/** The most valuable piece the piece on `sq` now attacks and could win (undefended, or worth more). */
function threatFrom(chess: Chess, sq: Square): { type: PieceType; sq: Square } | null {
  const parts = chess.fen().split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  let probe: Chess;
  try {
    probe = new Chess(parts.join(" "));
  } catch {
    return null; // e.g. the side that just moved gives check: flipping the turn is illegal
  }
  let best: { type: PieceType; sq: Square; v: number } | null = null;
  for (const m of probe.moves({ square: sq, verbose: true })) {
    if (!m.captured || m.captured === "k") continue;
    probe.move(m);
    const defended = probe.moves({ verbose: true }).some((r) => r.to === m.to);
    probe.undo();
    const v = PIECE_VALUES[m.captured as PieceType];
    if ((defended && v <= PIECE_VALUES[m.piece as PieceType]) || v < 3) continue;
    if (!best || v > best.v) best = { type: m.captured as PieceType, sq: m.to, v };
  }
  return best && { type: best.type, sq: best.sq };
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
  const threat = threatFrom(chess, m.to);
  if (chess.inCheck()) text += threat ? `, with check, also attacking the ${PIECE_NAMES[threat.type]} on ${threat.sq}` : ", with check";
  else if (threat) text += `, attacking the ${PIECE_NAMES[threat.type]} on ${threat.sq}`;
  return `${text}.`;
}

/** Plays `ucis` from `fen` and cuts the line where the material settles. */
function playOut(fen: string, ucis: string[], mover: Color): { steps: Step[]; mate: boolean } {
  const chess = new Chess(fen);
  const steps: Step[] = [];
  let settled = 0;
  let captures = false;
  let prev: Move | undefined;
  for (let i = 0; i < Math.min(ucis.length, MAX_PLIES); i++) {
    const uci = ucis[i];
    const [, turn, , , , full] = chess.fen().split(" ");
    let m: Move;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    if (m.captured) captures = true;
    steps.push({
      san: m.san,
      label: `${full}${turn === "w" ? "." : "..."}${m.san}`,
      from: m.from as Key,
      to: m.to as Key,
      fen: chess.fen(),
      note: caption(chess, m, prev, mover),
    });
    prev = m;
    if (chess.isCheckmate()) return { steps, mate: true };
    // Settled: the next move doesn't capture, so no exchange is half done.
    const next = ucis[i + 1];
    if (!next || !chess.get(next.slice(2, 4) as Square)) settled = i + 1;
  }
  const keep = captures ? Math.max(settled, 1) : Math.min(steps.length, QUIET_PLIES);
  return { steps: steps.slice(0, keep), mate: false };
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

/** `first`, then the engine's best play after it, cut where the material settles. */
async function lineAfter(fen: string, first: string, mover: Color) {
  const chess = new Chess(fen);
  chess.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first[4] });
  const [line] = chess.isGameOver() ? [] : await getReviewEngine().analyze(chess.fen(), 1, DEPTH);
  const { steps, mate } = playOut(fen, [first, ...(line?.pv ?? [])], mover);
  const end = steps[steps.length - 1]?.fen ?? fen;
  return { steps, mate, lost: netLosses(fen, end), eval: line ? stored(line) : null, mateFor: line?.mate };
}

export async function explainMove(m: MoveToExplain): Promise<Explanation> {
  const mover = colorOf(m.fenBefore);
  const opp = other(mover);

  const p = await lineAfter(m.fenBefore, m.uci, mover);
  const oppMates = p.mate || (p.mateFor !== undefined && p.mateFor > 0 === (opp === "white"));
  const [lost, got] = [p.lost[mover], p.lost[opp]];
  let verdict: string;
  if (oppMates) verdict = `${sideName(opp)} has a forced mate.`;
  else if (value(lost) - value(got) >= 1) verdict = `You lose ${listPieces(lost)}${got.length ? ` for ${listPieces(got)}` : ""}.`;
  else {
    // No material: say how much worse it gets, in the student's winning chances.
    const drop = winFor(m.evalBefore, mover) - winFor(p.eval ?? m.evalAfter, mover);
    const much = drop >= 20 ? "a lot " : drop >= 10 ? "clearly " : "";
    verdict =
      `No material goes right away, but ${sideName(opp)}'s position gets ${much}better: ` +
      `your winning chances drop from ${winFor(m.evalBefore, mover)}% to ${winFor(p.eval ?? m.evalAfter, mover)}%.`;
  }
  const played: ExplainedLine = {
    startFen: m.fenBefore,
    steps: p.steps,
    verdict,
    evalText: evalFor(p.eval ?? m.evalAfter, mover),
  };

  let better: ExplainedLine | null = null;
  if (m.bestUci && m.bestUci !== m.uci) {
    const b = await lineAfter(m.fenBefore, m.bestUci, mover);
    const myMate = b.mate || (b.mateFor !== undefined && b.mateFor > 0 === (mover === "white"));
    const [gave, won] = [b.lost[mover], b.lost[opp]];
    const first = b.steps[0]?.san ?? "";
    let v: string;
    if (myMate) v = `${first} leads to mate.`;
    else if (value(won) - value(gave) >= 1) v = `${first} wins ${listPieces(won)}${gave.length ? ` for ${listPieces(gave)}` : ""}.`;
    // The stored eval, so the numbers agree with the rest of the review.
    else v = `${first} keeps the game at ${evalFor(m.evalBefore, mover)} for you.`;
    better = { startFen: m.fenBefore, steps: b.steps, verdict: v, evalText: evalFor(b.eval ?? m.evalBefore, mover) };
  }

  return {
    mover,
    played,
    better,
    evalBefore: evalFor(m.evalBefore, mover),
    evalAfter: evalFor(m.evalAfter, mover),
    winBefore: winFor(m.evalBefore, mover),
    winAfter: winFor(m.evalAfter, mover),
  };
}

const cache = new Map<string, Promise<Explanation>>();

/** explainMove, once per move (key: the position and the move). */
export function explainCached(m: MoveToExplain): Promise<Explanation> {
  const key = `${m.fenBefore}|${m.uci}`;
  let p = cache.get(key);
  if (!p) {
    p = explainMove(m);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
