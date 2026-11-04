// Spaced-repetition drills (SM-2 scheduling lives in src-tauri/src/stats.rs). Mistake drills come
// from post-game analysis; opening drills from the repertoire; coach drills from set_drill.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { sideToMove, type Line } from "../chess/line";
import { hasBackend } from "../db";
import type { Color, GameMeta } from "../store";
import type { MoveAnnotation } from "./review";

export interface Drill {
  id: number;
  kind: "mistake" | "opening" | "coach";
  title: string;
  fen: string;
  color: Color;
  answerUci: string | null;
  line: string[];
  note: string | null;
  sourceGameId: number | null;
  sourcePly: number | null;
  dueAt: string;
  reps: number;
  lapses: number;
}

export interface NewDrill {
  kind: Drill["kind"];
  title: string;
  fen: string;
  color: Color;
  answerUci?: string | null;
  line?: string[];
  note?: string | null;
  sourceGameId?: number | null;
  sourcePly?: number | null;
}

export const useDrillCounts = create<{ total: number; due: number }>(() => ({ total: 0, due: 0 }));

export async function refreshDrillCounts() {
  if (!hasBackend()) return;
  useDrillCounts.setState(await invoke<{ total: number; due: number }>("db_drill_counts"));
}

export async function addDrills(drills: NewDrill[]): Promise<number> {
  if (!hasBackend() || drills.length === 0) return 0;
  const added = await invoke<number>("db_add_drills", { drills });
  await refreshDrillCounts();
  return added;
}

export const dueDrills = (limit = 20, all = false) => invoke<Drill[]>("db_due_drills", { limit, all });

/** Records the attempt; returns when the drill is next due. */
export async function gradeDrill(id: number, correct: boolean, played: string, ms: number): Promise<string> {
  const due = await invoke<string>("db_grade_drill", { id, correct, played, ms });
  await refreshDrillCounts();
  return due;
}

export async function retireDrill(id: number) {
  await invoke("db_retire_drill", { id });
  await refreshDrillCounts();
}

/** One drill per mistake or blunder the student made: "find a better move here". */
export function addMistakeDrills(
  g: { gameId: number; line: Line; meta: Pick<GameMeta, "studentColor"> },
  annotations: MoveAnnotation[],
) {
  const drills: NewDrill[] = [];
  annotations.forEach((a, i) => {
    if ((a.class !== "mistake" && a.class !== "blunder") || !a.bestUci) return;
    const fen = g.line.fens[i];
    const color = sideToMove(fen);
    if (g.meta.studentColor !== "both" && g.meta.studentColor !== color) return;
    const [, turn, , , , full] = fen.split(" ");
    drills.push({
      kind: "mistake",
      title: `Move ${full}${turn === "w" ? "." : "..."}: you played ${g.line.sans[i]}`,
      fen,
      color,
      answerUci: a.bestUci,
      note: a.tags.length ? a.tags.join(", ") : null,
      sourceGameId: g.gameId,
      sourcePly: i + 1,
    });
  });
  return addDrills(drills);
}
