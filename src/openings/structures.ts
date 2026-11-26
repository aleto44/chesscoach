// What kind of position the opening trainer's board has turned into, and what that means. The same
// King's Indian setup gives very different games: against c4-d4-e4 (the King's Indian) Black has time,
// against e4-d4 with the c-pawn at home (the Pirc) White comes at once, and a bishop on c4 or a
// pawn on f4 changes the plan again. Lines teach moves; these cards name the structure the moment the
// board turns into it, whatever move order got there, with the ideas that go with it.
//
// Recognized from the pieces, not from the line, so a transposition (1.d4 Nf6 2.Nc3 g6 3.Nf3 Bg7 4.e4
// is a Pirc) is caught too. Drawings use circles and yellow lines only: they speak about the
// structure, not about the next move. No runtime imports beyond chess.js, so scripts can load it.
import { Chess } from "chess.js";
import type { PlanIdea } from "./plans";

type Side = "white" | "black";

export interface Structure {
  id: string;
  name: string;
  /** The side the ideas are written for. */
  side: Side;
  /** A tactic that only works now: never offered while the student has to find it (see `patternMissed`). */
  pattern?: boolean;
  test: (b: Board) => boolean;
  ideas: PlanIdea[];
}

/** The board as square → piece ("P" white pawn, "n" black knight), plus whose move it is. */
interface Board {
  at: (sq: string) => string | undefined;
  turn: "w" | "b";
  fen: string;
}

function board(fen: string): Board {
  const map = new Map<string, string>();
  fen
    .split(" ")[0]
    .split("/")
    .forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else map.set(`${"abcdefgh"[f++]}${8 - r}`, ch);
      }
    });
  return { at: (sq) => map.get(sq), turn: fen.split(" ")[1] === "b" ? "b" : "w", fen };
}

const I = (title: string, text: string, draw: string): PlanIdea => ({ title, text, draw });

/** Black's King's Indian setup has started: the g-pawn fianchetto, d-pawn not on d5. */
const kidSetup = (b: Board) =>
  b.at("g6") === "p" && (b.at("d6") === "p" || b.at("d7") === "p") && (b.at("g7") === "b" || b.at("f6") === "n" || b.at("f8") === "b");

/** White has e4 and d4 and kept the c-pawn back: the Pirc, whatever the move order. */
const pirc = (b: Board) =>
  kidSetup(b) && b.at("e4") === "P" && b.at("d4") === "P" && (b.at("c2") === "P" || b.at("c3") === "P");

const castledShort = (b: Board) => b.at("g8") === "k" && b.at("f8") === "r";

export const STRUCTURES: Structure[] = [
  {
    id: "pirc",
    name: "It's a Pirc",
    side: "black",
    test: pirc,
    ideas: [
      I(
        "Not a King's Indian: c4 is empty",
        "White has pawns on e4 and d4 but left the c-pawn at home. Your setup is the same as in the King's Indian, but the game is sharper: White has fewer pawns to guard and develops faster, and the c4 square is free for a bishop that aims at f7.",
        "y:c4 y:c4f7",
      ),
      I(
        "e4-e5 is White's lever",
        "With no pawn on c4 to look after, White can push e5 early and chase your f6 knight. Be ready to take on e5 first. A knight driven back to e8 or d7 blocks your own pieces.",
        "r:e5 y:f6",
      ),
      I(
        "Hit the centre early",
        "Your breaks are the King's Indian ones, ...e5 and ...c5, but here they can't wait: play one before White's attack gets going. The g7 bishop backs them up by hitting d4.",
        "y:e5 y:c5 y:g7d4",
      ),
    ],
  },
  {
    id: "kid",
    name: "It's a King's Indian",
    side: "black",
    test: (b) => kidSetup(b) && b.at("c4") === "P" && b.at("d4") === "P" && b.at("e4") === "P",
    ideas: [
      I(
        "The big centre",
        "White has pawns on c4, d4 and e4: lots of space, but three pawns to keep guarded. You don't fight for the centre square by square: castle, then hit it with a pawn break.",
        "y:c4 y:d4 y:e4",
      ),
      I(
        "...e5, then the kingside",
        "...e5 is the main break. If White answers d5, the centre locks: your play is then on the kingside with ...Ne8 or ...Nh5 and ...f5, and White's is on the queenside with b4 and c5.",
        "y:e5 y:f5 r:c5",
      ),
      I(
        "Slower than the Pirc",
        "White spent a move on c4, so early attacks on your king are rarer than in the Pirc. Finish your setup first, then break.",
        "y:c4",
      ),
    ],
  },
  {
    id: "pirc-austrian",
    name: "f4 in the Pirc: the Austrian Attack",
    side: "black",
    test: (b) => pirc(b) && b.at("f4") === "P",
    ideas: [
      I(
        "e5 is coming",
        "The f4 pawn backs up e4-e5 against your f6 knight. Hit d4 before White is ready, so White's centre has to answer you instead.",
        "r:e5 y:d4",
      ),
      I(
        "...c5 is the main answer",
        "...c5 hits d4. If White takes on c5, your queen comes to a5 and wins the pawn back on the a5-e1 diagonal.",
        "y:c5 y:a5e1",
      ),
    ],
  },
  {
    id: "pirc-be3",
    name: "Be3 in the Pirc",
    side: "black",
    test: (b) => pirc(b) && b.at("e3") === "B",
    ideas: [
      I(
        "White's plan: Qd2, Bh6 and castling long",
        "Be3 with Qd2 is the 150 Attack: Bh6 trades off your g7 bishop, White castles long, and the h-pawn runs at your king.",
        "y:e3h6 r:h6 r:h4",
      ),
      I(
        "Your play is on the queenside",
        "...a6 or ...c6, then ...b5: your pawns run at the side where White's king is going. If White trades bishops on h6, take back with the king so it guards f6 and h6.",
        "y:b5 y:c6",
      ),
    ],
  },
  {
    id: "pirc-bc4",
    name: "Bc4 in the Pirc",
    side: "black",
    test: (b) => pirc(b) && b.at("c4") === "B",
    ideas: [
      I(
        "f7 is the target",
        "White's bishop on c4 looks at f7, which only your king and rook guard. Ng5 or the e-pawn running to e6 can hit it a second time.",
        "y:c4f7 r:f7",
      ),
      I(
        "Count e4's defenders",
        "Once you've castled, check e4: if only the c3 knight guards it, take it. After the knight takes back, ...d5 forks the bishop and knight, you win the piece back, and White's centre is gone.",
        "r:e4 y:d5",
      ),
      I(
        "Don't block in your pieces",
        "...Nbd7 here shuts in your c8 bishop and puts a knight on d7 where e5-e6 hits it together with f7. Prefer ...c6 and ...b5, which chase the bishop away.",
        "r:d7 r:f7 y:b5",
      ),
    ],
  },
  {
    id: "fork-trick",
    name: "The fork trick",
    side: "black",
    pattern: true,
    test: (b) =>
      b.turn === "b" &&
      castledShort(b) &&
      b.at("c4") === "B" &&
      b.at("c3") === "N" &&
      b.at("e4") === "P" &&
      b.at("f6") === "n" &&
      b.at("d6") === "p" &&
      !b.at("d5") &&
      onlyKnightGuardsE4(b),
    ideas: [
      I(
        "...Nxe4 and ...d5",
        "Only the c3 knight guarded e4. ...Nxe4 Nxe4 d5 forks the c4 bishop and the e4 knight: you win the piece back, and White's centre is gone.",
        "r:e4 r:c4 y:d5",
      ),
    ],
  },
];

function onlyKnightGuardsE4(b: Board): boolean {
  try {
    const guards = new Chess(b.fen).attackers("e4", "w");
    return guards.length === 1 && guards[0] === "c3";
  } catch {
    return false;
  }
}

/** The structures (not tactics) the position is, for the student's side. */
export function structuresAt(fen: string, side: Side): Structure[] {
  const b = board(fen);
  return STRUCTURES.filter((s) => s.side === side && !s.pattern && s.test(b));
}

/** The tactic the student could have played from `fen` (the position before their move), if any. */
export function patternAt(fen: string, side: Side): Structure | null {
  const b = board(fen);
  return STRUCTURES.find((s) => s.side === side && s.pattern && s.test(b)) ?? null;
}

export const structureById = (id: string) => STRUCTURES.find((s) => s.id === id) ?? null;
