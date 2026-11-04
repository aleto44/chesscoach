// Opening book: named lines (filled in below) used to name games, steer the opponent and drill
// the repertoire.
export interface Opening {
  eco: string;
  name: string;
  moves: string[];
}

export const OPENINGS: Opening[] = [];

/** The longest named line the game's moves start with. */
export function openingName(sans: string[]): Opening | null {
  let best: Opening | null = null;
  for (const o of OPENINGS) {
    if (o.moves.length > sans.length || (best && o.moves.length <= best.moves.length)) continue;
    if (o.moves.every((m, i) => m === sans[i])) best = o;
  }
  return best;
}
