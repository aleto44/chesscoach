// The student's analyzed games with their evals, for the trainers that work from the student's own
// positions: win it again (convert/defend), find the plan, and the opening leaks. One backend call
// (db_training_games), kept for a minute so moving between those screens doesn't ask again.
import { useEffect, useState } from "react";
import { invoke } from "../backend";
import { hasBackend } from "../db";
import type { Color } from "../store";

export interface TrainingMove {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  /** 1 or 0, as SQLite keeps it. */
  byStudent: number;
  /** White's view, centipawns (mate = ±10000); null where the analysis has none. */
  evalBefore: number | null;
  evalAfter: number | null;
  cpLoss: number | null;
  bestUci: string | null;
  class: string | null;
  phase: string | null;
  tags: string[] | null;
}

export interface TrainingGame {
  id: number;
  date: string;
  mode: string;
  color: Color;
  result: "1-0" | "0-1" | "1/2-1/2";
  openingName: string | null;
  source: string | null;
  opponentRating: number | null;
  moves: TrainingMove[];
}

/** The student's side of a White-view eval. */
export const forStudent = (cp: number, color: Color) => (color === "white" ? cp : -cp);

/** "won" / "drew" / "lost", from the student's side. */
export function outcome(g: Pick<TrainingGame, "result" | "color">): "won" | "drew" | "lost" {
  if (g.result === "1/2-1/2") return "drew";
  return (g.result === "1-0") === (g.color === "white") ? "won" : "lost";
}

/** "Your rated game, 12 Oct: you drew it", for the line above the board. */
export function gameNote(g: TrainingGame): string {
  const d = new Date(g.date + "T00:00:00");
  const day = isNaN(d.getTime()) ? g.date : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const kind = g.source ? `${g.source} game` : g.mode === "rated" ? "rated game" : "practice game";
  return `Your ${kind}, ${day}: you ${outcome(g)} it`;
}

/** A position's identity without the move counters, so transpositions match. */
export const fenKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

interface Query {
  realOnly: boolean;
  maxPly: number | null;
  limit: number;
}

const cache = new Map<string, { at: number; games: Promise<TrainingGame[]> }>();
const FRESH_MS = 60_000;

export function trainingGames(q: Query): Promise<TrainingGame[]> {
  if (!hasBackend()) return Promise.resolve([]);
  const key = JSON.stringify(q);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.games;
  const games = invoke<TrainingGame[]>("db_training_games", { ...q });
  cache.set(key, { at: Date.now(), games });
  games.catch(() => cache.delete(key));
  return games;
}

/** Loads the games and works something out from them, for a menu screen. */
export function useFromGames<T>(q: Query, work: (games: TrainingGame[]) => T | Promise<T>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const key = JSON.stringify(q);
  useEffect(() => {
    let live = true;
    trainingGames(q)
      .then(work)
      .then((data) => live && setState({ data, error: null }))
      .catch((e) => live && setState({ data: null, error: String(e) }));
    return () => {
      live = false;
    };
    // `work` is a plain function of the games; the query decides when to load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
