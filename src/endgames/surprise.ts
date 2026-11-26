// "Surprise me": endings that teach a way of thinking rather than a fixed technique. Pawns, plus at
// most one minor piece or a queen each; either a win to bring home or a level position to hold.
// Each comes with its ideas, revealed one per hint: what the structure is about, where the king
// goes, what to push, and what to watch out for, each with its drawings on the board.
//
// Written by hand from the start position. scripts/check-endgames.mjs checks every result with
// Stockfish, and every "watch out" claim here was checked too (a move called a mistake really does
// throw the result away). `draw` uses the opening plans' notation (openings/plans.ts): "g:e3e4" an
// arrow, "r:c5" a circle; g your move, b a king or piece route, r the opponent or a target, y a
// square worth noting. Moves in `text` are played from the start position when hovered.
import type { PlanIdea } from "../openings/plans";
import type { Endgame } from "./positions";

const I = (title: string, text: string, draw: string): PlanIdea => ({ title, text, draw });

export const SURPRISES: Endgame[] = [
  {
    id: "s-outside-decoy",
    group: "Pawn endings",
    name: "The outside passed pawn as a decoy",
    fen: "8/5p1p/4k1p1/8/P7/4K1P1/7P/8 w - - 0 1",
    side: "white",
    goal: "promote",
    failBelow: 150,
    level: 1,
    hint: "Push the a-pawn to drag the black king away, then eat the kingside with your own king.",
    ideas: [
      I(
        "Your trump: the outside passed pawn",
        "Material is level, but your a-pawn is passed and far from everything else. Only Black's king can stop it, and it has to leave the kingside to do it.",
        "g:a4a8 r:e6",
      ),
      I(
        "Push it as a decoy",
        "Play a5 and a6. You aren't really trying to queen it: every step drags the black king further toward the corner. Losing the a-pawn is the plan, not a failure.",
        "g:a4a6 r:e6b6",
      ),
      I(
        "Your king goes the other way",
        "While Black's king chases the a-pawn, yours walks into the kingside: Ke3-e4-e5-f6. The f7 and h7 pawns fall, and your g- and h-pawns are far faster than anything Black has left.",
        "b:e3e4 b:e4e5 b:e5f6 r:f7 r:h7",
      ),
      I(
        "Count before you go",
        "When the black king takes on a6 or a7 it is three or four moves from the kingside. Have your king on f6 by then and the race is yours. If the black king turns back early instead, the a-pawn just queens.",
        "y:a6 y:f6",
      ),
    ],
  },
  {
    id: "s-protected-passer",
    group: "Pawn endings",
    name: "Protected passed pawn",
    fen: "8/8/6p1/2Pk4/1P5P/P4K2/8/8 w - - 0 1",
    side: "white",
    goal: "promote",
    failBelow: 150,
    level: 1,
    hint: "The c-pawn ties Black's king down for good. Your king is free: go and take g6.",
    ideas: [
      I(
        "A passed pawn the king can't take",
        "c5 is passed, and b4 guards it: the black king can never capture it. All it can do is stand in front of it, and that ties the king to the queenside for good.",
        "g:b4c5 y:c5 r:d5",
      ),
      I(
        "Your king is the free piece",
        "Black's king has to babysit the c-pawn; yours doesn't. Walk it to the kingside, Kf3-f4-g5, and take g6. Then the h-pawn runs and nothing can stop it.",
        "b:f3f4 b:f4g5 r:g6 g:h4h8",
      ),
      I(
        "No need to hurry the c-pawn",
        "It is strongest where it is, guarded and pinning the black king to its square. Push it when that gains something, for instance when the black king has gone after your other pawns.",
        "y:c5 y:c6 y:c7",
      ),
    ],
  },
  {
    id: "s-candidate-pawn",
    group: "Pawn endings",
    name: "Making a passed pawn from the majority",
    fen: "8/p3k1pp/8/8/8/8/P3KPPP/8 w - - 0 1",
    side: "white",
    goal: "promote",
    failBelow: 150,
    level: 1,
    hint: "King up first, then advance the kingside pawns together, led by the f-pawn.",
    ideas: [
      I(
        "Count the majorities",
        "On the queenside it's one pawn each. On the kingside it's three against two: that extra pawn means a passed pawn is coming, by force, if you advance them properly.",
        "y:f2 y:g2 y:h2 r:g7 r:h7",
      ),
      I(
        "King first",
        "Bring the king up before the pawns: Ke2-e3-e4. From the fourth rank it backs the pawns up and keeps the black king off the squares in front of them.",
        "b:e2e3 b:e3e4",
      ),
      I(
        "The candidate pawn",
        "The f-pawn has no black pawn in front of it, so it's the one that becomes passed: the candidate. Advance the three pawns together (f4, g4, h4) and push the f-pawn through when the others back it up. Pawns side by side can't be stopped by a lone king.",
        "g:f2f5 y:f7 y:f8",
      ),
      I(
        "Watch the a-pawns",
        "Black will push ...a5-a4 to make a pawn of its own or drag your king over. From d4 or e4 your king is close enough to deal with it; just don't wander so far to the kingside that it runs free.",
        "r:a7a4 y:a2",
      ),
    ],
  },
  {
    id: "s-active-king",
    group: "Pawn endings",
    name: "The active king, and which way to send it",
    fen: "6k1/pp4pp/8/8/3K4/8/PP4PP/8 w - - 0 1",
    side: "white",
    goal: "promote",
    failBelow: 150,
    level: 2,
    hint: "Head for the queenside, where Black's king isn't, and leave your kingside pawns alone.",
    ideas: [
      I(
        "Kings decide pawn endings",
        "The pawns are level and symmetrical. The difference is the kings: yours is in the centre, Black's is still on g8. That lead wins, but only if you use it now.",
        "y:d4 r:g8",
      ),
      I(
        "Which way? Where their king isn't",
        "Go for the queenside, the side Black's king is furthest from: Kd4-d5-d6-c7, then b7 and a7 fall. Reaching d6 before the black king gets to e7 or d7 is the point.",
        "b:d4d5 b:d5d6 b:d6c7 r:b7 r:a7",
      ),
      I(
        "Leave the kingside pawns alone",
        "h4 or g4 look active but throw the win away: they give Black's king something to attack and burn the spare pawn moves you'll want when the kings stand face to face. The king does the work.",
        "r:g2 r:h2",
      ),
      I(
        "Then the queenside pawns run",
        "Once your king has eaten on the queenside, your a- and b-pawns are passed. Black's king can't stop them and guard its own pawns at the same time.",
        "g:a2a8 g:b2b8",
      ),
    ],
  },
  {
    id: "s-locked-wing",
    group: "Pawn endings",
    name: "Locked wing, open wing",
    fen: "8/p4p2/1p3kp1/7p/P6P/1PK3P1/5P2/8 w - - 0 1",
    side: "white",
    goal: "promote",
    failBelow: 150,
    level: 2,
    hint: "The kingside is shut, so the game is on the queenside where your king already is. Go straight there.",
    ideas: [
      I(
        "The kingside is shut",
        "h4 and h5 block each other, and f2 and g3 protect each other. Black's king has no quick way in there, and every move it spends on that side is a move it isn't defending the queenside.",
        "y:h4 y:h5 g:f2g3 r:f6",
      ),
      I(
        "Your king is on the open wing",
        "On the queenside nothing stops your king: Kc3-c4-b5-a6, then a7 and b6 fall and your pawns become passers. Go straight there with Kc4: Kd4 is one move slower to b5, and that tempo turns the win into a draw.",
        "b:c3c4 b:c4b5 b:b5a6 r:a7 r:b6",
      ),
      I(
        "Don't touch the queenside pawns",
        "b4? looks like taking space, but it loosens the pawns your king is about to use as a shield and only draws. On a4 and b3 they're fine: the king does the eating.",
        "r:b3b4 y:b3 y:a4",
      ),
    ],
  },
  {
    id: "s-good-bishop",
    group: "Minor pieces",
    name: "Good bishop against bad bishop",
    fen: "8/8/p1b1k1p1/Pp1p3p/1P1P3P/4K1P1/4B3/8 w - - 0 1",
    side: "white",
    goal: "promote",
    failBelow: 150,
    level: 2,
    hint: "Black's pawns are stuck on its bishop's colour. King to f4, then g4 to make h5 a second target.",
    ideas: [
      I(
        "Good bishop, bad bishop",
        "All of Black's pawns (a6, b5, d5, g6, h5) stand on light squares, the same colour as its bishop: they block it, and it can only stand guard. Your pawns are on dark squares, so your light-squared bishop is free to attack them.",
        "r:a6 r:b5 r:d5 r:g6 r:h5 y:c6",
      ),
      I(
        "King to f4",
        "Bring the king toward the kingside: Ke3-f4, eyeing g5 and e5. Those are dark squares, and Black's bishop can never cover them; only the black king can.",
        "b:e3f4 y:g5 y:e5",
      ),
      I(
        "A second target: the g4 break",
        "g4! opens the kingside. After gxh5 gxh5 the h5 pawn is a fixed target, and your bishop on f3 hits both h5 and d5. Black's bishop can't defend both, and its king can't be everywhere.",
        "g:g3g4 r:h5 r:d5 b:e2f3",
      ),
      I(
        "Trade bishops only into a won pawn ending",
        "Swapping on d5 (Bxd5 Bxd5 Kxd5) can be the cleanest finish, once your king is close and the pawn race works out. Count it first: a pawn ending is final.",
        "y:d5",
      ),
    ],
  },
  {
    id: "s-queen-passer",
    group: "Queen endings",
    name: "Queen and a passed pawn",
    fen: "6k1/5pp1/7p/3P4/3Q4/6PP/2q2PK1/8 w - - 0 1",
    side: "white",
    goal: "convert",
    failBelow: 120,
    winAt: 700,
    level: 3,
    hint: "Push the d-pawn with the queen beside it, keep your king sheltered, and watch f2.",
    ideas: [
      I(
        "The passed pawn is the plan",
        "In queen endings a passed pawn gets stronger with every step, and the opposing queen has to stop it alone. d6 and d7, backed by your queen, is the whole plan.",
        "g:d5d7 y:d8",
      ),
      I(
        "Black's only hope: perpetual check",
        "Black can't stop the pawn by force, so it will check your king again and again. Keep the king tucked in by f2, g3 and h3, and look for a check you can block with your queen while offering a trade: the pawn ending is an easy win.",
        "y:f2 y:g3 y:h3 r:c2",
      ),
      I(
        "Watch f2",
        "Right now Black's queen eyes f2 (...Qxf2+). Your king guards it. If the king steps away to dodge checks, make sure f2 is still covered or the black queen gets a free pawn and a stream of checks.",
        "r:c2f2",
      ),
    ],
  },
  {
    id: "s-knight-outside",
    group: "Minor pieces",
    name: "Knight ending: the outside passer",
    fen: "8/5pk1/4p1p1/3n4/8/1P2PNP1/5PK1/8 w - - 0 1",
    side: "white",
    goal: "convert",
    failBelow: 60,
    winAt: 350,
    level: 3,
    hint: "The b-pawn is the trump, but don't let the knight snap it up. e4 first, then bring the king.",
    ideas: [
      I(
        "The b-pawn is your trump",
        "Your b-pawn is passed and far from the other pawns. Knights are short-range pieces and hate pawns on the far wing: Black's knight will have to leave the centre to deal with it.",
        "g:b3b8 r:d5",
      ),
      I(
        "Don't hand it to the knight",
        "b4? hangs it to ...Nxb4, and then there's nothing left to win with. Push the pawn only to squares the knight can't reach, or once your king or knight guards it.",
        "r:d5b4",
      ),
      I(
        "Kick the knight, then bring the king",
        "e4 drives the knight off d5. Then the king comes in: Kg2-f1-e2-d3, toward the centre and the b-pawn. A knight ending is a pawn ending with knights: the more active king usually wins it.",
        "g:e3e4 b:g2f1 b:f1e2 b:e2d3",
      ),
    ],
  },
  {
    id: "s-race-centre",
    group: "Pawn endings",
    name: "Race to the centre",
    fen: "5k2/pp4pp/8/8/8/3K4/PP4PP/8 b - - 0 1",
    side: "black",
    goal: "draw",
    moves: 20,
    level: 1,
    hint: "Your king to e7 and d6 at once; stand in front of White's king; leave your pawns alone.",
    ideas: [
      I(
        "Race to the centre",
        "Pawns are level, but White's king is already central. Yours must come to the middle right now: ...Kf8-e7-d6. A king on d6 or e6 blocks every way in.",
        "b:f8e7 b:e7d6 r:d3",
      ),
      I(
        "Meet the king face to face",
        "When White's king comes forward, stand in front of it (take the opposition): Kd4 is met by ...Kd6, Ke4 by ...Ke6. A king can't walk past a king that faces it.",
        "y:d6 y:e6 r:d4 r:e4",
      ),
      I(
        "Don't touch your pawns",
        "...g5? or ...a5? look active but lose: they make targets for White's king and give away spare pawn moves you'll need when the kings face off. Even ...Kg8? is too slow. King moves only, for now.",
        "r:g7g5 r:a7a5",
      ),
    ],
  },
  {
    id: "s-queen-perpetual",
    group: "Queen endings",
    name: "A pawn down: hold with checks",
    fen: "3Q4/5pk1/6p1/7p/1p5P/6P1/5PK1/1q6 w - - 0 1",
    side: "white",
    goal: "draw",
    moves: 15,
    level: 2,
    hint: "Check every move (Qd4+, Qd8+): the black king can't hide, and a quiet move lets the b-pawn run.",
    ideas: [
      I(
        "Check, check, check",
        "You're a pawn down and the b-pawn will queen if Black gets time. Your weapon is the open black king: Qd4+ and Qd8+ keep checking, and Black has nowhere to hide.",
        "g:d8d4 r:g7 r:b4",
      ),
      I(
        "Never give Black a free move",
        "A quiet move like Qb6? or Qd7? looks useful but loses: Black's queen checks your king instead, and the b-pawn runs in between. While you can check, check.",
        "r:b1e4 r:b4b1",
      ),
      I(
        "No queen trade",
        "If the queens come off, that b-pawn wins the pawn ending easily. Don't give a check that Black can block with a check of its own and force the swap.",
        "r:b4 y:d4",
      ),
    ],
  },
  {
    id: "s-bad-bishop-hold",
    group: "Minor pieces",
    name: "Bad bishop, locked position: hold it",
    fen: "8/4bk2/3p4/2pPp1p1/2P1P1P1/3K4/4N3/8 b - - 0 1",
    side: "black",
    goal: "draw",
    moves: 20,
    level: 2,
    hint: "The only way in is on the queenside: ...Ke8 at once and shadow White's king. The bishop guards d6 and g5 from e7.",
    ideas: [
      I(
        "Everything is locked: find the doors",
        "Every pawn is blocked. White's king can't get in on the kingside (f4 is covered by your pawns), so its only way in is the queenside: Kd3-c2-b3-a4, then b5 or a5.",
        "r:d3c2 r:c2b3 r:b3a4 r:b5 r:a5",
      ),
      I(
        "Shadow the king, at once",
        "Your king must head for the queenside right now: ...Kf7-e8-d7-c7, then b6. ...Ke8 is the only move that holds; ...Kf6 or ...Kg6 lose the race to the queenside.",
        "b:f7e8 b:e8d7 b:d7c7 b:c7b6",
      ),
      I(
        "The bad bishop is a good defender",
        "Your bishop is hemmed in by its own pawns, but it has one job: guard d6 and g5, the only pawns the knight can attack. From e7 it covers both. Keep it there and don't go on adventures.",
        "y:e7d6 y:e7g5",
      ),
    ],
  },
];

/** A surprise for the student: one they haven't won yet if any is left, never the one just played. */
export function pickSurprise(records: Record<string, { wins: number }>, not?: string): Endgame {
  const pool = SURPRISES.filter((e) => e.id !== not);
  const fresh = pool.filter((e) => !records[e.id]?.wins);
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
}
