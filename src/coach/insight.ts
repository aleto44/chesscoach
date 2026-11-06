// Facts about positions and lines worked out by code (chess.js and Stockfish), handed to the coach so
// it reports them instead of working them out in its head, which is where it goes wrong: a piece it
// thinks is hanging, a line it thinks wins, an eval it misreads because it's from White's side.
import { Chess, type Color as ChessColor, type Square } from "chess.js";
import { getEngine, type EngineLine } from "../engine/stockfish";
import { useEval } from "../engine/live";
import { classify, lossFromEvals } from "../analysis/review";
import { moveLabel, sideToMove } from "../chess/line";
import { imbalance, pieceCounts, PIECE_NAMES, PIECE_VALUES, type PieceType } from "../chess/material";
import type { Color } from "../store";

const sideName = (c: Color) => (c === "white" ? "White" : "Black");
const other = (c: Color): Color => (c === "white" ? "black" : "white");
const toColor = (c: ChessColor): Color => (c === "w" ? "white" : "black");
const pieceName = (t: string) => (t === "k" ? "king" : PIECE_NAMES[t as PieceType]);

/** Stored form of an eval: White's view, centipawns, mates as ±(10000 − distance). */
export const storedEval = (l: Pick<EngineLine, "cp" | "mate">) =>
  l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0);

/** An eval in words that can't be misread: "White +1.20", "Black +0.40", "level (+0.05)", "Black mates in 3". */
export function evalWords(cp: number): string {
  if (Math.abs(cp) >= 10000) return `checkmate, ${cp > 0 ? "White" : "Black"} wins`;
  if (Math.abs(cp) >= 9000) return `${cp > 0 ? "White" : "Black"} mates in ${10000 - Math.abs(cp)}`;
  if (Math.abs(cp) < 15) return `level (${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)})`;
  return `${cp > 0 ? "White" : "Black"} +${(Math.abs(cp) / 100).toFixed(2)}`;
}

/** "a knight", "two pawns", "a rook and a pawn". */
function listPieces(ps: PieceType[]): string {
  const by = new Map<PieceType, number>();
  for (const p of [...ps].sort((a, b) => PIECE_VALUES[b] - PIECE_VALUES[a])) by.set(p, (by.get(p) ?? 0) + 1);
  const words = ["", "", "two", "three", "four", "five", "six", "seven", "eight"];
  const parts = [...by].map(([p, n]) => (n === 1 ? `a ${PIECE_NAMES[p]}` : `${words[n] ?? n} ${PIECE_NAMES[p]}s`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "nothing");
}

/** "White is up a knight for a pawn (+2)", "level". */
export function materialWords(fen: string): string {
  const im = imbalance(fen);
  const lead = im.white.lead > 0 ? "white" : im.black.lead > 0 ? "black" : null;
  if (!lead) {
    if (!im.white.pieces.length) return "level";
    return `level in points (White has ${listPieces(im.white.pieces)}, Black ${listPieces(im.black.pieces)})`;
  }
  const behind = other(lead);
  const forWhat = im[behind].pieces.length ? ` for ${listPieces(im[behind].pieces)}` : "";
  return `${sideName(lead)} is up ${listPieces(im[lead].pieces)}${forWhat} (+${im[lead].lead})`;
}

/** What each side lost between two positions, trades taken out: "White wins a knight", "nothing". */
export function materialChange(from: string, to: string): string {
  const [a, b] = [pieceCounts(from), pieceCounts(to)];
  const lost = { white: [] as PieceType[], black: [] as PieceType[] };
  for (const t of ["q", "r", "b", "n", "p"] as const) {
    // Promotions add pieces; only count losses.
    const w = Math.max(0, a.white[t] - b.white[t]);
    const k = Math.max(0, a.black[t] - b.black[t]);
    const traded = Math.min(w, k);
    for (let i = 0; i < w - traded; i++) lost.white.push(t);
    for (let i = 0; i < k - traded; i++) lost.black.push(t);
  }
  const value = (ps: PieceType[]) => ps.reduce((s, p) => s + PIECE_VALUES[p], 0);
  const net = value(lost.black) - value(lost.white);
  if (!lost.white.length && !lost.black.length)
    return Object.values(a.white).some((n, i) => n > Object.values(b.white)[i]) ? "pieces traded evenly" : "no material changes hands";
  if (net === 0) return `even trade (${listPieces(lost.white)} for ${listPieces(lost.black)})`;
  const winner: Color = net > 0 ? "white" : "black";
  const gave = lost[winner];
  return `${sideName(winner)} wins ${listPieces(lost[other(winner)])}${gave.length ? ` for ${listPieces(gave)}` : ""} (net ${Math.abs(net)})`;
}

const FILES = "abcdefgh";
const sq = (file: number, rank: number) => `${FILES[file]}${rank + 1}` as Square;

/** A position with the other side to move (en passant cleared), or null when that's illegal. */
function passTurn(fen: string): Chess | null {
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  try {
    return new Chess(parts.join(" "));
  } catch {
    return null;
  }
}

/**
 * Captures that win material for the side to move, by a one-move exchange count: the captured
 * piece, minus the capturer when it can be taken back. A quick count, not a search.
 */
function winningCaptures(chess: Chess): { san: string; gain: number; captured: string; to: string }[] {
  const out: { san: string; gain: number; captured: string; to: string }[] = [];
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    chess.move(m);
    const recapture = chess.moves({ verbose: true }).some((r) => r.to === m.to);
    chess.undo();
    const gain = PIECE_VALUES[m.captured as PieceType] - (recapture ? PIECE_VALUES[m.piece as PieceType] : 0);
    if (gain >= 1) out.push({ san: m.san, gain, captured: m.captured, to: m.to });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Pins against the king or queen: the pinned piece can't (or shouldn't) move off the line. */
function pins(chess: Chess): string[] {
  const out: string[] = [];
  const board = chess.board();
  const at = (f: number, r: number) => board[7 - r]?.[f] ?? null;
  const dirs = [
    [1, 0, "r"], [-1, 0, "r"], [0, 1, "r"], [0, -1, "r"],
    [1, 1, "b"], [1, -1, "b"], [-1, 1, "b"], [-1, -1, "b"],
  ] as const;
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const target = at(f, r);
      if (!target || (target.type !== "k" && target.type !== "q")) continue;
      for (const [df, dr, kind] of dirs) {
        let pinned: { f: number; r: number; type: string } | null = null;
        for (let x = f + df, y = r + dr; x >= 0 && x < 8 && y >= 0 && y < 8; x += df, y += dr) {
          const p = at(x, y);
          if (!p) continue;
          if (p.color === target.color) {
            if (pinned) break;
            pinned = { f: x, r: y, type: p.type };
            continue;
          }
          const slides = p.type === "q" || p.type === kind;
          // A queen "pinned" to its own queen isn't a pin; a queen pinned by a queen just trades.
          if (pinned && slides && !(target.type === "q" && p.type === "q") && pinned.type !== "k")
            out.push(
              `${sideName(toColor(target.color))}'s ${pieceName(pinned.type)} on ${sq(pinned.f, pinned.r)} is pinned to the ${pieceName(target.type)} by the ${pieceName(p.type)} on ${sq(x, y)}`,
            );
          break;
        }
      }
    }
  return out;
}

/** Pieces attacked and undefended, or attacked by something cheaper. */
function loosePieces(chess: Chess): string[] {
  const out: string[] = [];
  for (const row of chess.board())
    for (const p of row) {
      if (!p || p.type === "k") continue;
      const enemy = p.color === "w" ? "b" : "w";
      const attackers = chess.attackers(p.square, enemy);
      if (!attackers.length) continue;
      const defenders = chess.attackers(p.square, p.color);
      const cheapest = Math.min(...attackers.map((s) => PIECE_VALUES[chess.get(s)!.type as PieceType]));
      const value = PIECE_VALUES[p.type as PieceType];
      const by = attackers.map((s) => `${pieceName(chess.get(s)!.type)} on ${s}`).join(", ");
      const who = `${sideName(toColor(p.color))}'s ${pieceName(p.type)} on ${p.square}`;
      if (!defenders.length) out.push(`${who} is attacked (by the ${by}) and undefended`);
      else if (cheapest < value) out.push(`${who} is attacked by a cheaper piece (the ${by})`);
    }
  return out;
}

/** Isolated, doubled and passed pawns for one side. */
function pawnNotes(chess: Chess, color: ChessColor): string[] {
  const mine: { f: number; r: number }[] = [];
  const theirs: { f: number; r: number }[] = [];
  chess.board().forEach((row, i) =>
    row.forEach((p, f) => {
      if (p?.type === "p") (p.color === color ? mine : theirs).push({ f, r: 7 - i });
    }),
  );
  const files = new Set(mine.map((p) => p.f));
  const ahead = (r: number, r2: number) => (color === "w" ? r2 > r : r2 < r);
  const isolated = mine.filter((p) => !files.has(p.f - 1) && !files.has(p.f + 1)).map((p) => sq(p.f, p.r));
  const doubled = [...files].filter((f) => mine.filter((p) => p.f === f).length > 1).map((f) => `${FILES[f]}-file`);
  const passed = mine
    .filter((p) => !theirs.some((t) => Math.abs(t.f - p.f) <= 1 && ahead(p.r, t.r)))
    .map((p) => sq(p.f, p.r));
  const notes: string[] = [];
  if (passed.length) notes.push(`passed ${passed.join(", ")}`);
  if (isolated.length) notes.push(`isolated ${isolated.join(", ")}`);
  if (doubled.length) notes.push(`doubled on the ${doubled.join(", ")}`);
  return notes;
}

/** Where the king is, whether it can still castle, and the pawns in front of it. */
function kingNote(chess: Chess, color: ChessColor): string {
  const king = chess.findPiece({ type: "k", color })[0];
  if (!king) return "";
  const f = FILES.indexOf(king[0]);
  const r = Number(king[1]) - 1;
  const dir = color === "w" ? 1 : -1;
  let shield = 0;
  for (let x = Math.max(0, f - 1); x <= Math.min(7, f + 1); x++)
    for (const y of [r + dir, r + 2 * dir]) {
      const p = y >= 0 && y < 8 ? chess.get(sq(x, y)) : undefined;
      if (p?.type === "p" && p.color === color) shield++;
    }
  const rights = chess.getCastlingRights(color);
  const can = [rights.k && "short", rights.q && "long"].filter(Boolean).join(" and ");
  const castled = (color === "w" ? ["g1", "c1", "b1", "h1"] : ["g8", "c8", "b8", "h8"]).includes(king);
  const state = castled ? "castled" : can ? `can still castle ${can}` : "can't castle";
  return `king on ${king} (${state}, ${shield} pawn${shield === 1 ? "" : "s"} in front)`;
}

/** Minor pieces still at home in the opening. */
function undeveloped(chess: Chess, color: ChessColor): string[] {
  const homes = color === "w" ? { b1: "n", g1: "n", c1: "b", f1: "b" } : { b8: "n", g8: "n", c8: "b", f8: "b" };
  return Object.entries(homes)
    .filter(([s, t]) => {
      const p = chess.get(s as Square);
      return p !== undefined && p.type === t && p.color === color;
    })
    .map(([s]) => s);
}

/** Files with no pawns, and the rooks or queens on them. */
function openFiles(chess: Chess): string {
  const open: string[] = [];
  for (let f = 0; f < 8; f++) {
    let pawns = 0;
    const heavy: string[] = [];
    for (let r = 0; r < 8; r++) {
      const p = chess.get(sq(f, r));
      if (p?.type === "p") pawns++;
      if (p && (p.type === "r" || p.type === "q")) heavy.push(`${p.color === "w" ? "White" : "Black"} ${pieceName(p.type)}`);
    }
    if (!pawns) open.push(`${FILES[f]}${heavy.length ? ` (${heavy.join(", ")})` : ""}`);
  }
  return open.join(", ");
}

/**
 * Facts about a position that code can check exactly: material, loose and pinned pieces, captures
 * that win material, checks, what the other side threatens, pawn structure, kings, development.
 */
export function positionFacts(fen: string): string[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const toMove = sideToMove(fen);
  const facts: string[] = [`Side to move: ${sideName(toMove)}`, `Material: ${materialWords(fen)}`];
  if (chess.isCheckmate()) return [...facts, `${sideName(toMove)} is checkmated`];
  if (chess.isStalemate()) return [...facts, "Stalemate"];
  if (chess.inCheck()) facts.push(`${sideName(toMove)} is in check`);

  const loose = loosePieces(chess);
  if (loose.length) facts.push(`Loose pieces: ${loose.join("; ")}`);
  const pinned = pins(chess);
  if (pinned.length) facts.push(`Pins: ${pinned.join("; ")}`);

  const caps = winningCaptures(chess).slice(0, 4);
  if (caps.length)
    facts.push(
      `${sideName(toMove)}'s captures that win material on a one-move count (ignores the reply; the engine has the last word): ` +
        caps.map((c) => `${c.san} (+${c.gain})`).join(", "),
    );
  const checks = chess.moves().filter((m) => m.includes("+") || m.includes("#"));
  if (checks.length) facts.push(`${sideName(toMove)}'s checks: ${checks.slice(0, 8).join(", ")}`);
  const mates = chess.moves().filter((m) => m.includes("#"));
  if (mates.length) facts.push(`Mate in one: ${mates.join(", ")}`);

  // What the other side would do if it were its move: its threats.
  const passed = chess.inCheck() ? null : passTurn(fen);
  if (passed) {
    const threats = winningCaptures(passed).slice(0, 3);
    const mateThreat = passed.moves().filter((m) => m.includes("#"));
    const parts = [...mateThreat.map((m) => `${m} mate`), ...threats.map((t) => `${t.san} winning ${t.gain}`)];
    if (parts.length) facts.push(`${sideName(other(toMove))} threatens: ${parts.join(", ")}`);
  }

  for (const c of ["w", "b"] as const) {
    const parts = [kingNote(chess, c), ...pawnNotes(chess, c)];
    const home = Number(fen.split(" ")[5]) <= 15 ? undeveloped(chess, c) : [];
    if (home.length) parts.push(`undeveloped minor pieces on ${home.join(", ")}`);
    facts.push(`${c === "w" ? "White" : "Black"}: ${parts.filter(Boolean).join("; ")}`);
  }
  const files = openFiles(chess);
  if (files) facts.push(`Open files: ${files}`);
  return facts;
}

/** One position's eval (stored form) and best move; finished games score without the engine. */
async function evalOf(fen: string, depth: number): Promise<{ cp: number; best: string | null; line: EngineLine | null }> {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { cp: chess.turn() === "w" ? -10000 : 10000, best: null, line: null };
  if (chess.isGameOver()) return { cp: 0, best: null, line: null };
  const [line] = await getEngine().analyze(fen, 1, depth);
  return { cp: line ? storedEval(line) : 0, best: line?.pv[0] ?? null, line: line ?? null };
}

const uciToSan = (fen: string, uci: string | null) => {
  if (!uci) return null;
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
};

/** How far into a line every move is checked by the engine (each costs one short search). */
const LINE_PLIES = 14;

/**
 * Every move of a line judged by the engine: the eval before and after, what the move threw away
 * (chess.com thresholds, as the game review uses) and the engine's choice when it differs. Ends
 * with warnings for the mistakes in it, so the coach doesn't present a blunder as good play.
 */
export async function lineReport(fens: string[], sans: string[], depth = 12): Promise<string> {
  const n = Math.min(sans.length, LINE_PLIES);
  const evals = [];
  for (let i = 0; i <= n; i++) evals.push(await evalOf(fens[i], depth));
  const rows: string[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < n; i++) {
    const mover = sideToMove(fens[i]);
    const [before, after] = [evals[i], evals[i + 1]];
    const loss = lossFromEvals(before.cp, after.cp, mover);
    const playedUci = new Chess(fens[i]).move(sans[i]);
    const isBest = before.best === playedUci.from + playedUci.to + (playedUci.promotion ?? "");
    const cls = classify(loss, isBest);
    const bestSan = isBest ? null : uciToSan(fens[i], before.best);
    const label = moveLabel(fens[i], sans[i]);
    const capture = materialChange(fens[i], fens[i + 1]);
    rows.push(
      `${label} (${sideName(mover)}): ${evalWords(before.cp)} → ${evalWords(after.cp)}, ${cls}` +
        (bestSan ? ` (engine: ${bestSan}, ${evalWords(before.cp)})` : " (engine's move)") +
        (capture !== "no material changes hands" ? `; ${capture}` : ""),
    );
    if (cls === "mistake" || cls === "blunder" || cls === "inaccuracy")
      warnings.push(`${label} is ${cls === "inaccuracy" ? "an" : "a"} ${cls} by ${sideName(mover)}${bestSan ? ` (better: ${bestSan})` : ""}`);
  }
  const end = fens[n];
  const out = [
    `Engine check of each move (depth ${depth}; evals in words, chess.com thresholds):`,
    ...rows,
    `After ${n} moves: ${evalWords(evals[n].cp)}; ${materialChange(fens[0], end)} over the line; material now ${materialWords(end)}.`,
  ];
  if (sans.length > n) out.push(`(Moves after the ${n}th weren't checked.)`);
  if (warnings.length)
    out.push(
      `Mistakes in this line: ${warnings.join("; ")}. If you meant it as good play for that side, fix the line; ` +
        `if it shows the student's mistake or a refutation, say plainly which moves are the errors.`,
    );
  return out.join("\n");
}

/** The engine's top moves for a position, each with its eval in words and its first moves. */
export async function topMoves(fen: string, count = 3, depth = 14): Promise<{ text: string; lines: EngineLine[] }> {
  const chess = new Chess(fen);
  if (chess.isGameOver()) return { text: "Game over in this position.", lines: [] };
  // The eval bar's engine may already be deep into this exact position.
  const live = useEval.getState();
  let lines: EngineLine[];
  if (count === 1 && live.fen === fen && live.line && live.line.depth >= depth) lines = [live.line];
  else lines = await getEngine().analyze(fen, count, depth);
  const text = lines
    .map((l) => {
      const san = uciToSan(fen, l.pv[0]) ?? l.pv[0];
      return `${san} (${evalWords(storedEval(l))})`;
    })
    .join(", ");
  return { text, lines };
}

