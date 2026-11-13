// "Find the plan" positions: quiet moments from the student's own games where the engine's move is
// a positional one (no capture, no check) and the student's move cost something without a tactic
// behind it. Those are the positions where knowing what to play for matters more than calculation.
import { Chess } from "chess.js";
import type { Color } from "../store";
import { fenKey, forStudent, gameNote, type TrainingGame } from "../training/games";

export interface PlanPosition {
  id: string;
  fen: string;
  color: Color;
  /** What the student played in the game, SAN, and what it cost (centipawns, their view). */
  gameMove: string;
  gameLoss: number;
  /** The engine's move from the game's analysis (checked again, deeper, when shown). */
  bestUci: string;
  note: string;
  gameId: number;
  ply: number;
}

/** A tactic was involved: these positions are for the drills, not for plans. */
const TACTICAL = ["missed-mate", "allowed-mate", "hung-piece", "missed-capture", "missed-check"];

/** A move that's neither a capture, a check nor a promotion. */
export function isQuiet(fen: string, uci: string): boolean {
  try {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return !m.captured && !m.promotion && !m.san.includes("+") && !m.san.includes("#");
  } catch {
    return false;
  }
}

export function planPositions(games: TrainingGame[]): PlanPosition[] {
  const out: PlanPosition[] = [];
  const seen = new Set<string>();
  for (const g of games) {
    for (const m of g.moves) {
      if (!m.byStudent || m.phase === "opening" || !m.bestUci || m.evalBefore === null) continue;
      if (m.class !== "inaccuracy" && m.class !== "mistake") continue;
      if ((m.cpLoss ?? 0) < 40 || (m.tags ?? []).some((t) => TACTICAL.includes(t))) continue;
      const before = forStudent(m.evalBefore, g.color);
      // Roughly balanced or a little better: a plan decides these; won or lost ones are about technique.
      if (before < -200 || before > 300) continue;
      if (!isQuiet(m.fenBefore, m.bestUci)) continue;
      const key = fenKey(m.fenBefore);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `p${g.id}-${m.ply}`,
        fen: m.fenBefore,
        color: g.color,
        gameMove: m.san,
        gameLoss: m.cpLoss ?? 0,
        bestUci: m.bestUci,
        note: gameNote(g),
        gameId: g.id,
        ply: m.ply,
      });
    }
  }
  return out;
}

// ---- Results, kept on this device ----

export interface PlanRecord {
  tries: number;
  right: number;
  last: "right" | "close" | "wrong" | null;
}

const RECORD_KEY = "cc-plans";
/** Positions the deeper look turned out to be tactical after all: not offered again. */
const SKIP_KEY = "cc-plans-skip";

const read = <T,>(key: string, empty: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? empty;
  } catch {
    return empty;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: not kept.
  }
};

export const planRecords = (): Record<string, PlanRecord> => read(RECORD_KEY, {});

export function recordPlan(id: string, result: "right" | "close" | "wrong") {
  const all = planRecords();
  const r = all[id] ?? { tries: 0, right: 0, last: null };
  all[id] = { tries: r.tries + 1, right: r.right + (result === "wrong" ? 0 : 1), last: result };
  write(RECORD_KEY, all);
}

export const skippedPlans = (): string[] => read(SKIP_KEY, []);
export const skipPlan = (id: string) => write(SKIP_KEY, [...new Set([...skippedPlans(), id])]);

/** What to practise next: never tried, then missed last time, then the rest; newest games first within each. */
export function planQueue(all: PlanPosition[]): PlanPosition[] {
  const records = planRecords();
  const skip = new Set(skippedPlans());
  const rank = (p: PlanPosition) => {
    const r = records[p.id];
    return !r ? 0 : r.last === "wrong" ? 1 : r.last === "close" ? 2 : 3;
  };
  return all.filter((p) => !skip.has(p.id)).sort((a, b) => rank(a) - rank(b));
}
