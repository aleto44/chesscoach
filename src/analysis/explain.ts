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

interface Followed {
  steps: Step[];
  mate: boolean;
  /** Net material each side lost over the line. */
  lost: Record<Color, PieceType[]>;
  /** The line's eval (White's view, stored format), from the latest search along it. */
  eval: number | null;
  mateFor: number | undefined;
}

/**
 * `first`, then the engine's best play, followed until the material settles: at least `quiet`
 * plies, and on past that while the next move is a capture (so an exchange or a hanging piece is
 * always finished). The engine searches again every CHUNK plies: the tail of one long PV is
 * shallow and can contain moves the engine wouldn't really play (a piece left hanging), which made
 * lines end on a blunder that had nothing to do with the move being judged. `pv` (the engine's
 * line after `first`, if already known) saves the first search.
 */
async function followLine(fen: string, first: string, mover: Color, quiet: number, pv?: string[], pvEval?: EngineLine): Promise<Followed> {
  const chess = new Chess(fen);
  const steps: Step[] = [];
  let prev: Move | undefined;
  let queue: string[] = [];
  let latest: EngineLine | undefined = pvEval;
  const play = (uci: string) => {
    const [, turn, , , , full] = chess.fen().split(" ");
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    steps.push({
      san: m.san,
      label: `${full}${turn === "w" ? "." : "..."}${m.san}`,
      from: m.from as Key,
      to: m.to as Key,
      fen: chess.fen(),
      note: caption(chess, m, prev, mover),
    });
    prev = m;
  };
  play(first);
  if (pv) queue = pv.slice(0, CHUNK);
  while (!chess.isGameOver() && steps.length < MAX_PLIES) {
    if (!queue.length) {
      const [l] = await getReviewEngine().analyze(chess.fen(), 1, DEPTH);
      if (!l?.pv.length) break;
      latest = l;
      queue = l.pv.slice(0, CHUNK);
    }
    const next = queue[0];
    // Stop once the idea is shown and nothing is left hanging mid-exchange.
    if (steps.length >= quiet && !chess.get(next.slice(2, 4) as Square)) break;
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

/** "a, b and c". */
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

export async function explainMove(m: MoveToExplain): Promise<Explanation> {
  const mover = colorOf(m.fenBefore);
  const opp = other(mover);
  const [winBefore, winAfter] = [winFor(m.evalBefore, mover), winFor(m.evalAfter, mover)];

  const p = await followLine(m.fenBefore, m.uci, mover, QUIET_PLIES);
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
  const root = await getReviewEngine().analyze(m.fenBefore, CANDIDATES, DEPTH);
  const winOf = (l: EngineLine) => winFor(stored(l), mover);
  const candidates = root.filter((l) => l.pv[0] && l.pv[0] !== m.uci);
  const top = candidates[0];
  const alternatives: ExplainedLine[] = [];
  let standout = false;
  let betterSummary = "";
  const guard = top && winOf(top) > winAfter ? lostGuard(m.fenBefore, p.steps[0], p.steps[1], top.pv[0], mover) : null;
  if (top && winOf(top) > winAfter) {
    const runnerUp = root.find((l) => l !== top && l.pv[0]);
    const topWin = winOf(top);
    standout = !runnerUp || matesFor(stored(top), mover) || topWin - winOf(runnerUp) >= STANDOUT;
    const picks = standout ? [top] : candidates.filter((l) => l === top || (winOf(l) >= topWin - SOUND && winOf(l) >= winAfter + SOUND)).slice(0, 4);
    for (const l of picks) {
      const b = await followLine(m.fenBefore, l.pv[0], mover, standout ? QUIET_PLIES : ALT_PLIES, l.pv.slice(1), l);
      const [gave, won] = [b.lost[mover], b.lost[opp]];
      const san = b.steps[0]?.san ?? "";
      const w = winOf(l);
      // Material the move played also gets isn't a reason to prefer this one: both Nxg1 and Kxg1
      // take the rook, so "Kxg1 wins a rook" says nothing about why it's the better of the two.
      const sameTake = b.steps[0] && p.steps[0] && b.steps[0].to === p.steps[0].to && /x/.test(b.steps[0].san) && /x/.test(playedSan);
      const net = value(won) - value(gave);
      const both = sameTake ? `Both ${playedSan} and ${san} take on ${b.steps[0].to}. ` : "";
      let v: string;
      if (matesFor(stored(l), mover)) v = `${san} leads to mate.`;
      else if (net >= 1 && net - playedNet >= 1 && !sameTake) v = `${san} wins ${listPieces(won)}${gave.length ? ` for ${listPieces(gave)}` : ""}.`;
      else if (guard && l === top) v = `${both}${guard.better}`;
      else if (net - playedNet >= 1)
        v = `${both}${san} comes out ${listPieces([...without(lost, gave), ...without(won, got)])} better off than ${playedSan}.`;
      else if (standout)
        v = `${san} is the move here: it keeps your winning chances at ${w}%, and every other move gives some away (the next best keeps ${runnerUp ? winOf(runnerUp) : w}%).`;
      else if (w >= winBefore + 3) v = `${san} improves your position: your winning chances go to ${w}%.`;
      else v = `${san} is solid: your winning chances stay at ${w}%.`;
      alternatives.push({ startFen: m.fenBefore, steps: b.steps, verdict: v, evalText: evalFor(stored(l), mover), win: w });
    }
    if (alternatives.length > 1)
      betterSummary =
        `No single move stands out: ${andList(alternatives.map((a) => a.steps[0].san))} all keep your winning chances ` +
        `around ${alternatives[0].win}%, against ${winAfter}% after the move you played. Pick one to see the reply.`;
  }

  const drop = winBefore - winAfter;
  const chances = `Your winning chances drop from ${winBefore}% to ${winAfter}%.`;
  if (matesFor(p.eval, opp)) played.verdict = `${sideName(opp)} has a forced mate.`;
  else if (playedNet <= -1) played.verdict = `You lose ${listPieces(lost)}${got.length ? ` for ${listPieces(got)}` : ""}.`;
  else if (guard) played.verdict = `${guard.played} ${chances}`;
  else {
    // Nothing concrete found: say how much worse it gets, in the student's winning chances. The
    // stored evals, so the numbers agree with the header and the rest of the review.
    const much = drop >= 20 ? "a lot " : drop >= 10 ? "clearly " : "";
    const start = playedNet >= 1 ? `You do win ${listPieces(got)}${lost.length ? ` for ${listPieces(lost)}` : ""}, but` : "No material goes right away, but";
    played.verdict = `${start} ${sideName(opp)}'s position gets ${much}better: your winning chances drop from ${winBefore}% to ${winAfter}%.`;
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
