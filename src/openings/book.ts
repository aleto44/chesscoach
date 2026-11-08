// Opening book: the common named lines, used to name games, steer the opponent into an opening the
// student wants to practice, answer the coach's book_lookup and build repertoire drills.
// Every line is checked for legality by scripts/check-book.mjs.
import { TRAINING_SETS } from "./training";

export interface Opening {
  eco: string;
  name: string;
  moves: string[];
}

const L = (eco: string, name: string, moves: string) => ({ eco, name, moves: moves.split(" ") });

export const OPENINGS: Opening[] = [
  // 1.e4 e5
  L("C20", "King's Pawn Game", "e4 e5"),
  L("C50", "Italian Game", "e4 e5 Nf3 Nc6 Bc4"),
  L("C53", "Italian Game: Giuoco Piano", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3"),
  L("C54", "Italian Game: Giuoco Pianissimo", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3"),
  L("C51", "Italian Game: Evans Gambit", "e4 e5 Nf3 Nc6 Bc4 Bc5 b4"),
  L("C55", "Italian Game: Two Knights Defense", "e4 e5 Nf3 Nc6 Bc4 Nf6"),
  L("C57", "Two Knights Defense: Fried Liver Attack", "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7"),
  L("C60", "Ruy Lopez", "e4 e5 Nf3 Nc6 Bb5"),
  L("C65", "Ruy Lopez: Berlin Defense", "e4 e5 Nf3 Nc6 Bb5 Nf6"),
  L("C68", "Ruy Lopez: Exchange Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6"),
  L("C78", "Ruy Lopez: Morphy Defense", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O"),
  L("C84", "Ruy Lopez: Closed", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7"),
  L("C45", "Scotch Game", "e4 e5 Nf3 Nc6 d4 exd4 Nxd4"),
  L("C47", "Four Knights Game", "e4 e5 Nf3 Nc6 Nc3 Nf6"),
  L("C42", "Petrov's Defense", "e4 e5 Nf3 Nf6"),
  L("C41", "Philidor Defense", "e4 e5 Nf3 d6"),
  L("C30", "King's Gambit", "e4 e5 f4"),
  L("C33", "King's Gambit Accepted", "e4 e5 f4 exf4"),
  L("C25", "Vienna Game", "e4 e5 Nc3"),
  L("C21", "Danish Gambit", "e4 e5 d4 exd4 c3"),
  // Sicilian
  L("B20", "Sicilian Defense", "e4 c5"),
  L("B21", "Sicilian Defense: Smith-Morra Gambit", "e4 c5 d4 cxd4 c3"),
  L("B22", "Sicilian Defense: Alapin Variation", "e4 c5 c3"),
  L("B23", "Sicilian Defense: Closed", "e4 c5 Nc3"),
  L("B27", "Sicilian Defense", "e4 c5 Nf3"),
  L("B30", "Sicilian Defense: Old Sicilian", "e4 c5 Nf3 Nc6"),
  L("B30", "Sicilian Defense: Rossolimo Variation", "e4 c5 Nf3 Nc6 Bb5"),
  L("B33", "Sicilian Defense: Sveshnikov Variation", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5"),
  L("B40", "Sicilian Defense: French Variation", "e4 c5 Nf3 e6"),
  L("B44", "Sicilian Defense: Taimanov Variation", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6"),
  L("B50", "Sicilian Defense: Modern Variations", "e4 c5 Nf3 d6"),
  L("B51", "Sicilian Defense: Moscow Variation", "e4 c5 Nf3 d6 Bb5+"),
  L("B54", "Sicilian Defense: Open", "e4 c5 Nf3 d6 d4 cxd4 Nxd4"),
  L("B70", "Sicilian Defense: Dragon Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6"),
  L("B80", "Sicilian Defense: Scheveningen Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6"),
  L("B90", "Sicilian Defense: Najdorf Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"),
  // French, Caro-Kann and other 1.e4 defenses
  L("C00", "French Defense", "e4 e6"),
  L("C01", "French Defense: Exchange Variation", "e4 e6 d4 d5 exd5 exd5"),
  L("C02", "French Defense: Advance Variation", "e4 e6 d4 d5 e5"),
  L("C03", "French Defense: Tarrasch Variation", "e4 e6 d4 d5 Nd2"),
  L("C10", "French Defense: Paulsen Variation", "e4 e6 d4 d5 Nc3"),
  L("C11", "French Defense: Classical Variation", "e4 e6 d4 d5 Nc3 Nf6"),
  L("C15", "French Defense: Winawer Variation", "e4 e6 d4 d5 Nc3 Bb4"),
  L("B10", "Caro-Kann Defense", "e4 c6"),
  L("B12", "Caro-Kann Defense: Advance Variation", "e4 c6 d4 d5 e5"),
  L("B13", "Caro-Kann Defense: Exchange Variation", "e4 c6 d4 d5 exd5 cxd5"),
  L("B18", "Caro-Kann Defense: Classical Variation", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5"),
  L("B01", "Scandinavian Defense", "e4 d5"),
  L("B01", "Scandinavian Defense: Main Line", "e4 d5 exd5 Qxd5 Nc3 Qa5"),
  L("B07", "Pirc Defense", "e4 d6 d4 Nf6 Nc3 g6"),
  L("B06", "Modern Defense", "e4 g6"),
  L("B02", "Alekhine's Defense", "e4 Nf6"),
  L("B00", "King's Pawn Opening", "e4"),
  // 1.d4 d5
  L("A40", "Queen's Pawn Opening", "d4"),
  L("D00", "Queen's Pawn Game", "d4 d5"),
  L("D00", "London System", "d4 d5 Bf4"),
  L("D06", "Queen's Gambit", "d4 d5 c4"),
  L("D20", "Queen's Gambit Accepted", "d4 d5 c4 dxc4"),
  L("D30", "Queen's Gambit Declined", "d4 d5 c4 e6"),
  L("D35", "Queen's Gambit Declined: Exchange Variation", "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5"),
  L("D10", "Slav Defense", "d4 d5 c4 c6"),
  L("D43", "Semi-Slav Defense", "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6"),
  // 1.d4 Nf6 and others
  L("A45", "Indian Defense", "d4 Nf6"),
  L("A45", "London System", "d4 Nf6 Bf4"),
  L("E00", "Catalan Opening", "d4 Nf6 c4 e6 g3"),
  L("E12", "Queen's Indian Defense", "d4 Nf6 c4 e6 Nf3 b6"),
  L("E20", "Nimzo-Indian Defense", "d4 Nf6 c4 e6 Nc3 Bb4"),
  L("E60", "King's Indian Defense", "d4 Nf6 c4 g6"),
  L("E92", "King's Indian Defense: Classical Variation", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5"),
  L("D80", "Grünfeld Defense", "d4 Nf6 c4 g6 Nc3 d5"),
  L("A57", "Benko Gambit", "d4 Nf6 c4 c5 d5 b5"),
  L("A60", "Benoni Defense", "d4 Nf6 c4 c5 d5 e6"),
  L("A80", "Dutch Defense", "d4 f5"),
  // Flank openings
  L("A10", "English Opening", "c4"),
  L("A20", "English Opening: King's English", "c4 e5"),
  L("A04", "Réti Opening", "Nf3"),
  L("A02", "Bird's Opening", "f4"),
  L("A01", "Nimzo-Larsen Attack", "b3"),
  // Opening training lines (training.ts) name the games they come up in, too.
  ...TRAINING_SETS.flatMap((s) => s.lines.map(({ eco, name, moves }) => ({ eco, name, moves }))),
];

const startsWith = (sans: string[], moves: string[]) => moves.every((m, i) => m === sans[i]);

/** The longest named line the game's moves start with. */
export function openingName(sans: string[]): Opening | null {
  let best: Opening | null = null;
  for (const o of OPENINGS) {
    if (o.moves.length > sans.length || (best && o.moves.length <= best.moves.length)) continue;
    if (startsWith(sans, o.moves)) best = o;
  }
  return best;
}

/** Whether these moves (from the start position) are all on some book line. */
export const inBook = (sans: string[]) =>
  OPENINGS.some((o) => o.moves.length >= sans.length && startsWith(o.moves, sans));

/** Book lines that continue from these moves, with their next move. */
export function continuations(sans: string[]): { move: string; opening: Opening }[] {
  return OPENINGS.filter((o) => o.moves.length > sans.length && startsWith(o.moves, sans)).map((o) => ({
    move: o.moves[sans.length],
    opening: o,
  }));
}

/**
 * The opponent's book move toward `target` (the opening the student chose to practice), or null
 * once the game has left the line or the line is over.
 */
export function bookMove(sans: string[], target: string[] | null): string | null {
  if (!target || sans.length >= target.length || !startsWith(target, sans)) return null;
  return target[sans.length];
}
