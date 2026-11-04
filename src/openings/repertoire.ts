// The student's repertoire: the opening lines they want to play, per color. Each line is also an
// opening drill (play it from memory).
import { invoke } from "../backend";
import { create } from "zustand";
import { START_FEN } from "../chess/line";
import { addDrills } from "../analysis/drills";
import { hasBackend } from "../db";
import type { Color } from "../store";

export interface RepertoireLine {
  id: number;
  color: Color;
  name: string;
  moves: string[];
}

export const useRepertoire = create<RepertoireLine[]>(() => []);

export async function getRepertoire(): Promise<RepertoireLine[]> {
  if (!hasBackend()) return useRepertoire.getState();
  const lines = await invoke<RepertoireLine[]>("db_repertoire");
  useRepertoire.setState(lines, true);
  return lines;
}

/** Adds a line and its drill. A line for a color is only useful up to that color's last move. */
export async function addToRepertoire(color: Color, name: string, moves: string[]) {
  const own = moves.length - (((moves.length % 2 === 1) === (color === "white")) ? 0 : 1);
  const line = moves.slice(0, Math.max(own, 1));
  await invoke("db_add_repertoire", { line: { color, name, moves: line } });
  await addDrills([{ kind: "opening", title: `${name} (${color})`, fen: START_FEN, color, line }]);
  await getRepertoire();
}

export async function removeFromRepertoire(id: number) {
  await invoke("db_remove_repertoire", { id });
  await getRepertoire();
}
