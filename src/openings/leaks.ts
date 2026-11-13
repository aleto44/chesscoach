// Opening leaks: where the student's real games (rated and imported, their unaided play) go wrong
// in the first moves. Three views of the same games: how each opening scores and stands after it,
// the positions the student keeps reaching and keeps misplaying, and, when there's a repertoire,
// where the games leave it (the student forgetting a move, or the opponent playing a reply the
// repertoire doesn't cover yet). All from the stored post-game analysis; no engine runs here.
import { Chess } from "chess.js";
import { START_FEN } from "../chess/line";
import type { Color } from "../store";
import { fenKey, forStudent, outcome, type TrainingGame } from "../training/games";
import type { RepertoireLine } from "./repertoire";

/** How far into a game counts as the opening, here. */
export const LEAK_PLIES = 24;
/** A single mistake counts as an opening leak only this early (move 8); later it's a tactic. */
const EARLY = 16;
/** The eval "after the opening" is read here (move 10, either side). */
const AFTER_OPENING = 20;

export interface OpeningScore {
  color: Color;
  name: string;
  games: number;
  /** Points per game, 0–1. */
  score: number;
  /** The student's average eval after move 10, centipawns. */
  evalAfter: number | null;
}

export interface Leak {
  key: string;
  color: Color;
  fen: string;
  /** The moves that led there in the latest game that reached it. */
  path: string[];
  opening: string | null;
  /** Games that reached it, and the student's points in them. */
  games: number;
  points: number;
  /** What the student played there, most often first. */
  played: { san: string; count: number }[];
  /** The engine's move (SAN) from the analysis, and the average centipawns the student's moves cost. */
  best: string | null;
  avgLoss: number;
  worst: string | null;
}

export interface RepertoireExit {
  key: string;
  color: Color;
  /** "you": the student played something else than their line; "them": the opponent left it. */
  kind: "you" | "them";
  /** The position the student had to move in. */
  fen: string;
  path: string[];
  games: number;
  /** The student's move there, and the repertoire's (for "you") or the engine's (for "them"). */
  played: string;
  answer: string | null;
  lastMove: string | null;
}

export interface Leaks {
  games: number;
  openings: OpeningScore[];
  leaks: Leak[];
  exits: RepertoireExit[];
  hasRepertoire: Record<Color, boolean>;
}

const pointsOf = (g: TrainingGame) => ({ won: 1, drew: 0.5, lost: 0 })[outcome(g)];
const family = (name: string | null) => (name ? name.split(":")[0].trim() : "Unnamed opening");
const RANK: Record<string, number> = { inaccuracy: 1, mistake: 2, blunder: 3 };

function sanOf(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

function openingScores(games: TrainingGame[]): OpeningScore[] {
  const groups = new Map<string, { color: Color; name: string; games: number; points: number; evals: number[] }>();
  for (const g of games) {
    const name = family(g.openingName);
    const key = `${g.color}|${name}`;
    const row = groups.get(key) ?? { color: g.color, name, games: 0, points: 0, evals: [] };
    row.games++;
    row.points += pointsOf(g);
    const m = [...g.moves].reverse().find((x) => x.ply <= AFTER_OPENING && x.evalAfter !== null);
    if (m && g.moves.length >= AFTER_OPENING) row.evals.push(Math.max(-1000, Math.min(1000, forStudent(m.evalAfter!, g.color))));
    groups.set(key, row);
  }
  return [...groups.values()]
    .map((r) => ({
      color: r.color,
      name: r.name,
      games: r.games,
      score: r.points / r.games,
      evalAfter: r.evals.length ? Math.round(r.evals.reduce((a, b) => a + b, 0) / r.evals.length) : null,
    }))
    .sort((a, b) => b.games - a.games);
}

function findLeaks(games: TrainingGame[]): Leak[] {
  const at = new Map<string, Leak & { totalLoss: number; seen: Set<number> }>();
  for (const g of games) {
    const sans: string[] = [];
    for (const m of g.moves) {
      if (m.ply > LEAK_PLIES) break;
      if (m.byStudent && m.cpLoss !== null) {
        const key = `${g.color}|${fenKey(m.fenBefore)}`;
        const row =
          at.get(key) ??
          ({
            key,
            color: g.color,
            fen: m.fenBefore,
            path: [...sans],
            opening: g.openingName,
            games: 0,
            points: 0,
            played: [],
            best: sanOf(m.fenBefore, m.bestUci),
            avgLoss: 0,
            worst: null,
            totalLoss: 0,
            seen: new Set<number>(),
          } as Leak & { totalLoss: number; seen: Set<number> });
        if (!row.seen.has(g.id)) {
          row.seen.add(g.id);
          row.games++;
          row.points += pointsOf(g);
          // Loss is capped: one blunder shouldn't outweigh a habit.
          row.totalLoss += Math.min(m.cpLoss, 300);
          const p = row.played.find((x) => x.san === m.san);
          if (p) p.count++;
          else row.played.push({ san: m.san, count: 1 });
          if (m.class && (RANK[m.class] ?? 0) > (RANK[row.worst ?? ""] ?? 0)) row.worst = m.class;
          row.best ??= sanOf(m.fenBefore, m.bestUci);
        }
        at.set(key, row);
      }
      sans.push(m.san);
    }
  }
  return [...at.values()]
    .map(({ totalLoss, seen: _seen, ...l }) => ({ ...l, avgLoss: Math.round(totalLoss / l.games), played: l.played.sort((a, b) => b.count - a.count), totalLoss }))
    // A habit (twice or more, costing something on average), or a real mistake in the first moves:
    // a one-off blunder later on is a tactic, which the drills cover.
    .filter((l) => (l.games >= 2 && l.avgLoss >= 40) || (l.path.length < EARLY && (l.worst === "mistake" || l.worst === "blunder")))
    // The engine's move was what the student played: nothing to fix.
    .filter((l) => !(l.played.length === 1 && l.played[0].san === l.best))
    // Habits first, by what they cost in all; then the one-offs.
    .sort((a, b) => Number(b.games >= 2) - Number(a.games >= 2) || b.totalLoss - a.totalLoss)
    .slice(0, 15)
    .map(({ totalLoss: _t, ...l }) => l);
}

/** Every position along the repertoire's lines for one color, and the moves its lines play from each. */
function repertoireTree(lines: RepertoireLine[], color: Color) {
  const next = new Map<string, Set<string>>();
  for (const line of lines.filter((l) => l.color === color)) {
    const chess = new Chess(START_FEN);
    for (const san of line.moves) {
      const key = fenKey(chess.fen());
      let m;
      try {
        m = chess.move(san);
      } catch {
        break;
      }
      if (!next.has(key)) next.set(key, new Set());
      next.get(key)!.add(m.san);
    }
    if (!next.has(fenKey(chess.fen()))) next.set(fenKey(chess.fen()), new Set());
  }
  return next;
}

function repertoireExits(games: TrainingGame[], lines: RepertoireLine[]): RepertoireExit[] {
  const trees = { white: repertoireTree(lines, "white"), black: repertoireTree(lines, "black") };
  const exits = new Map<string, RepertoireExit>();
  const add = (e: Omit<RepertoireExit, "games">) => {
    const row = exits.get(e.key);
    if (row) row.games++;
    else exits.set(e.key, { ...e, games: 1 });
  };
  for (const g of games) {
    const tree = trees[g.color];
    if (tree.size === 0) continue;
    const sans: string[] = [];
    for (let i = 0; i < g.moves.length; i++) {
      const m = g.moves[i];
      const key = fenKey(m.fenBefore);
      const book = tree.get(key);
      if (!book || book.size === 0) break;
      if (m.byStudent) {
        if (!book.has(m.san)) {
          add({ key: `you|${g.color}|${key}|${m.san}`, color: g.color, kind: "you", fen: m.fenBefore, path: [...sans], played: m.san, answer: [...book][0], lastMove: sans[sans.length - 1] ?? null });
          break;
        }
      } else if (!book.has(m.san)) {
        // The opponent played a move the repertoire doesn't answer; the student's reply is the next move.
        const reply = g.moves[i + 1];
        if (reply) {
          add({
            key: `them|${g.color}|${fenKey(reply.fenBefore)}`,
            color: g.color,
            kind: "them",
            fen: reply.fenBefore,
            path: [...sans, m.san],
            played: reply.san,
            answer: sanOf(reply.fenBefore, reply.bestUci),
            lastMove: m.san,
          });
        }
        break;
      }
      sans.push(m.san);
    }
  }
  return [...exits.values()].sort((a, b) => b.games - a.games).slice(0, 15);
}

export function openingLeaks(games: TrainingGame[], repertoire: RepertoireLine[]): Leaks {
  return {
    games: games.length,
    openings: openingScores(games),
    leaks: findLeaks(games),
    exits: repertoireExits(games, repertoire),
    hasRepertoire: { white: repertoire.some((r) => r.color === "white"), black: repertoire.some((r) => r.color === "black") },
  };
}

/** "1.e4 e5 2.Nf3 Nc6 3.Bc4": a path of moves from the start, numbered. */
export function numbered(sans: string[]): string {
  return sans.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");
}
