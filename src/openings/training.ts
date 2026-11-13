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
  /** Plies already on the board when the line starts (startNearSplit); from the first move otherwise. */
  start?: number;
}

export interface TrainingSet {
  id: string;
  name: string;
  color: Color;
  blurb: string;
  lines: TrainingLine[];
  /** A way of training another set's opening: listed under that set (its id), not beside it. */
  parent?: string;
  /** This set's name among its opening's ways to train, e.g. "From the start" or "Punishing White". */
  mode?: string;
}

/** The set's opening: its parent, or itself. */
export const familyOf = (s: TrainingSet): TrainingSet => (s.parent && TRAINING_SETS.find((p) => p.id === s.parent)) || s;

/** The ways to train an opening: the set itself, then the sets listed under it. */
export const modesOf = (top: TrainingSet): TrainingSet[] => [top, ...TRAINING_SETS.filter((s) => s.parent === top.id)];

const T = (eco: string, name: string, moves: string, weight: number): TrainingLine => ({
  eco,
  name,
  moves: moves.split(" "),
  weight,
});

/**
 * For sets about the middlegame-deep part of an opening: each line starts one full move before White's
 * move that sets it apart from the rest of the set, so the student gets straight to the position that
 * matters instead of replaying the same first ten moves. The opponent's move then comes first.
 */
function startNearSplit(lines: TrainingLine[], studentIsBlack: boolean): TrainingLine[] {
  return lines.map((l) => {
    let split = 0;
    for (const o of lines) {
      if (o === l) continue;
      let i = 0;
      while (i < l.moves.length && l.moves[i] === o.moves[i]) i++;
      split = Math.max(split, i);
    }
    // Back to the opponent's move at or before the split, then one full move earlier.
    const opponentParity = studentIsBlack ? 0 : 1;
    if (split % 2 !== opponentParity) split--;
    return { ...l, start: Math.max(0, split - 2) };
  });
}

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
      T("D02", "London System: ...Nh5 hunting the bishop", "d4 d5 Bf4 Nf6 e3 c5 Nf3 Nc6 Nbd2 cxd4 exd4 Nh5 Be3 Nf6", 3),
      T("D00", "London System: Chigorin setup, ...Nc6 and ...Bf5", "d4 d5 Bf4 Nc6 e3 Bf5 c3 e6 Nd2 Nf6 Ngf3 Bd6", 3),
      // 1...Nf6
      T("A48", "London System: King's Indian setup", "d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3 c5 c3 Nc6", 10),
      T("A46", "London System: ...d5, ...c5 and ...Qb6", "d4 Nf6 Bf4 d5 e3 c5 c3 Nc6 Nd2 Qb6 Qb3 c4 Qc2", 8),
      T("A46", "London System: Queen's Indian setup, ...b6", "d4 Nf6 Bf4 e6 e3 b6 Nf3 Bb7 h3 Be7 Bd3 c5 c3 O-O", 7),
      T("A45", "London System: Early ...c5 and ...Qb6", "d4 Nf6 Bf4 c5 e3 Qb6 Nc3 a6", 5),
      T("A45", "London System: Old Indian, ...d6 and ...e5", "d4 Nf6 Bf4 d6 e3 Nbd7 Nf3 g6 h3 Bg7 Be2 O-O O-O e5 dxe5 dxe5 Nxe5", 4),
      // Other first moves
      T("A80", "London System: Dutch, ...f5", "d4 f5 Bf4 Nf6 e3 e6 Nf3 b6 h3 Bb7 Bd3 Be7", 3),
      T("A40", "Englund Gambit", "d4 e5 dxe5 Nc6 Nf3 Qe7 Bf4 Qb4+ Bd2 Qxb2 Nc3 Bb4 Rb1 Qa3 Nd5", 2),
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
    mode: "From the start",
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
    // Deeper than the King's Indian set: past move 10, where natural-looking White moves have a concrete
    // answer, mostly through the g7 bishop. Every Black move was checked with Stockfish (within ~0.2 of
    // its best), and each trap line ends with Black clearly better.
    id: "kid-punish",
    name: "King's Indian: punishing White",
    color: "black",
    parent: "kid",
    mode: "Punishing White",
    blurb:
      "Deeper King's Indian lines: the Orthodox 6...e5, the Glek 7...Na6, the Four Pawns and the London. Each starts a move before White's choice, with your setup already on the board. Some are main lines to know; the rest are natural White moves that lose something, and how the g7 bishop cashes in.",
    lines: startNearSplit([
      // Orthodox 7.O-O Nc6: main lines to know.
      T("E99", "King's Indian Defense: Mar del Plata, 10.f3 and the ...g5 storm", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 f3 f5 Be3 f4 Bf2 g5 Nd3 Ng6 c5 Nf6", 12),
      T("E97", "King's Indian Defense: Bayonet, 9.b4 Nh5", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 b4 Nh5 Re1 f5 Ng5 Nf6 Bf3 c6", 9),
      T("E97", "King's Indian Defense: Orthodox, 8.Be3 Ng4 main line", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 Be3 Ng4 Bg5 f6 Bh4 g5 Bg3 Nh6 d5 Ne7 Nd2 f5", 7),
      // Orthodox: natural moves that lose something.
      T("E97", "King's Indian Defense: Orthodox, 8.Be3 Ng4 9.Qd2?", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 Be3 Ng4 Qd2 Nxe3 fxe3 exd4 exd4 Bg4", 3),
      T("E97", "King's Indian Defense: Orthodox, 8.Be3 Ng4 9.Bc1?", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 Be3 Ng4 Bc1 exd4 Nxd4 Nxf2 Rxf2 Bxd4 Qe1 f5", 2),
      T("E97", "King's Indian Defense: Orthodox, 8.Bg5 and 10.Bg3?", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 Bg5 h6 Bh4 g5 Bg3 exd4 Nxd4 Nxe4 Nxc6 Nxc3 bxc3 bxc6", 3),
      T("E92", "King's Indian Defense: Gligoric, 7.Be3 Ng4 8.Bd2?", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 Be3 Ng4 Bd2 exd4 Nxd4 Bxd4 Bxg4 Qh4 O-O Bxg4", 2),
      // 7...exd4 8.Nxd4 Re8: only f3 or Bf3 keeps e4.
      T("E94", "King's Indian Defense: Classical, ...exd4 and ...d5", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O exd4 Nxd4 Re8 f3 c6 Kh1 d5 cxd5 cxd5", 5),
      T("E94", "King's Indian Defense: Classical, ...exd4 9.Qc2?", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O exd4 Nxd4 Re8 Qc2 Nxe4 Nxe4 Bxd4 Bg5 f6 Bd2 Bf5", 3),
      T("E94", "King's Indian Defense: Classical, ...exd4 9.Bf4?", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O exd4 Nxd4 Re8 Bf4 Nxe4 Nxe4 Rxe4 Be3 Qe7", 3),
      // Glek, 7...Na6.
      T("E94", "King's Indian Defense: Glek, 8.Be3 Ng4", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Na6 Be3 Ng4 Bg5 Qe8 dxe5 dxe5 h3 h6 Bd2 Nf6", 6),
      T("E94", "King's Indian Defense: Glek, 8.d5 Nc5", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Na6 d5 Nc5 Qc2 a5 Bg5 h6 Be3 b6", 5),
      T("E94", "King's Indian Defense: Glek, queens off and 11.Nd5?", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Na6 dxe5 dxe5 Qxd8 Rxd8 Bg5 Re8 Nd5 Nxe4 Ne7+ Kf8 Nxc8 Raxc8 Be3 f5", 3),
      // Four Pawns.
      T("E76", "King's Indian Defense: Four Pawns, 10.e5 main line", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4 O-O Nf3 c5 d5 e6 Be2 exd5 cxd5 Re8 e5 dxe5 fxe5 Ng4 Bg5 Qb6 O-O Nxe5 Nxe5 Bxe5", 4),
      T("E76", "King's Indian Defense: Four Pawns, early 9.e5? and 10.Nxd5", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4 O-O Nf3 c5 d5 e6 Be2 exd5 e5 Ne4 Nxd5 Nc6 Bd3 f5 O-O dxe5 fxe5 Be6", 2),
      T("E76", "King's Indian Defense: Four Pawns, early 9.e5? and 10.cxd5", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4 O-O Nf3 c5 d5 e6 Be2 exd5 e5 Ne4 cxd5 Nxc3 bxc3 Nd7 e6 fxe6 dxe6 Nf6", 2),
      // London.
      T("A48", "London System: King's Indian, 7.c4 Nh5", "d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 O-O Nbd7 c4 Nh5 Bg5 h6 Bh4 g5 Bg3 Nxg3 hxg3", 5),
      T("A48", "London System: King's Indian, ...Qb6 and ...Be6", "d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3 c5 c3 Qb6 Qb3 Be6 Qxb6 axb6", 5),
    ], true),
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

/**
 * A line's name within its set: "Caro-Kann Defense: Panov Attack" is just "Panov Attack" under Caro-Kann.
 * A set named "King's Indian: punishing White" counts as King's Indian here.
 */
export function shortName(set: TrainingSet, line: TrainingLine): string {
  const i = line.name.indexOf(": ");
  return i > 0 && line.name.startsWith(set.name.split(": ")[0]) ? line.name.slice(i + 2) : line.name;
}

export type Commonness = "common" | "occasional" | "rare";

export const commonness = (l: TrainingLine): Commonness => (l.weight >= 8 ? "common" : l.weight >= 4 ? "occasional" : "rare");

/** A built-in set or the student's repertoire for a color (see repertoire.ts). */
export function findSet(id: string): TrainingSet | undefined {
  const own = id.match(/^mine-(white|black)$/);
  return own ? repertoireSet(own[1] as Color) : TRAINING_SETS.find((s) => s.id === id);
}

/**
 * One line of the set, weighted by how often it's played. `avoid` (the line just played) is left out
 * when there's another: "Another line" kept dealing the set's commonest line twice in a row.
 */
export function pickLine(set: TrainingSet, avoid?: TrainingLine): TrainingLine {
  const same = (l: TrainingLine) => !!avoid && l.moves.join(" ") === avoid.moves.join(" ");
  const lines = set.lines.length > 1 ? set.lines.filter((l) => !same(l)) : set.lines;
  const total = lines.reduce((n, l) => n + l.weight, 0);
  let r = Math.random() * total;
  for (const l of lines) if ((r -= l.weight) < 0) return l;
  return lines[lines.length - 1];
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
