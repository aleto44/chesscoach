// Opening training: a system the student plays, and the replies they'll meet with it. Each game the
// computer picks one reply, weighted by how often club players choose it, follows it while the
// student stays on the line, then plays on its own. The lines also feed the book (game names, the
// coach's book_lookup). Every line is checked for legality by scripts/check-book.mjs.
import type { Color } from "../store";
import { repertoireSet } from "./repertoire";

export interface TrainingLine {
  eco: string;
  name: string;
  moves: string[];
  /** Relative frequency among the set's lines (roughly per 100 club games). */
  weight: number;
}

export interface TrainingSet {
  id: string;
  name: string;
  color: Color;
  blurb: string;
  lines: TrainingLine[];
}

const T = (eco: string, name: string, moves: string, weight: number): TrainingLine => ({
  eco,
  name,
  moves: moves.split(" "),
  weight,
});

export const TRAINING_SETS: TrainingSet[] = [
  {
    id: "london",
    name: "London System",
    color: "white",
    blurb: "d4, Bf4, e3, Nf3, c3 and Nbd2 against almost anything. These are the setups Black tries against it.",
    lines: [
      // 1...d5
      T("D02", "London System: Classical, ...e6 and ...Bd6", "d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Bd3 c5 c3 Nc6 Nbd2 b6", 14),
      T("D00", "London System: ...c5 and ...Qb6", "d4 d5 Bf4 c5 e3 Nc6 c3 Qb6 Qb3 c4 Qc2 Nf6 Nd2 Bg4", 10),
      T("D02", "London System: Mirror, ...Bf5", "d4 d5 Bf4 Bf5 e3 e6 Nf3 Nf6 Bd3 Bxd3 Qxd3 c5 c3 Nc6 Nbd2 Bd6", 8),
      T("D02", "London System: ...c5 and ...cxd4", "d4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 cxd4 exd4 Bf5", 6),
      T("D02", "London System: ...c6 and the ...Bg4 pin", "d4 d5 Bf4 Nf6 e3 c6 Nf3 Bg4 c3 e6 Nbd2 Nbd7 h3 Bh5", 6),
      T("D02", "London System: Grünfeld setup, ...g6", "d4 d5 Bf4 Nf6 e3 g6 Nf3 Bg7 Be2 O-O O-O c5 c3 Nc6", 4),
      T("D02", "London System: ...Nh5 hunting the bishop", "d4 d5 Bf4 Nf6 e3 c5 Nf3 Nc6 Nbd2 cxd4 exd4 Nh5", 3),
      T("D00", "London System: Chigorin setup, ...Nc6 and ...Bf5", "d4 d5 Bf4 Nc6 e3 Bf5 c3 e6 Nd2 Nf6 Ngf3 Bd6", 3),
      // 1...Nf6
      T("A48", "London System: King's Indian setup", "d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3 c5 c3 Nc6", 10),
      T("A46", "London System: ...d5, ...c5 and ...Qb6", "d4 Nf6 Bf4 d5 e3 c5 c3 Nc6 Nd2 Qb6 Qb3 c4 Qc2", 8),
      T("A46", "London System: Queen's Indian setup, ...b6", "d4 Nf6 Bf4 e6 e3 b6 Nf3 Bb7 h3 Be7 Bd3 c5 c3 O-O", 7),
      T("A45", "London System: Early ...c5 and ...Qb6", "d4 Nf6 Bf4 c5 e3 Qb6 Nc3 a6", 5),
      T("A45", "London System: Old Indian, ...d6 and ...e5", "d4 Nf6 Bf4 d6 e3 Nbd7 Nf3 g6 h3 Bg7 Be2 O-O O-O e5", 4),
      // Other first moves
      T("A80", "London System: Dutch, ...f5", "d4 f5 Bf4 Nf6 e3 e6 Nf3 b6 h3 Bb7 Bd3 Be7", 3),
      T("A40", "Englund Gambit", "d4 e5 dxe5 Nc6 Nf3 Qe7 Bf4 Qb4+", 2),
      T("A43", "Old Benoni, ...c5", "d4 c5 d5 e5 e4 d6", 2),
    ],
  },
  {
    id: "italian",
    name: "Italian Game",
    color: "white",
    blurb: "1.e4 e5 2.Nf3 Nc6 3.Bc4, then the slow c3 and d3 plan. These are Black's answers, and the second moves that avoid it.",
    lines: [
      T("C54", "Italian Game: Giuoco Pianissimo, ...d6 and ...a5", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a5 Nbd2 h6", 14),
      T("C54", "Italian Game: Giuoco Pianissimo, ...a6 and ...Ba7", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 a6 O-O d6 a4 Ba7 Re1 O-O", 6),
      T("C53", "Italian Game: Giuoco Piano, early ...d6", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 d6 d4 exd4 cxd4 Bb6", 4),
      T("C55", "Italian Game: Two Knights, d3 and ...Be7", "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Be7 O-O O-O Re1 d6 c3 Na5 Bb5 a6 Ba4 b5 Bc2 c5", 12),
      T("C55", "Italian Game: Two Knights, d3 and ...d5", "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 d5 exd5 Nxd5 O-O Be7 Re1 O-O", 5),
      T("C50", "Italian Game: Hungarian Defense, ...Be7", "e4 e5 Nf3 Nc6 Bc4 Be7 d3 Nf6 O-O O-O Re1 d6 c3", 4),
      T("C42", "Petrov's Defense: Classical", "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7 O-O Nc6 c4", 6),
      T("C41", "Philidor Defense: Exchange", "e4 e5 Nf3 d6 d4 exd4 Nxd4 Nf6 Nc3 Be7 Bc4 O-O O-O", 4),
    ],
  },
  {
    id: "queens-gambit",
    name: "Queen's Gambit",
    color: "white",
    blurb: "1.d4 d5 2.c4, offering the c-pawn for the center. These are the defences Black chooses.",
    lines: [
      T("D63", "Queen's Gambit Declined: Orthodox", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5", 14),
      T("D37", "Queen's Gambit Declined: ...Be7 move order", "d4 d5 c4 e6 Nc3 Be7 Nf3 Nf6 Bg5 h6 Bh4 O-O e3 b6", 6),
      T("D15", "Slav Defense: Main line, ...dxc4 and ...Bf5", "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O", 12),
      T("D45", "Semi-Slav Defense: Meran setup", "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Qc2 Bd6 Bd3 O-O O-O", 8),
      T("D27", "Queen's Gambit Accepted: Classical", "d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6", 7),
      T("D07", "Queen's Gambit: Chigorin Defense", "d4 d5 c4 Nc6 Nc3 dxc4 Nf3 Nf6 e4 Bg4 Be3 e6", 3),
      T("D08", "Queen's Gambit: Albin Countergambit", "d4 d5 c4 e5 dxe5 d4 Nf3 Nc6 g3 Be6 Nbd2 Qd7 Bg2", 2),
    ],
  },
  {
    id: "caro-kann",
    name: "Caro-Kann",
    color: "black",
    blurb: "1.e4 c6 and 2...d5: solid, with the light-squared bishop out before ...e6. These are the ways White meets it.",
    lines: [
      T("B12", "Caro-Kann Defense: Advance, Short Variation", "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7 O-O Ne7", 14),
      T("B12", "Caro-Kann Defense: Advance, Bayonet g4", "e4 c6 d4 d5 e5 Bf5 Nc3 e6 g4 Bg6 Nge2 c5 h4 h5 Nf4 Bh7", 5),
      T("B19", "Caro-Kann Defense: Classical, h4 and h5", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6", 12),
      T("B19", "Caro-Kann Defense: Classical via 3.Nd2", "e4 c6 d4 d5 Nd2 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6", 5),
      T("B13", "Caro-Kann Defense: Exchange, Bd3 and Qb3", "e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7 Nd2 e6 Ngf3 Bd6", 8),
      T("B14", "Caro-Kann Defense: Panov Attack", "e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7 cxd5 Nxd5", 5),
      T("B11", "Caro-Kann Defense: Two Knights", "e4 c6 Nc3 d5 Nf3 Bg4 h3 Bxf3 Qxf3 e6 d3 Nf6 Bd2 Nbd7", 4),
      T("B12", "Caro-Kann Defense: Fantasy Variation", "e4 c6 d4 d5 f3 e6 Nc3 Bb4", 3),
    ],
  },
  {
    id: "e5",
    name: "1...e5",
    color: "black",
    blurb: "Meeting 1.e4 with e5, Nc6 and Nf6: classical development. These are White's main tries.",
    lines: [
      T("C84", "Ruy Lopez: Closed, ...b5 and ...d6", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3", 14),
      T("C69", "Ruy Lopez: Exchange, ...f6", "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5", 5),
      T("C55", "Italian Game: Two Knights, d3 and ...Bc5", "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O O-O Re1 a5", 12),
      T("C59", "Two Knights Defense: Ng5, ...Na5 main line", "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4 Ne5", 8),
      T("C45", "Scotch Game: Mieses, ...Qe7", "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6", 7),
      T("C49", "Four Knights Game: Scotch, ...Bb4", "e4 e5 Nf3 Nc6 Nc3 Nf6 d4 exd4 Nxd4 Bb4 Nxc6 bxc6 Bd3 d5 exd5 cxd5 O-O O-O Bg5 c6", 4),
      T("C29", "Vienna Game: Vienna Gambit, ...d5", "e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7", 4),
      T("C36", "King's Gambit Accepted: Modern, ...d5", "e4 e5 f4 exf4 Nf3 d5 exd5 Nf6 Bb5+ c6 dxc6 bxc6 Bc4 Nd5", 3),
    ],
  },
  {
    id: "kid",
    name: "King's Indian",
    color: "black",
    blurb: "...Nf6, ...g6, ...Bg7, ...d6 and ...O-O, then ...e5 (or ...c5) to hit the center. These are White's setups against it.",
    lines: [
      T("E99", "King's Indian Defense: Mar del Plata, ...Ne7 and ...f5", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 Nd3 f5", 14),
      T("E92", "King's Indian Defense: Exchange, queens off", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 dxe5 dxe5 Qxd8 Rxd8 Bg5 Re8", 5),
      T("E92", "King's Indian Defense: Petrosian, d5 and Bg5", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 d5 a5 Bg5 h6 Bh4 Na6", 5),
      T("E81", "King's Indian Defense: Sämisch, ...c5 gambit", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 c5 dxc5 dxc5 Qxd8 Rxd8 Bxc5 Nc6", 6),
      T("E76", "King's Indian Defense: Four Pawns Attack", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4 O-O Nf3 c5 d5 e6 Be2 exd5 cxd5 Re8", 3),
      T("E73", "King's Indian Defense: Averbakh, Bg5", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Be2 O-O Bg5 c5 d5 h6 Be3 e6", 4),
      T("E69", "King's Indian Defense: Fianchetto, ...Nbd7 and ...e5", "d4 Nf6 c4 g6 Nf3 Bg7 g3 O-O Bg2 d6 O-O Nbd7 Nc3 e5 e4 c6 h3 Qb6", 8),
      T("A48", "London System: King's Indian setup, ...Nbd7 and ...e5", "d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 O-O Nbd7 h3 Qe8 Bh2 e5", 6),
      T("A48", "Torre Attack: King's Indian setup", "d4 Nf6 Nf3 g6 Bg5 Bg7 Nbd2 O-O e3 d6 Be2 Nbd7 O-O e5 c3 h6 Bh4", 4),
      T("A26", "English Opening: Botvinnik setup vs the King's Indian", "c4 Nf6 Nc3 g6 g3 Bg7 Bg2 O-O e4 d6 Nge2 e5 O-O c6 d3", 4),
    ],
  },
  {
    id: "qgd",
    name: "Queen's Gambit Declined",
    color: "black",
    blurb: "1.d4 d5 with ...e6 and ...Nf6: a rock in the center. These are the setups White plays against it.",
    lines: [
      T("D58", "Queen's Gambit Declined: Tartakower", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7", 12),
      T("D36", "Queen's Gambit Declined: Exchange, Carlsbad", "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 c6 e3 Be7 Bd3 Nbd7 Qc2 O-O Nf3 Re8", 10),
      T("D37", "Queen's Gambit Declined: Harrwitz Attack, Bf4", "d4 d5 c4 e6 Nf3 Nf6 Nc3 Be7 Bf4 O-O e3 c5 dxc5 Bxc5", 6),
      T("E06", "Catalan Opening: Open, ...dxc4", "d4 d5 c4 e6 Nf3 Nf6 g3 Be7 Bg2 O-O O-O dxc4 Qc2 a6 Qxc4 b5 Qc2 Bb7", 8),
      T("D02", "London System: ...Bd6 and the bishop trade", "d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bxd6 Qxd6 Bd3 c5 c3 Nc6 Nbd2 O-O O-O e5", 6),
      T("D05", "Colle-Zukertort System", "d4 d5 Nf3 Nf6 e3 e6 Bd3 c5 b3 Nc6 O-O Bd6 Bb2 O-O", 5),
    ],
  },
];

/** A line's name within its set: "Caro-Kann Defense: Panov Attack" is just "Panov Attack" under Caro-Kann. */
export function shortName(set: TrainingSet, line: TrainingLine): string {
  const i = line.name.indexOf(": ");
  return i > 0 && line.name.startsWith(set.name) ? line.name.slice(i + 2) : line.name;
}

export type Commonness = "common" | "occasional" | "rare";

export const commonness = (l: TrainingLine): Commonness => (l.weight >= 8 ? "common" : l.weight >= 4 ? "occasional" : "rare");

/** A built-in set or the student's repertoire for a color (see repertoire.ts). */
export function findSet(id: string): TrainingSet | undefined {
  const own = id.match(/^mine-(white|black)$/);
  return own ? repertoireSet(own[1] as Color) : TRAINING_SETS.find((s) => s.id === id);
}

/** One line of the set, weighted by how often it's played. */
export function pickLine(set: TrainingSet): TrainingLine {
  const total = set.lines.reduce((n, l) => n + l.weight, 0);
  let r = Math.random() * total;
  for (const l of set.lines) if ((r -= l.weight) < 0) return l;
  return set.lines[set.lines.length - 1];
}

/** How many times each line has come up, per device: enough to show which ones are still new. */
const SEEN_KEY = "cc-opening-seen";

export function seenCounts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function markSeen(line: TrainingLine) {
  const seen = seenCounts();
  seen[line.moves.join(" ")] = (seen[line.moves.join(" ")] ?? 0) + 1;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Private mode: nothing to keep.
  }
}

/** The training line a game's opening focus came from, if any. */
export function trainingLine(focus: string[] | null): TrainingLine | null {
  if (!focus) return null;
  const k = focus.join(" ");
  for (const s of TRAINING_SETS) for (const l of s.lines) if (l.moves.join(" ") === k) return l;
  return null;
}
