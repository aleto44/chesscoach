// What to think about before each of the student's moves in a deeper line: what the opponent's last
// move changed, and what the next move is for. Without these, a line that starts at move 8 is a list
// of moves to memorize; with them each move comes with its reason, and the plan at the end (plans.ts)
// sums it up. Shown while it's the student's turn, with drawings that point at the idea (a diagonal,
// a target) without giving the move away.
//
// Keyed by line name, then by the move number of the student's move ("9" is 9...Nxe4 for Black).
// Written by hand and checked against the engine; scripts/check-book.mjs checks that each line's
// notes run without gaps to its last move for the student. No runtime imports here, so that script can load it. Drawings use the plans' format, but only
// yellow lines (y:g7d4) and circles (r:e4, y:d5): an arrow from a piece would be the answer.
import type { TrainingLine } from "./training";

export interface GuideNote {
  text: string;
  draw: string;
}

type Notes = Record<number, string | [text: string, draw: string]>;

// London from Black's side: the notes its lines share.
const LON_BF4: [string, string] = ["2.Bf4 is the London. Hit d4 at once with the c-pawn, before White's setup is ready: the bishop on f4 has left b2 without its defender.", "r:d4 r:b2"];
const LON_E3: [string, string] = ["3.e3 props up d4. Develop the queen's knight to its natural square, a second attacker on d4.", "r:d4"];
const LON_NF3: [string, string] = ["4.Nf3. Develop the king's knight: it guards d5, which will matter in a moment.", "y:d5"];
const LON_C3: [string, string] = ["3.c3 holds d4 before e3. The queen still has a target: b2 has no bishop behind it any more.", "r:b2"];
const lonQb3 = (n: number): [string, string] => [
  `${n}.Qb3 offers a queen trade. Don't take on b3 (that opens the a-file for White's rook): push the c-pawn past d4, gaining space with tempo on the queen.`,
  "r:b3",
];
const LON_DXC5: [string, string] = ["3.dxc5 grabs the pawn. Don't hurry to win it back: open the f8 bishop's diagonal first; the c5 pawn isn't going anywhere.", "r:c5 y:f8c5"];
// The London from White's side (punishing Black): the notes its lines share.
const LW_BF4: [string, string] = ["The London: bring the dark-squared bishop out before e3 shuts it in.", "y:c1h6"];
const LW_E6: [string, string] = ["3...e6. Develop the king's knight: it covers e5 and backs up d4.", "y:e5 y:d4"];
const LW_NC6: [string, string] = ["3...Nc6. Develop the king's knight: it covers e5 and d4.", "y:e5 y:d4"];
const LW_C5: [string, string] = ["3...c5 hits d4. Support it with the c-pawn and keep the pyramid whole.", "r:d4"];
const lwBd6 = (n: number): [string, string] => [
  `${n}...Bd6 offers to trade your London bishop. Keep it: drop it back on the same diagonal. If Black takes, the h-pawn takes back and your rook gets the h-file.`,
  "r:d6 y:h1h8",
];
const lwCastled = (n: number): [string, string] => [`${n}...O-O. Black's king is on g8 now: aim your light bishop at h7.`, "y:d3h7 r:h7"];
const lwBxg3 = (n: number): [string, string] => [
  `${n}...Bxg3. Take back toward the edge: the h-file opens for your rook, aimed at h7 together with the d3 bishop.`,
  "y:h1h7 r:h7",
];
const LON_NF3_3: [string, string] =["3.Nf3. Trade on d4: White has to take back with a piece, and a piece on d4 can be hit.", "r:d4"];
// The London's own main lines (White): the notes its lines share.
const LW_1: [string, string] = ["The London starts with the queen's pawn two squares: it takes the centre and opens the c1 bishop's diagonal.", "y:d4 y:c1h6"];
const lwPyramid = (n: number, move: string): [string, string] => [
  `${n}...${move}. Build the pyramid: the e-pawn backs up d4 and opens the f1 bishop.`,
  "y:d4",
];
const lwC5 = (n: number): [string, string] => [`${n}...c5 hits d4. Support it with the c-pawn and keep the pyramid whole.`, "r:d4"];
const lwHome = (n: number, move: string): [string, string] => [
  `${n}...${move}. Make a home for your f4 bishop first: without one, a black knight on h5 could take it.`,
  "y:h5 r:f4",
];
const LW_QB6: (n: number) => [string, string] = (n) => [
  `${n}...Qb6 hits b2, which your f4 bishop no longer guards. Meet it queen to queen: if Black trades, the a-file opens for your rook.`,
  "r:b2",
];
const lwC4 = (n: number): [string, string] => [
  `${n}...c4 hits your queen. Keep it on the b1-h7 diagonal, where it still guards b2 along the second rank.`,
  "r:c4 y:b1h7",
];
// The King's Indian main lines (Black): the notes its lines share.
const KID_C4: [string, string] = ["2.c4 grabs more of the centre. Start the fianchetto: one pawn step makes room for the bishop on the long diagonal.", "y:h8a1"];
const KID_NC3: [string, string] = ["3.Nc3 wants e4 next. Bishop to the long diagonal, aimed at d4.", "y:g7a1"];
const KID_E4: [string, string] = [
  "4.e4: White has the big centre. That's the King's Indian deal: let White build it, then hit it. One step of the d-pawn covers e5, so White can't push e4-e5 at your knight.",
  "y:e5",
];
const kidCastle = (n: number, move: string, why: string): [string, string] => [
  `${n}.${move} ${why} Castle: your king is safe behind the fianchetto.`,
  "y:g7",
];
const KID_E5: [string, string] = [
  "6.Be2. Now the King's Indian break: hit d4 with the e-pawn. It looks loose, but if White trades on e5, swaps queens and grabs the pawn, ...e5 dxe5 dxe5 Qxd8 Rxd8 Nxe5 Nxe4 wins it back with the g7 bishop's help.",
  "r:d4 y:g7a1",
];
const KID_NC6: [string, string] = ["7.O-O. Develop the queen's knight with a second hit on d4: White has to decide what to do about the centre.", "r:d4"];
const KID_EXD4: [string, string] = ["7.O-O. Release the tension: take on d4. White has to take back with a piece, and the long diagonal opens for your g7 bishop.", "y:g7a1 r:e4"];
const FP_C5: [string, string] = ["6.Nf3. Hit the centre from the side with the c-pawn: White's pawns are far forward, and d4 is the one to question.", "r:d4"];
const FP_E6: [string, string] = ["7.d5 grabs space. Break it up at once with the e-pawn, before White finishes developing: you want the e-file open.", "r:d5"];
const FP_EXD5: [string, string] = ["8.Be2. Open the e-file now: trade on d5.", "r:d5"];
// The London's first moves against 1...d5 and 1...Nf6 (Black): the queen's pawn meets the queen's pawn.
const LON_1: [string, string] = ["1.d4. Claim your share of the centre with the queen's pawn: it stops e4 and gets ready for ...c5 against a London.", "y:e4"];
// The London's first moves (White): 1.d4 d5 2.Bf4 Nf6 (or Bf5) 3.e3 e6 4.Nf3.
const lwStart = (second: string): Notes => ({ 1: LW_1, 2: LW_BF4, 3: lwPyramid(2, second), 4: LW_E6 });

// The King's Indian setup against 1.e4 (the Pirc) and 1.d4 sidelines: the notes its lines share.
const PIRC_1: [string, string] = [
  "1.e4. Your King's Indian setup works against 1.e4 too (there it's called the Pirc). Start with one step of the d-pawn: it covers e5 and opens the c8 bishop's diagonal.",
  "y:e5 y:c8h3",
];
const PIRC_D4: [string, string] = ["2.d4 builds the big centre. Develop the king's knight with a hit on e4.", "r:e4"];
const PIRC_NF3: [string, string] = ["2.Nf3. Develop the king's knight: it hits e4, and it's the first piece of your King's Indian setup.", "r:e4"];
const PIRC_NC3: [string, string] = ["2.Nc3 guards e4 in advance. Develop the king's knight anyway: it belongs in your King's Indian setup.", "r:e4"];
const PIRC_BC4: [string, string] = ["2.Bc4 aims at f7. Develop the king's knight with a hit on e4.", "r:e4 y:c4f7"];
const pircG6 = (n: number, move: string, why: string): [string, string] => [
  `${n}.${move} ${why} Now the fianchetto: one pawn step makes room for the bishop on the long diagonal.`,
  "y:h8a1",
];
const pircBg7 = (n: number, move: string): [string, string] => [
  `${n}.${move}. Put the bishop on the long diagonal: it aims at d4 and, once the centre opens, at White's queenside.`,
  "y:g7a1",
];
const PIRC_BE3: [string, string] = [
  "4.Be3 is the start of the 150 Attack (Qd2, a bishop trade on h6, then the h-pawn at your king). Put your bishop on the long diagonal anyway; it's still your best piece.",
  "y:g7a1 r:h6",
];
const PIRC_BE3_NF3: [string, string] = ["5.Nf3 instead of Qd2: a quieter setup. Castle: your king is safe behind the fianchetto.", "y:g7"];
const PIRC_BE3_BC4: [string, string] = [
  "6.Bc4 aims at f7. Count the defenders of e4: only the c3 knight. Take it: if the knight takes back, a pawn fork wins the piece back.",
  "r:c4 r:e4",
];
const PIRC_FORK: [string, string] = ["7.Nxe4 took back. Now the fork: one step of the d-pawn hits the c4 bishop and the e4 knight together.", "r:c4 r:e4"];
const KID_1: [string, string] = ["1.d4. Start with the king's knight: it watches e4 and d5 and keeps every King's Indian plan open.", "y:e4 y:d5"];
// The King's Indian moves before the Classical main line (1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 5.Nf3 O-O 6.Be2 e5).
const KID_CLASSICAL: Notes = {
  1: KID_1,
  2: KID_C4,
  3: KID_NC3,
  4: KID_E4,
  5: kidCastle(5, "Nf3", "is the Classical."),
  6: KID_E5,
};
// ...and before the Four Pawns Attack (5.f4 O-O 6.Nf3 c5 7.d5 e6).
const KID_FOUR_PAWNS: Notes = {
  1: KID_1,
  2: KID_C4,
  3: KID_NC3,
  4: KID_E4,
  5: kidCastle(5, "f4", "is the Four Pawns Attack: White grabs the whole centre. It looks scary, but it's slow and loosens White's position."),
  6: FP_C5,
  7: FP_E6,
};
// The London against the King's Indian setup (1.d4 Nf6 2.Bf4 g6 3.e3 Bg7 4.Nf3 O-O).
const LON_KID: Notes = {
  1: KID_1,
  2: ["2.Bf4 is the London. Keep your King's Indian setup: one pawn step for the fianchetto. The g7 bishop will lean on d4 and b2, which the f4 bishop has left.", "y:h8a1 r:b2"],
  3: ["3.e3 builds the London pyramid. Bishop to the long diagonal.", "y:g7a1"],
  4: ["4.Nf3. Castle: your king is safe behind the fianchetto.", "y:g7"],
};
// The Pirc's first moves (1.e4 d6 2.d4 Nf6 3.Nc3 g6).
const PIRC_START: Notes = { 1: PIRC_1, 2: PIRC_D4, 3: pircG6(3, "Nc3", "guards e4.") };
// 1.d4 Nf6 2.Nc3 g6 3.Nf3 Bg7 4.e4 d6 5.Bd3 O-O 6.e5 dxe5 7.dxe5 Ng4.
const BD3_E5: Notes = {
  1: KID_1,
  2: ["2.Nc3 wants e4 next. Start the fianchetto: one pawn step makes room for the bishop.", "y:h8a1"],
  3: ["3.Nf3. Bishop to the long diagonal.", "y:g7a1"],
  4: ["4.e4 builds the big centre, and it's a Pirc now. One step of the d-pawn covers e5, so White can't simply push e4-e5 at your knight.", "y:e5"],
  5: ["5.Bd3 guards e4 with the bishop. Castle: your king is safe behind the fianchetto.", "y:g7"],
  6: ["6.e5 hits the f6 knight. Don't retreat yet: trade on e5 first, so the White pawn that arrives there stands alone.", "r:e5"],
  7: ["7.dxe5 attacks the knight again. Go forward, not back: there's a square where the knight hits e5, and the e5 pawn has no pawn behind it.", "r:e5"],
};

const GUIDES: Record<string, Notes> = {
  // ---- King's Indian setup against 1.e4 and 1.d4 sidelines (main lines) ----
  "Pirc Defense: Bc4 and O-O, the ...Nxe4 fork trick": {
    1: PIRC_1,
    2: PIRC_D4,
    3: pircG6(3, "Nc3", "guards e4."),
    4: pircBg7(4, "Nf3"),
    5: ["5.Bc4 aims at f7. Castle: your king is safe behind the fianchetto, and the rook covers f7.", "y:c4f7"],
    6: ["6.O-O. Look at White's loose pieces: nothing guards the c4 bishop, and only the c3 knight guards e4. Take on e4: if the knight takes back, a pawn fork wins the piece back.", "r:c4 r:e4"],
    7: ["7.Nxe4 took back. Now the fork: one step of the d-pawn hits the c4 bishop and the e4 knight together.", "r:c4 r:e4"],
    8: ["8.Bd3 saves the bishop and guards the knight, but the knight is still attacked. Take it: material is level again, and White's e-pawn is gone.", "r:e4"],
    9: ["9.Bxe4. The d4 pawn is White's last centre pawn, and your g7 bishop already looks at it. Hit it with the c-pawn.", "r:d4 y:g7d4"],
    10: ["10.c3 props up d4. Trade it off: the c-file opens and the g7 bishop's diagonal gets longer.", "r:d4 y:g7b2"],
    11: ["11.Nxd4. Bring out your last knight: from d7 it can go to f6 or c5, both hitting the e4 bishop, and it clears the way for the c8 bishop.", "r:e4 y:f6 y:c5"],
  },
  "Pirc Defense: Bc4 and an early e5": {
    1: PIRC_1,
    2: PIRC_D4,
    3: pircG6(3, "Nc3", "guards e4."),
    4: pircBg7(4, "Nf3"),
    5: ["5.Bc4 aims at f7. Castle: your king is safe behind the fianchetto, and the rook covers f7.", "y:c4f7"],
    6: ["6.e5 hits your f6 knight before White has castled. Take on e5 first: White has to take back, and only then does your knight move.", "r:e5 r:f6"],
    7: ["7.Nxe5 took back with the knight, which now eyes f7 together with the c4 bishop. Challenge it: step the f6 knight back to a square where it attacks e5, and your g7 bishop's diagonal opens.", "r:e5 y:c4f7"],
    8: ["8.Nxd7 trades knights. Take back with the queen: it develops, and it faces White's d4 pawn down the d-file.", "r:d4"],
    9: ["9.O-O. The d4 pawn is alone in the centre now. Develop the queen's knight with a hit on it, together with the g7 bishop.", "r:d4 y:g7d4"],
    10: ["10.d5 pushes past your knight. Don't go back: the knight goes to the edge, where it hits the c4 bishop and wins you the bishop pair.", "r:c4"],
  },
  "Pirc Defense: 150 Attack, Bh6 and ...e5": {
    1: PIRC_1,
    2: PIRC_D4,
    3: pircG6(3, "Nc3", "guards e4."),
    4: ["4.Be3 is the 150 Attack: Qd2, a bishop trade on h6, then the h-pawn at your king. Put your bishop on the long diagonal anyway; it's still your best piece.", "y:g7a1 r:h6"],
    5: ["5.Qd2 lines up the e3 bishop and the queen on h6. Castle anyway: your king is fine, and you'll answer the bishop trade in the centre.", "y:d2h6"],
    6: ["6.Bh6 offers to trade your fianchetto bishop. Before it goes, strike in the centre: the e-pawn hits d4, and after the trade your king takes back on g7.", "r:d4 r:h6"],
    7: ["7.Bxg7 took the bishop. Take back with the king: with the bishop gone, it guards the dark squares around it.", "y:f6 y:h6"],
    8: ["8.f3 shores up e4 and prepares g4. Develop the queen's knight with another hit on d4.", "r:d4"],
    9: ["9.d5 closes the centre and hits your knight. Send it toward your king: from there it guards the kingside and can support ...c6 or ...f5 later.", "r:d5 y:g6"],
    10: ["10.O-O-O: the kings are on opposite wings, so it's a race. Your attack is on the queenside: one quiet step of the a-pawn so the b-pawn has support.", "y:b5 r:c1"],
  },
  "Pirc Defense: Be3, Nf3 and Bc4, the ...Nxe4 fork trick": {
    1: PIRC_1,
    2: PIRC_D4,
    3: pircG6(3, "Nc3", "guards e4."),
    4: PIRC_BE3,
    5: PIRC_BE3_NF3,
    6: PIRC_BE3_BC4,
    7: PIRC_FORK,
    8: ["8.Bd3 saves the bishop and guards the knight, but the knight is still attacked. Take it: material is level again, and White's e-pawn is gone.", "r:e4"],
    9: ["9.Bxe4. The e3 bishop guards d4, so a c-pawn break does less here. Bring out the queen's knight first: it can go on to f6 to hit the e4 bishop, and it backs up the e-pawn break.", "r:e4 y:e5"],
    10: ["10.O-O. Now strike: the e-pawn hits d4, and once the centre opens, so does your g7 bishop's diagonal.", "r:d4 y:g7b2"],
  },
  "Pirc Defense: Classical, Be2 and ...e5": {
    1: PIRC_1,
    2: PIRC_D4,
    3: pircG6(3, "Nc3", "guards e4."),
    4: pircBg7(4, "Nf3"),
    5: ["5.Be2 is the Classical: quiet development, castle, and keep the big centre. Castle too.", "y:e4 y:d4"],
    6: ["6.O-O. Strike at the centre the King's Indian way: the e-pawn hits d4, and the g7 bishop backs it up if the centre opens.", "r:d4 y:g7d4"],
    7: ["7.dxe5 trades in the centre. Take back with the pawn: it holds the centre, and the queens are about to come off.", "r:e5"],
    8: ["8.Qxd8 trades queens. Take back with the rook: it lands on the open d-file.", "y:d8d1"],
    9: ["9.Bg5 pins your f6 knight to the d8 rook. Pin back: your light bishop can hit the f3 knight, the piece that attacks e5.", "r:f3 r:e5"],
  },
  "Pirc Defense: quiet d3 setup, ...e5 and ...c5": {
    1: PIRC_1,
    2: PIRC_NF3,
    3: pircG6(3, "Nc3", "guards e4."),
    4: ["4.d3 is a quiet setup: White isn't fighting for the centre. Fianchetto the bishop as usual.", "y:g7a1"],
    5: ["5.Be2. Castle: your setup is complete before White's is.", "y:g7"],
    6: ["6.O-O. With d3 instead of d4, the centre is yours to take: the e-pawn claims e5 and watches d4.", "y:e5 y:d4"],
    7: ["7.Be3 eyes your queenside. Take more space with the c-pawn: with pawns on c5 and e5, White's d-pawn can never safely reach d4.", "y:d4"],
    8: ["8.Qd2 aims at h6, for a bishop trade there. Develop the queen's knight: it heads for d4, the hole in front of White's d3 pawn.", "y:d4"],
  },
  "Pirc Defense: Bc4 and d3, ...c5 and ...Nc6": {
    1: PIRC_1,
    2: PIRC_BC4,
    3: ["3.d3 guards e4 and keeps the bishop on c4. Now the fianchetto: one pawn step makes room for the bishop on the long diagonal.", "y:h8a1"],
    4: pircBg7(4, "Nf3"),
    5: ["5.O-O. Castle too: your king is safe behind the fianchetto, and the rook covers f7.", "y:c4f7"],
    6: ["6.c3 prepares d4 and gives the bishop a retreat. Take the d4 square first with the c-pawn.", "y:d4"],
    7: ["7.a4 stops ...b5 for now. Develop the queen's knight: it watches d4 and e5.", "y:d4 y:e5"],
    8: ["8.Nbd2. Prepare the queenside push: one step of the a-pawn, so the b-pawn has support when it goes forward.", "y:b5"],
  },
  "Pirc Defense: Bd3 and e5, ...dxe5 and ...Ng4": {
    ...BD3_E5,
    8: ["8.h3 kicks the knight. Take the e5 pawn: the g7 bishop guards your knight there.", "r:e5 y:g7e5"],
    9: ["9.Nxe5 trades knights. Take back with the bishop: it stands in the centre, aimed at c3 and b2.", "y:e5b2"],
    10: ["10.Bh6 attacks your rook. Move it to the open e-file, where it faces White's uncastled king.", "r:h6 y:e8e1"],
  },
  "Jobava London: 4.Qd2 d5 and ...Ne4": {
    1: KID_1,
    2: ["2.Nc3 wants e4. Start the fianchetto.", "y:h8a1"],
    3: ["3.Bf4 is the Jobava London: Nc3 and Bf4, often with Qd2 and a bishop trade on h6. Bishop to the long diagonal.", "y:g7a1"],
    4: ["4.Qd2 heads for h6 to trade your bishop. The c3 knight blocks White's c-pawn, so take the centre with two steps of the d-pawn: it stops e4 for good.", "y:e4"],
    5: ["5.Bh6 offers the bishop trade. Castle and let it happen: your king will take back on g7.", "r:h6"],
    6: ["6.Nf3. Jump into e4: the knight offers a trade, and only the c3 knight can challenge it.", "y:e4"],
    7: ["7.Nxe4 trades. Take back with the pawn: it gains space and hits the f3 knight.", "r:f3"],
    8: ["8.Bxg7. Take back with the king.", "y:g7"],
    9: ["9.Ng5 attacks your e4 pawn. Defend it with a counterattack: the e-pawn hits d4, and if White grabs e4, the d-file opens for your queen and rook.", "r:e4 r:d4"],
  },
  "Trompowsky Attack: 2...g6 3.Bxf6 exf6": {
    1: KID_1,
    2: ["2.Bg5 is the Trompowsky: White offers to take on f6 and double your pawns. Carry on with the fianchetto; doubled pawns here come with the bishop pair.", "r:g5 y:h8a1"],
    3: ["3.Bxf6 gives up the bishop. Take back with the e-pawn, the only pawn that can: it opens the e-file and the d8-h4 diagonal for your queen.", "y:d8h4 y:f8b4"],
    4: ["4.e3. Finish the fianchetto: the two bishops are your long-term trump.", "y:g7a1"],
    5: ["5.c4 grabs space. Hit it at once with the d-pawn: the centre opens, and open positions favour your two bishops.", "r:c4"],
    6: ["6.Nc3 attacks d5. Take on c4: White's bishop spends a move taking back, and you castle meanwhile.", "r:c4"],
    7: ["7.Bxc4. Castle.", "y:g7"],
    8: ["8.Nf3. Shut the c4 bishop out of d5 with the c-pawn, which also keeps White's knights out of b5 and d5.", "y:d5 y:b5"],
  },
  "Pirc Defense: Austrian Attack, ...c5 and ...Qa5": {
    1: PIRC_1,
    2: PIRC_D4,
    3: pircG6(3, "Nc3", "guards e4."),
    4: ["4.f4 is the Austrian Attack: White wants e5 to kick your knight. Put the bishop on the long diagonal: it aims at d4, which f4 has weakened.", "y:g7d4 r:e5"],
    5: ["5.Nf3 backs up e5. Strike at d4 with the c-pawn before the big centre rolls: the g7 bishop backs it up.", "r:d4 y:g7d4"],
    6: ["6.dxc5 grabs the pawn. Get it back with the queen: on a5 it hits c5 along the rank and pins the c3 knight to White's king.", "r:c5 y:a5e1"],
    7: ["7.Bd3 guards e4. Take the c5 pawn: material is level and your queen is active.", "r:c5"],
    8: ["8.Qe2 prepares Be3 with a hit on your queen. Castle first.", "y:e3"],
    9: ["9.Be3 hits your queen. Go back to a5, where it keeps the pin on the c3 knight.", "r:e3 y:a5e1"],
    10: ["10.O-O. Develop the light bishop with a pin: it hits the f3 knight, which guards e5 and has White's queen behind it.", "r:f3 y:e5"],
  },
  "King's Indian Defense: Bd3 setup, ...Nc6-b4": {
    1: PIRC_1,
    2: ["2.Nf3. Start the fianchetto first: the knight can wait a move.", "y:h8a1"],
    3: ["3.d4 builds the centre. Bishop to the long diagonal, aimed at d4.", "y:g7d4"],
    4: ["4.c4 makes it a real King's Indian: White's pawns take c4, d4 and e4. Develop the king's knight with a hit on e4.", "r:e4"],
    5: ["5.Bd3 guards e4 with the bishop instead of a knight on c3. Castle.", "y:g7"],
    6: ["6.O-O. Bring the queen's knight out where it hits d4. If White pushes past it, the knight has a square that attacks the d3 bishop.", "r:d4 r:d3"],
    7: ["7.d5 kicks the knight. Don't go back: there's a square where it attacks the d3 bishop.", "r:d3"],
    8: ["8.Nc3 leaves the bishop to its fate. Take it: you get the bishop pair.", "r:d3"],
    9: ["9.Qxd3. Strike at the centre with two steps of the e-pawn. If White takes it en passant, your c8 bishop takes back and comes into play.", "y:e5 r:d5"],
    10: ["10.dxe6 took en passant. Take back with the bishop: it develops and eyes the c4 pawn.", "r:c4"],
  },
  "Pirc Defense: Bc4 and Ng5, ...O-O and the fork trick": {
    1: PIRC_1,
    2: PIRC_NC3,
    3: ["3.Bc4 aims at f7. Fianchetto as usual: your bishop and castling will cover f7.", "y:c4f7"],
    4: pircBg7(4, "Nf3"),
    5: ["5.Ng5 hits f7 with knight and bishop. Castle: the rook guards f7, and the knight on g5 is offside.", "r:f7 r:g5"],
    6: ["6.d4. Ask the g5 knight to leave with the h-pawn: it has to go back.", "r:g5"],
    7: ["7.Nf3 went back: White has spent two moves on the knight. Now the fork trick: only the c3 knight guards e4, and nothing guards the c4 bishop. Take on e4.", "r:e4 r:c4"],
    8: ["8.Nxe4. One step of the d-pawn forks the c4 bishop and the e4 knight.", "r:c4 r:e4"],
    9: ["9.Bd3. Take the knight: material is level and White's e-pawn is gone.", "r:e4"],
    10: ["10.Bxe4. Hit White's last centre pawn with the c-pawn, backed by the g7 bishop.", "r:d4 y:g7d4"],
  },
  // ---- King's Indian setup against 1.e4 and 1.d4 sidelines (punishing White) ----
  "Pirc Defense: quiet Bg5, 9.Bg4? Nxg4": {
    1: PIRC_1,
    2: PIRC_NF3,
    3: pircG6(3, "Nc3", "guards e4."),
    4: ["4.Be2. Bishop to the long diagonal.", "y:g7a1"],
    5: ["5.d3 keeps things quiet. Castle.", "y:g7"],
    6: ["6.O-O. Develop the queen's knight behind your pawns: it supports a later ...e5 or ...c5.", "y:e5 y:c5"],
    7: ["7.Bg5 eyes your f6 knight. Put the d7 knight on the central square it was supporting: if White trades it, your d-pawn takes back toward the centre.", "y:e5"],
    8: ["8.Nxe5 trades. Take back with the d-pawn: it opens the d-file for your queen.", "y:d8d1"],
    9: ["9.Bg4? wants to trade off the light bishops, but nothing guards g4. Your f6 knight can take it.", "r:g4"],
    10: ["10.h3 attacks the knight. Hit back first: the h-pawn attacks the g5 bishop, so White can't take your knight and keep the bishop.", "r:g5"],
    11: ["11.Bd2 saves the bishop. Bring your knight back home; you're a piece up.", "r:g4"],
  },
  "Pirc Defense: 3.e5?, queens off and ...Ng4": {
    1: PIRC_1,
    2: PIRC_D4,
    3: ["3.e5? pushes too early: nothing backs the pawn up. Take it.", "r:e5"],
    4: ["4.dxe5 attacks your knight. Trade queens first, with check: White's king has to take back and loses the right to castle.", "y:d8d1"],
    5: ["5.Kxd1. Now go forward, not back: there's a knight jump that hits e5, and nothing defends it.", "r:e5"],
    6: ["6.Ke1. Take the pawn.", "r:e5"],
    7: ["7.Nc3 eyes b5, and from there your c7 pawn. Develop the light bishop to a square that covers b5.", "y:b5 r:c7"],
  },
  "Pirc Defense: queens off, 8.h3? Nxe5": {
    ...PIRC_START,
    4: pircBg7(4, "Nf3"),
    5: ["5.e5 hits your knight. Take on e5 first: White has to take back with the pawn or the knight.", "r:e5"],
    6: ["6.dxe5 hits the knight again. First trade queens with check: the c3 knight has to take back and lands on a poor square.", "y:d8d1"],
    7: ["7.Nxd1. Now jump forward: from g4 the knight and the g7 bishop both hit e5, and only the f3 knight guards it.", "r:e5 y:g7e5"],
    8: ["8.h3? kicks the knight but forgets about e5. Take the pawn.", "r:e5"],
    9: ["9.Nxe5 trades. Take back with the bishop: you're a clean pawn up.", "y:g7e5"],
  },
  "Pirc Defense: 3.Bc4?, ...Nxe4": {
    1: PIRC_1,
    2: PIRC_NF3,
    3: ["3.Bc4? develops the bishop but leaves e4 with no defender. Take it.", "r:e4"],
    4: ["4.O-O. Bring the knight back: on e4 it's about to be hit by a rook on e1, and on its old square it guards your king.", "y:f6"],
    5: ["5.Re1 takes the e-file. Fianchetto as usual: you're a pawn up, and all you need is to get castled.", "y:h8a1"],
    6: ["6.d4. Bishop to the long diagonal.", "y:g7d4"],
    7: ["7.h3. Castle: your king is safe and the e7 pawn stays covered.", "y:e7"],
  },
  "Pirc Defense: h3 and Bg5, 9.Nxg5? hxg5": {
    ...PIRC_START,
    4: pircBg7(4, "Nf3"),
    5: ["5.h3 keeps your pieces off g4. Castle.", "y:g4"],
    6: ["6.Bd3. Develop the queen's knight behind your pawns: it supports a later ...e5 or ...c5.", "y:e5 y:c5"],
    7: ["7.Bg5 eyes your f6 knight. Ask the bishop what it wants with the h-pawn.", "r:g5"],
    8: ["8.Bh4 keeps the bishop on your knight. Kick it again with the g-pawn: it has to go, and your king is still well covered.", "r:h4"],
    9: ["9.Nxg5? gives a knight for two pawns and an attack. Take it: White has no follow-up strong enough.", "r:g5"],
    10: ["10.Bxg5 pins your f6 knight again. Hit the centre with the c-pawn: it opens your queen's way to the queenside and gives White something else to think about.", "r:d4"],
    11: ["11.d5 gains space. Put the knight in the centre: it attacks the d3 bishop and covers your kingside.", "r:d3"],
  },
  "Pirc Defense: Be3 and Bc4, the fork trick and 8.Bb3?": {
    ...PIRC_START,
    3: pircG6(3, "Nc3", "guards e4."),
    4: PIRC_BE3,
    5: PIRC_BE3_NF3,
    6: PIRC_BE3_BC4,
    7: PIRC_FORK,
    8: ["8.Bb3? saves the bishop but leaves the e4 knight hanging. Take it: you're a pawn up.", "r:e4"],
    9: ["9.Ng5 goes after your e4 pawn and eyes f7. Develop with a hit on d4: the knight joins the g7 bishop against it.", "r:d4 y:g7d4"],
    10: ["10.c3 props up d4. Hit it again with the e-pawn: the centre opens while White's king is still in the middle.", "r:d4 r:e1"],
    11: ["11.d5 hits your knight. Go to the edge: from there it hits the b3 bishop. If White takes your e4 pawn back, the f-pawn chases the knight.", "r:b3"],
  },
  "Pirc Defense: Bd3 and e5, 8.e6? Bxe6": {
    ...BD3_E5,
    8: ["8.e6? pushes the pawn into your pieces, and nothing supports it. Take it with the bishop.", "r:e6"],
    9: ["9.h3 kicks the knight. Back to f6: it guards your king, and the extra pawn is safe.", "r:g4"],
  },
  // Orthodox 7.O-O Nc6: main lines to know.
  "King's Indian Defense: Mar del Plata, 10.f3 and the ...g5 storm": {
    ...KID_CLASSICAL,
    7: KID_NC6,
    8: ["8.d5 closes the center and hits the c6 knight. In this structure your attack is on the kingside, so the knight doesn't go back to b8: it heads that way, to a square where it will back up ...f5.", "r:d5 r:c6"],
    9: ["9.Ne1 sends the knight to d3 to support c5, White's attack on the queenside. Your break is ...f5, and the f6 knight stands in the f-pawn's way: move it, keeping an eye on e5 and c5.", "y:f7f5"],
    10: ["10.f3 props up e4. Now play the break you prepared: the f-pawn hits e4 and opens the way for your pieces to the kingside.", "y:f7f5 r:e4"],
    11: ["11.Be3 waits for ...fxe4, which would open the f-file for White's rooks too. Go past e4 instead: the pawn gains space, hits the e3 bishop and shuts it out of the kingside.", "y:f5f4 r:e3"],
    12: ["The center is locked, so it's a race: White on the queenside, you on the kingside. Bring the next pawn into the storm; ...g4 comes later to break open f3.", "y:g6g4 r:f3"],
    13: ["13.Nd3 backs up c5. Let it come: your e7 knight does nothing where it is. Bring it to the kingside, toward f4 and h4.", "y:h4 y:f4"],
    14: ["14.c5 opens lines on your queenside. Don't spend moves defending there: the d7 knight goes back to the kingside to support ...g4. Every tempo goes into the attack.", "y:g5g4 r:f3"],
  },
  "King's Indian Defense: Bayonet, 9.b4 Nh5": {
    ...KID_CLASSICAL,
    7: KID_NC6,
    8: ["8.d5 closes the center and hits the c6 knight. Your attack is on the kingside: the knight heads that way, ready to back up ...f5.", "r:d5 r:c6"],
    9: ["9.b4 is the Bayonet: White races on the queenside at once. Here the slow ...Nd7 is too slow. The f6 knight clears the f-pawn's path with a jump to the edge, where it also eyes f4.", "y:f7f5 y:f4"],
    10: ["10.Re1 makes room for the bishop on f1. The break is ready: hit e4 with the f-pawn.", "y:f7f5 r:e4"],
    11: ["11.Ng5 aims at e6, and the h5 knight is loose: Bxh5 would split your pawns. Bring it back toward the center, hitting e4.", "r:h5 r:e4"],
    12: ["12.Bf3 props up e4. Undermine the d5 pawn: ...c6 hits it, and the trade on d5 opens your queenside pieces.", "r:d5"],
  },
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 main line": {
    ...KID_CLASSICAL,
    7: KID_NC6,
    8: ["8.Be3 guards d4 a third time. Hit the bishop with your f6 knight: White has to decide about it now, and the knight on g4 also eyes f2.", "r:e3 r:f2"],
    9: ["9.Bg5 hits your queen. Block with a pawn: it blunts the bishop for good and guards e5.", "r:g5 y:d8g5"],
    10: ["10.Bh4 pins again along the h4-d8 diagonal. Kick it with a pawn: it gains kingside space too.", "r:h4 y:h4d8"],
    11: ["11.Bg3 is safe for now, but your g4 knight is out on a limb (h3 would chase it). Reroute it to h6: from there it backs up ...f5 and can come to f7.", "y:f5 y:f7"],
    12: ["12.d5 hits the c6 knight and closes the center. Same idea as the Mar del Plata: the knight goes toward the kingside, where your attack is.", "r:d5 r:c6"],
    13: ["13.Nd2 lets f3 come and heads for c4. Now the break: the f-pawn hits e4, with the h6 knight behind it.", "y:f7f5 r:e4"],
  },
  // Orthodox: natural moves that lose something.
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 9.Qd2?": {
    ...KID_CLASSICAL,
    7: KID_NC6,
    8: ["8.Be3 guards d4 a third time. Hit the bishop with your f6 knight: White has to decide about it now, and the knight on g4 also eyes f2.", "r:e3 r:f2"],
    9: ["9.Qd2? leaves the bishop on e3 for your knight. Take it: White has to take back with the f-pawn, and the bishop pair is yours.", "r:e3"],
    10: ["Now open your g7 bishop: trade on d4. After exd4 the d4 pawn stands alone, hit by the bishop and the c6 knight.", "y:g7d4 r:d4"],
    11: ["d4 is hit twice (the g7 bishop, the c6 knight) and held by the f3 knight and the queen. Go after a defender: the f3 knight.", "y:g7d4 r:d4 r:f3"],
  },
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 9.Bc1?": {
    ...KID_CLASSICAL,
    7: KID_NC6,
    8: ["8.Be3 guards d4 a third time. Hit the bishop with your f6 knight: White has to decide about it now, and the knight on g4 also eyes f2.", "r:e3 r:f2"],
    9: ["9.Bc1? retreats: the bishop no longer covers d4 or the diagonal to g1. With your f6 knight gone, a trade on d4 opens the g7 bishop's diagonal.", "y:g7d4 r:f2"],
    10: ["Look along the diagonal from d4 to g1: once the d4 knight goes, your bishop lands there aimed straight at the king. Take on f2 first: after ...Nxf2 Rxf2, the rook stands on that diagonal too.", "y:g7d4 y:d4g1 r:f2"],
    11: ["The shot: take the d4 knight with the bishop. It wins the piece back and pins the f2 rook to the king.", "y:g7d4 y:d4g1 r:f2"],
    12: ["12.Qe1 holds the pinned rook. You're a pawn up: hit e4 with the f-pawn and open the f-file toward f2.", "y:f7f5 r:e4 r:f2"],
  },
  "King's Indian Defense: Orthodox, 8.Bg5 and 10.Bg3?": {
    ...KID_CLASSICAL,
    7: ["The Classical main line. Develop the queen's knight to c6: it adds pressure on d4.", "r:d4"],
    8: ["8.Bg5 pins the f6 knight to the queen. Ask the bishop right away.", "r:g5 y:g5d8"],
    9: ["9.Bh4 keeps the pin. Break it for good with a pawn: it gains space too.", "r:h4 y:h4d8"],
    10: ["10.Bg3? looks natural, but now only the c3 knight guards e4. Trade on d4 first: then a knight capture on e4 also uncovers the g7 bishop.", "r:e4 y:g7d4"],
    11: ["Now take on e4: the f6 knight leaves, and the g7 bishop hits the d4 knight. If White takes back, ...Nxe4 Nxe4 Bxd4 leaves you a pawn up.", "r:e4 r:d4 y:g7d4"],
    12: ["12.Nxc6 hits your queen, but first take the c3 knight: your knight hits the queen and the e2 bishop, so White has to take back.", "r:c3 r:d8"],
    13: ["Now take back on c6. You're a pawn up, White's queenside pawns are split, and the g7 bishop looks straight at c3.", "y:g7c3 r:c3"],
  },
  "King's Indian Defense: Gligoric, 7.Be3 Ng4 8.Bd2?": {
    ...KID_CLASSICAL,
    6: ["The classical setup. Strike the center with the e-pawn: it hits d4 and opens the d8-h4 diagonal for your queen.", "r:d4 y:d8h4"],
    7: ["7.Be3 skips castling. Hit the bishop with your f6 knight.", "r:e3 r:f2"],
    8: ["8.Bd2? backs off and lets the knight stay. With the f6 knight gone, a trade on d4 opens the long diagonal.", "y:g7d4 r:d4"],
    9: ["The d4 knight has only the queen behind it, and the e2 bishop hits your g4 knight. Take on d4 anyway: if Bxg4, a queen move hits two things at once.", "y:g7d4 r:d4 r:g4"],
    10: ["Count what's loose: the g4 bishop has no defender, and your d4 bishop already hits f2. One queen move attacks both.", "y:d8h4 r:g4 r:f2"],
    11: ["11.O-O covers f2. Collect the bishop: you're a piece up.", "r:g4"],
  },
  // 7...exd4 8.Nxd4 Re8: only f3 or Bf3 keeps e4.
  "King's Indian Defense: Classical, ...exd4 and ...d5": {
    ...KID_CLASSICAL,
    7: KID_EXD4,
    8: ["After the trade on d4, e4 is White's soft spot, and as soon as your f6 knight moves, the g7 bishop hits the d4 knight. Put a rook on the e-file to hit e4.", "y:g7d4 y:e8e4 r:e4"],
    9: ["9.f3 holds e4 with a pawn, the sound answer. Get ready for the central break ...d5: support it with the c-pawn first, which also keeps White's pieces off d5.", "y:d6d5 y:c6"],
    10: ["10.Kh1 steps off the g1-a7 diagonal. Now break: ...d5 hits c4 and e4 at once.", "y:d6d5 r:c4 r:e4"],
    11: ["Take back with the pawn: you get a strong d5 pawn and the open c-file, and White's e4 pawn is gone.", "y:c8c1 r:d4"],
  },
  "King's Indian Defense: Classical, ...exd4 9.Qc2?": {
    ...KID_CLASSICAL,
    7: KID_EXD4,
    8: ["After the trade on d4, e4 is White's soft spot, and as soon as your f6 knight moves, the g7 bishop hits the d4 knight. Put a rook on the e-file to hit e4.", "y:g7d4 y:e8e4 r:e4"],
    9: ["9.Qc2? looks like it guards e4, but the queen left d1, and now nothing guards the d4 knight. Count: take on e4, and if Nxe4, the g7 bishop takes d4.", "r:e4 r:d4 y:g7d4"],
    10: ["The knight on d4 is loose: take it with the bishop. You've won the e4 pawn, and your rook keeps the e4 knight in its sights.", "y:g7d4 r:d4 y:e8e4"],
    11: ["11.Bg5 hits your queen. Block with the f-pawn: it also takes g5 and e5 from the e4 knight.", "r:g5 y:d8g5"],
    12: ["Pin the e4 knight to the c2 queen with your light-squared bishop. You stay a pawn up with active pieces.", "r:e4 r:c2"],
  },
  "King's Indian Defense: Classical, ...exd4 9.Bf4?": {
    ...KID_CLASSICAL,
    7: KID_EXD4,
    8: ["After the trade on d4, e4 is White's soft spot, and as soon as your f6 knight moves, the g7 bishop hits the d4 knight. Put a rook on the e-file to hit e4.", "y:g7d4 y:e8e4 r:e4"],
    9: ["9.Bf4? develops, but it leaves e4 guarded only by the c3 knight, and you have the e8 rook behind it. Take e4.", "r:e4 y:e8e4"],
    10: ["Take back with the rook. From e4 it hits the f4 bishop and the d4 knight, and the g7 bishop hits d4 too.", "r:f4 r:d4 y:g7d4"],
    11: ["11.Be3 covers d4. You're a clean pawn up: bring the queen to the e-file behind the rook, hitting e3 and e2.", "y:e8e3 r:e3"],
  },
  // Glek, 7...Na6.
  "King's Indian Defense: Glek, 8.Be3 Ng4": {
    ...KID_CLASSICAL,
    7: ["The Glek: the queen's knight goes to a6, not c6. It doesn't block the c-pawn, and after d5 it comes to c5 to hit e4.", "y:c5 r:e4"],
    8: ["8.Be3 again: hit the bishop with your f6 knight, as in the Orthodox. White can't keep the bishop on e3 without giving something.", "r:e3"],
    9: ["9.Bg5 hits your queen. Step out of the pin to e8: from there the queen still guards e5 and doesn't block the f-pawn.", "r:g5 y:d8g5"],
    10: ["10.dxe5 opens the d-file. Take back with the pawn: e5 is your strong point, and d4 becomes a square for your pieces.", "r:e5 y:d4"],
    11: ["11.h3 hits the g4 knight. Before it moves, kick the g5 bishop: if White then takes on g4, you take on g5, and White has gained nothing.", "r:g5 r:g4"],
    12: ["12.Bd2 drops back. The knight goes back to f6, hitting e4. It's about equal, with the structure you want: the e5 pawn, the g7 bishop behind it, and ...Nc5 to come.", "r:e4 y:c5"],
  },
  "King's Indian Defense: Glek, 8.d5 Nc5": {
    ...KID_CLASSICAL,
    7: ["The Glek: the queen's knight goes to a6, not c6. It doesn't block the c-pawn, and after d5 it comes to c5 to hit e4.", "y:c5 r:e4"],
    8: ["8.d5 closes the center: this is why the knight went to a6. Jump to c5, hitting e4.", "y:c5 r:e4"],
    9: ["9.Qc2 holds e4. Make the c5 knight permanent: a pawn move stops b4 from kicking it.", "y:c5 r:b4"],
    10: ["10.Bg5 pins the f6 knight. Ask the bishop.", "r:g5 y:g5d8"],
    11: ["11.Be3 hits the c5 knight. Back it up with a pawn: the knight stays on c5 for good, and your queenside is safe.", "y:c5 r:e3"],
  },
  "King's Indian Defense: Glek, queens off and 11.Nd5?": {
    ...KID_CLASSICAL,
    7: ["The Glek: the queen's knight goes to a6, not c6. It doesn't block the c-pawn, and after d5 it comes to c5 to hit e4.", "y:c5 r:e4"],
    8: ["8.dxe5 heads for a queen trade. Take back with the pawn.", "r:e5"],
    9: ["Take back with the rook: it takes the d-file.", "r:d8"],
    10: ["10.Bg5 pins the f6 knight to your d8 rook. Move the rook to e8: it guards e5 and the pin is gone.", "r:g5 y:g5d8"],
    11: ["11.Nd5? hits f6 a second time, but it left e4 with no defender. Take it: Ne7+ only trades the knight for your c8 bishop.", "r:e4"],
    12: ["12.Ne7+. Step aside: the knight has to take on c8 or go back.", "r:e7"],
    13: ["Take back on c8. You've won the e4 pawn, and the e4 knight hits the g5 bishop.", "r:g5"],
    14: ["14.Be3. Back up the e4 knight with the f-pawn. You're a pawn up, and the e5 pawn and g7 bishop hold the center.", "r:e4 y:g7e5"],
  },
  // Four Pawns.
  "King's Indian Defense: Four Pawns, 10.e5 main line": {
    ...KID_FOUR_PAWNS,
    8: ["Against the Four Pawns, open lines before White's pawns roll. Trade on d5: you get the e-file and a target on d5.", "r:d5"],
    9: ["9.cxd5 gives you the Benoni structure. Put a rook on the e-file: it stops e5 for now and lines up on e4 with the e2 bishop behind it.", "y:e8e2 r:e4"],
    10: ["10.e5 is the sharp main line. Take: White's center comes forward but goes loose.", "r:e5"],
    11: ["11.fxe5. The e5 pawn is the target, and your rook already hits it. Add the f6 knight from a square where its move also uncovers the g7 bishop.", "r:e5 y:g7e5 y:e8e5"],
    12: ["12.Bg5 hits your queen. Bring it to b6, where it hits b2 and stands on the diagonal to g1.", "r:g5 y:b6g1 r:b2"],
    13: ["13.O-O. Now take e5.", "r:e5"],
    14: ["Take back with the bishop: it sits on e5, aimed at c3 and h2.", "y:e5c3 y:e5h2"],
  },
  "King's Indian Defense: Four Pawns, early 9.e5? and 10.Nxd5": {
    ...KID_FOUR_PAWNS,
    8: FP_EXD5,
    9: ["9.e5? comes before cxd5, so the d5 pawn is still yours. Don't retreat: jump into e4 with the knight, hitting c3.", "y:e4 r:c3"],
    10: ["10.Nxd5 takes the pawn back, but the d5 knight is on its own. Develop with tempo: a knight that hits e5 and d4.", "r:e5 r:d4"],
    11: ["11.Bd3 hits your e4 knight. Back it up with the f-pawn rather than retreat.", "r:e4 y:f7f5"],
    12: ["Open the center: take on e5. With the pawns gone, the g7 bishop's diagonal opens.", "r:e5 y:g7e5"],
    13: ["The e5 pawn is weak and your g7 bishop sees it. Develop the light bishop to e6, hitting the d5 knight.", "r:d5 r:e5"],
  },
  "King's Indian Defense: Four Pawns, early 9.e5? and 10.cxd5": {
    ...KID_FOUR_PAWNS,
    8: FP_EXD5,
    9: ["9.e5? comes before cxd5, so the d5 pawn is still yours. Don't retreat: jump into e4 with the knight, hitting c3.", "y:e4 r:c3"],
    10: ["10.cxd5. Take the c3 knight: White's pawns end up broken, and once e5 falls the g7 bishop hits c3.", "r:c3"],
    11: ["11.bxc3. Hit e5: it's already attacked by the d6 pawn, and the knight from d7 adds another.", "r:e5"],
    12: ["12.e6 gives a pawn to make a mess. Take it with the f-pawn.", "r:e6"],
    13: ["13.dxe6. Knight back to f6: your king is safe, and the e6 pawn is weak.", "r:e6"],
  },
  // London.
  "London System: King's Indian, 7.c4 Nh5": {
    ...LON_KID,
    5: ["Against the London, keep the King's Indian shape: the d-pawn first, then ...e5, which will also hit the f4 bishop.", "r:f4 y:e5"],
    6: ["6.O-O. The knight goes to d7 to back up ...e5.", "y:e5"],
    7: ["7.c4. The f4 bishop is the London's best piece: go after it with the knight from h5.", "r:f4"],
    8: ["8.Bg5 dodges. Kick it with a pawn: it's running out of squares.", "r:g5"],
    9: ["9.Bh4. Again: the g-pawn kicks it, and on g3 it's in range of your h5 knight.", "r:h4 y:g3"],
    10: ["10.Bg3. Take the bishop: you get the bishop pair, and your g7 bishop has no rival on the dark squares.", "r:g3 y:g7d4"],
  },
  // ---- King's Indian (Black): main lines ----
  "King's Indian Defense: Mar del Plata, ...Ne7 and ...f5": {
    ...KID_CLASSICAL,
    7: KID_NC6,
    8: ["8.d5 closes the centre and hits the c6 knight. Retreat it toward the kingside, where your play will be, on a square that doesn't block the f-pawn's path.", "r:d5 y:f7f5"],
    9: ["9.Ne1 heads for d3, to support c5 on the queenside. Clear the way for your f-pawn: the f6 knight steps back.", "y:f7f5"],
    10: ["10.Nd3. Now the break: the f-pawn hits e4 and starts your kingside play.", "r:e4"],
  },
  "King's Indian Defense: Exchange, queens off": {
    ...KID_CLASSICAL,
    7: ["7.dxe5 opens the d-file. Take back with the pawn: it keeps a pawn on e5, so White's pieces can't use the square.", "r:e5"],
    8: ["8.Qxd8 trades queens. Take back with the rook: it lands on the open d-file.", "y:d1d8"],
    9: ["9.Bg5 pins your f6 knight to the d8 rook, and Nd5 next would hit it again. Step the rook off the pin, onto a file where it also guards e5.", "y:g5d8 r:e5"],
  },
  "King's Indian Defense: Petrosian, d5 and Bg5": {
    ...KID_CLASSICAL,
    7: ["7.d5, the Petrosian: White closes the centre before castling. Stop b4 first with the a-pawn: it slows White's queenside play and makes c5 a safe square for your knight.", "y:b4 y:c5"],
    8: ["8.Bg5 pins the f6 knight. Ask the bishop with the h-pawn: it has to give up the pin or keep it from h4.", "r:g5"],
    9: ["9.Bh4 keeps the pin. Develop the queen's knight toward c5, the square the a-pawn made safe.", "y:c5"],
  },
  "King's Indian Defense: Sämisch, ...c5 gambit": {
    1: KID_1,
    2: KID_C4,
    3: KID_NC3,
    4: KID_E4,
    5: kidCastle(5, "f3", "is the Sämisch: the pawn guards e4 and prepares Be3, Qd2 and a kingside pawn storm."),
    6: ["6.Be3. Hit d4 with the c-pawn. It's a gambit: if White takes, you get open lines and fast development for the pawn.", "r:d4"],
    7: ["7.dxc5. Take back with the d-pawn: the d-file opens and the queens face each other.", "y:d1d8"],
    8: ["8.Qxd8. Take back with the rook: it owns the open d-file.", "y:d1d8"],
    9: ["9.Bxc5 took the pawn. Develop the queen's knight toward d4; next the f6 knight can go to d7 and hit the c5 bishop.", "y:d4 r:c5"],
  },
  "King's Indian Defense: Four Pawns Attack": {
    ...KID_FOUR_PAWNS,
    8: FP_EXD5,
    9: ["9.cxd5. White hasn't castled yet: your rook belongs on the open e-file, aimed at e4 and the king behind it.", "y:e8e1 r:e4"],
  },
  "King's Indian Defense: Averbakh, Bg5": {
    1: KID_1,
    2: KID_C4,
    3: KID_NC3,
    4: KID_E4,
    5: kidCastle(5, "Be2", "keeps Bg5 in mind."),
    6: [
      "6.Bg5, the Averbakh, makes ...e5 awkward: after ...e5 dxe5 dxe5 Qxd8 Rxd8 Nd5, the knight hits c7 and the pinned f6 knight. Hit d4 with the c-pawn instead.",
      "r:d4 y:d5",
    ],
    7: ["7.d5 grabs space. Ask the g5 bishop with the h-pawn before you open the centre.", "r:g5"],
    8: ["8.Be3 hits c5. Break up White's centre with the e-pawn: after a trade on d5 you get the e-file and a Benoni structure.", "r:d5"],
  },
  "King's Indian Defense: Fianchetto, ...Nbd7 and ...e5": {
    1: KID_1,
    2: KID_C4,
    3: ["3.Nf3. Bishop to the long diagonal, aimed at d4.", "y:g7a1"],
    4: kidCastle(4, "g3", "means White fianchettoes too."),
    5: ["5.Bg2, the Fianchetto Variation. One step of the d-pawn: it covers e5 and prepares ...e5.", "y:e5"],
    6: ["6.O-O. Develop the queen's knight to the square behind e5: it backs up the break and keeps c6 free for the pawn.", "y:e5"],
    7: ["7.Nc3. Everything's ready: hit d4 with the e-pawn.", "r:d4"],
    8: ["8.e4 builds the full centre. Take d5 away from White's knight with the c-pawn; it also opens the d8-a5 diagonal for your queen.", "y:d5 y:d8a5"],
    9: ["9.h3 stops ...Ng4 and prepares Be3. Bring the queen out where it hits d4 and b2 together.", "r:d4 r:b2"],
  },
  "Torre Attack: King's Indian setup": {
    1: KID_1,
    2: ["2.Nf3. Start the fianchetto: one pawn step makes room for the bishop.", "y:h8a1"],
    3: ["3.Bg5, the Torre: the bishop eyes your f6 knight. Bishop to the long diagonal: it backs up the knight and aims at d4.", "y:g7a1"],
    4: kidCastle(4, "Nbd2", "backs up e4."),
    5: ["5.e3. One step of the d-pawn: it prepares ...e5, your break against White's setup.", "y:e5"],
    6: ["6.Be2. Develop the queen's knight to the square behind e5, so the pawn can come.", "y:e5"],
    7: ["7.O-O. Hit the centre with the e-pawn: the d6 pawn and the d7 knight guard it.", "r:d4 y:e5"],
    8: ["8.c3 holds d4. Ask the g5 bishop with the h-pawn: it has to leave the f6 knight alone or go to h4, where ...g5 can chase it later.", "r:g5"],
  },
  "English Opening: Botvinnik setup vs the King's Indian": {
    1: ["1.c4, the English. Your King's Indian setup works here too: start with the king's knight.", "y:e4 y:d5"],
    2: ["2.Nc3. Start the fianchetto: one pawn step makes room for the bishop.", "y:h8a1"],
    3: ["3.g3: White fianchettoes too. Bishop to the long diagonal.", "y:g7a1"],
    4: ["4.Bg2. Castle: your king is safe behind the fianchetto.", "y:g7"],
    5: ["5.e4, the Botvinnik setup: pawns on c4 and e4 grip d5. One step of the d-pawn covers e5 and prepares ...e5.", "y:e5 y:d5"],
    6: ["6.Nge2 keeps the f-pawn free for f4. Claim your share of the centre with the e-pawn: it takes d4 away from White's pieces.", "y:d4"],
    7: ["7.O-O. Take d5 away from White's knight with the c-pawn: that square is the whole point of the Botvinnik setup.", "y:d5"],
  },
  "London System: King's Indian setup, ...Nbd7 and ...e5": {
    ...LON_KID,
    5: ["Against the London, keep the King's Indian shape: the d-pawn first, then ...e5, which will also hit the f4 bishop.", "r:f4 y:e5"],
    6: ["6.O-O. The knight goes to d7 to back up ...e5.", "y:e5"],
    7: [
      "7.h3 gives the f4 bishop a retreat on h2. ...e5 now is too early: after ...e5 dxe5 dxe5 Nxe5 Nxe5 Bxe5 White wins a pawn, because e5 has two attackers (knight and bishop) and only the d7 knight defends it, and your queen faces White's on the open d-file. Move the queen off the d-file to the square behind the e-pawn: from there it guards e5.",
      "r:e5 y:f3e5 y:f4e5 y:e8e5",
    ],
    8: [
      "8.Bh2. Now ...e5 works: with the queen behind it, e5 has two defenders. If White grabs it, ...e5 dxe5 dxe5 Nxe5 Nxe5 Bxe5 Qxe5 leaves you a piece up.",
      "r:e5 y:e8e5",
    ],
  },
  "London System: King's Indian, ...Qb6 and ...Be6": {
    ...LON_KID,
    5: ["Against the London, keep the King's Indian shape: the d-pawn first, then ...e5, which will also hit the f4 bishop.", "r:f4 y:e5"],
    6: ["6.h3 is slow. Hit d4 with the c-pawn: d4 is what the g7 bishop is aimed at.", "y:g7d4 r:d4"],
    7: ["7.c3. With the bishop gone to f4, nothing guards b2: your queen can hit b2 and d4 at once.", "r:b2 r:d4"],
    8: ["8.Qb3 offers a queen trade. Don't take on b3 (that opens the a-file for White's rook): develop the bishop with tempo on the queen instead.", "r:b3"],
    9: ["9.Qxb6. Take back with the a-pawn: your rook gets the open a-file against a2. The position is equal and easy to play.", "y:a8a2 r:a2"],
  },
  // London System (White): main lines.
  "London System: Classical, ...e6 and ...Bd6": {
    1: LW_1,
    2: LW_BF4,
    3: lwPyramid(2, "Nf6"),
    4: LW_E6,
    5: lwBd6(4),
    6: lwCastled(5),
    7: lwC5(6),
    8: ["7...Nc6 piles on d4, but your pyramid holds it. Develop the queen's knight behind the pawns, where it backs up e4.", "y:e4"],
  },
  "London System: ...c5 and ...Qb6": {
    1: LW_1,
    2: LW_BF4,
    3: ["2...c5 hits d4 at once. Build the pyramid: the e-pawn backs up d4 and opens the f1 bishop.", "r:d4"],
    4: ["3...Nc6 adds a second attacker on d4. Support it with the c-pawn: then a pawn takes back on d4.", "r:d4"],
    5: LW_QB6(4),
    6: lwC4(5),
    7: ["6...Nf6. Develop the queen's knight where it backs up e4: with ...c4 Black has handed you the centre, and e4 is your break.", "y:e4"],
  },
  "London System: Mirror, ...Bf5": {
    1: LW_1,
    2: LW_BF4,
    3: lwPyramid(2, "Bf5 copies you"),
    4: LW_E6,
    5: ["4...Nf6. Offer to trade light bishops on d3: your queen takes back and comes out.", "r:f5 y:d3"],
    6: ["5...Bxd3. Take back with the queen.", "r:d3"],
    7: lwC5(6),
    8: ["7...Nc6. Develop the queen's knight where it backs up e4: with your queen on d3, e4 is your break in this line.", "y:e4"],
  },
  "London System: ...c5 and ...cxd4": {
    1: LW_1,
    2: LW_BF4,
    3: lwPyramid(2, "Nf6"),
    4: lwC5(3),
    5: ["4...Nc6. Develop the queen's knight behind the pawns, where it backs up e4: c3 is already taken by the pawn.", "y:e4"],
    6: ["5...cxd4. Take back with the e-pawn: it keeps c3 in place, half-opens the e-file and gives you the e5 square.", "y:e5"],
  },
  "London System: ...c6 and the ...Bg4 pin": {
    1: LW_1,
    2: LW_BF4,
    3: lwPyramid(2, "Nf6"),
    4: ["3...c6 is a Slav setup: solid, and the c8 bishop wants out before ...e6. Develop the king's knight: it covers e5 and backs up d4.", "y:e5 y:d4"],
    5: ["4...Bg4 pins the f3 knight, one of d4's guards. Support d4 with the c-pawn, so the pin costs you nothing there.", "r:g4 r:d4"],
    6: ["5...e6. Develop the queen's knight to the square behind f3: it backs up the pinned knight and e4.", "y:f3 y:e4"],
    7: ["6...Nbd7. Ask the g4 bishop with the h-pawn: it has to give up the pin or go to h5, where g4 can chase it later.", "r:g4"],
  },
  "London System: Grünfeld setup, ...g6": {
    1: LW_1,
    2: LW_BF4,
    3: lwPyramid(2, "Nf6"),
    4: ["3...g6 heads for a Grünfeld setup: the bishop will aim down the long diagonal at d4 and b2. Develop the king's knight, which also backs up d4.", "y:h8a1 y:d4"],
    5: ["4...Bg7. Get ready to castle: develop the light bishop to a quiet square.", "y:e2"],
    6: ["5...O-O. Castle too: your king is safe, and the middlegame starts.", "y:g1"],
    7: ["6...c5 hits d4, and the g7 bishop is aimed at it too. Support it with the c-pawn, which also blunts the long diagonal.", "r:d4 y:g7b2"],
  },
  "London System: ...Nh5 hunting the bishop": {
    1: LW_1,
    2: LW_BF4,
    3: lwPyramid(2, "Nf6"),
    4: ["3...c5 hits d4. Develop the king's knight: it backs up d4 and covers e5.", "r:d4 y:e5"],
    5: ["4...Nc6 adds a second attacker on d4. Develop the queen's knight behind the pawns: it backs up the f3 knight and e4.", "y:e4"],
    6: ["5...cxd4. Take back with the e-pawn: the e-file half-opens and the e5 square is yours.", "y:e5"],
    7: [
      "6...Nh5 hunts your f4 bishop, which lost its e3 support when the e-pawn took on d4. Keep the bishop: it has a safe square on the c1-h6 diagonal, next to d4.",
      "r:h5 r:f4 y:c1h6",
    ],
  },
  "London System: Chigorin setup, ...Nc6 and ...Bf5": {
    1: LW_1,
    2: LW_BF4,
    3: ["2...Nc6, the Chigorin setup: the knight aims at d4 and blocks Black's own c-pawn. Build the pyramid: the e-pawn backs up d4.", "y:d4"],
    4: ["3...Bf5. Support d4 with the c-pawn too: it also takes b4 away from the c6 knight.", "r:d4 y:b4"],
    5: ["4...e6. Develop the queen's knight to the square behind e4: the king's knight can still come to f3.", "y:e4"],
    6: ["5...Nf6. Now the king's knight: it guards e5, the square Black's ...e5 break needs.", "y:e5"],
  },
  "London System: King's Indian setup": {
    1: LW_1,
    2: LW_BF4,
    3: ["2...g6 heads for a King's Indian. Build the pyramid: the e-pawn backs up d4 and opens the f1 bishop.", "y:d4"],
    4: ["3...Bg7 aims at d4 and b2. Develop the king's knight, which also covers e5.", "y:g7b2 y:e5"],
    5: ["4...O-O. Develop the light bishop modestly: on d3 it would be hit by ...e5-e4.", "y:d3"],
    6: ["5...d6 prepares ...e5, which will hit your f4 bishop. Make it a retreat square first.", "r:f4 y:h2"],
    7: ["6...c5 hits d4, and the g7 bishop backs it up. Support it with the c-pawn, which also blunts the long diagonal.", "r:d4 y:g7b2"],
  },
  "London System: ...d5, ...c5 and ...Qb6": {
    1: LW_1,
    2: LW_BF4,
    3: lwPyramid(2, "d5"),
    4: lwC5(3),
    5: ["4...Nc6. Develop the queen's knight to the square behind e4: c3 is already taken by the pawn.", "y:e4"],
    6: LW_QB6(5),
    7: lwC4(6),
  },
  "London System: Queen's Indian setup, ...b6": {
    1: LW_1,
    2: LW_BF4,
    3: lwPyramid(2, "e6"),
    4: ["3...b6 heads for b7, aimed at e4. Develop the king's knight, which also covers e5.", "y:a8h1 y:e5"],
    5: lwHome(4, "Bb7"),
    6: ["5...Be7. Develop the light bishop to its best diagonal, aimed at h7: it also guards e4, the square Black's b7 bishop and f6 knight want.", "y:d3h7 r:e4"],
    7: lwC5(6),
  },
  "London System: Early ...c5 and ...Qb6": {
    1: LW_1,
    2: LW_BF4,
    3: ["2...c5 hits d4 at once. Hold the centre with the e-pawn: it backs up d4 and opens the f1 bishop.", "r:d4"],
    4: [
      "3...Qb6 hits b2, which your bishop no longer guards. Don't spend a move defending it: develop the queen's knight. If the queen takes b2 it's far from home, and a rook on b1 chases it while you develop.",
      "r:b2",
    ],
  },
  "London System: Old Indian, ...d6 and ...e5": {
    1: LW_1,
    2: LW_BF4,
    3: ["2...d6 prepares ...e5, which would hit your bishop. Build the pyramid: the e-pawn backs up d4 and opens the f1 bishop.", "y:d4 y:e5"],
    4: ["3...Nbd7 backs up ...e5. Develop the king's knight: it adds a guard on e5, the square Black is fighting for.", "y:e5"],
    5: lwHome(4, "g6"),
    6: ["5...Bg7. Develop the light bishop modestly: on d3 it would be hit by ...e5-e4.", "y:d3"],
    7: ["6...O-O. Castle too: your king is safe before Black's ...e5 opens the centre.", "y:e5"],
    8: [
      "7...e5 hits d4 and your f4 bishop. Count the attackers on e5 after a trade there: your knight and bishop against Black's d7 knight. The g7 bishop doesn't count: the f6 knight blocks it.",
      "r:e5 y:g7e5",
    ],
    9: ["8...dxe5. Only the d7 knight guards e5. Take the pawn.", "r:e5"],
  },
  "London System: Dutch, ...f5": {
    1: LW_1,
    2: ["1...f5, the Dutch: Black grabs e4 with a pawn. The London setup works here too: bring the dark-squared bishop out before e3 shuts it in.", "y:c1h6 y:e4"],
    3: lwPyramid(2, "Nf6"),
    4: LW_E6,
    5: lwHome(4, "b6 heads for b7, aimed at e4"),
    6: ["5...Bb7. Develop the light bishop to the diagonal through e4: it contests the square Black's whole setup is built around, and eyes f5.", "y:d3h7 r:e4"],
  },
  "Englund Gambit": {
    1: LW_1,
    2: ["1...e5, the Englund Gambit: Black gives a pawn. Take it: it's free, and Black will struggle to win it back.", "r:e5"],
    3: ["2...Nc6 hits e5. Defend it with the king's knight, which also develops.", "r:e5"],
    4: ["3...Qe7 hits e5 a second time. Add the dark-squared bishop: it guards e5 and develops.", "r:e5 y:c1h6"],
    5: ["4...Qb4+ checks, and hits b2 down the b-file and your f4 bishop along the fourth rank. Block the check with the bishop, which also gets it out of the attack.", "r:b2 r:f4"],
    6: [
      "5...Qxb2 eyes your a1 rook. Shutting the queen out with the bishop on c3 looks natural but loses: ...Bb4 pins it, and the queen gets to c1. Cover c3 and develop with the queen's knight instead.",
      "r:a1 y:c3",
    ],
    7: ["6...Bb4 pins the c3 knight. Chase the queen with the rook: it hits b2 and gets off a1.", "r:b2"],
    8: ["7...Qa3. Jump into d5: the knight hits the b4 bishop and threatens to take on c7 with check, forking king and rook.", "r:b4 r:c7"],
  },
  "Old Benoni, ...c5": {
    1: LW_1,
    2: ["1...c5, the Old Benoni, hits d4. Push past it: on d5 the pawn gains space and cramps Black's knights.", "r:c5 y:d5"],
    3: ["2...e5 closes the centre. Build the chain: the e-pawn takes the other central square and backs up d5.", "y:d5"],
  },
  // London System: punishing Black (White).
  "London System: ...Bd6 and ...Nbd7?, Nxf7": {
    ...lwStart("Bf5 copies you"),
    4: LW_E6,
    5: ["4...Nf6. Offer to trade light bishops on d3: your queen takes back and comes out.", "r:f5 y:d3"],
    6: ["5...Bxd3. Take back with the queen.", "r:d3"],
    7: ["6...c6. Develop the queen's knight behind your pawns, where it backs up e4; the c-pawn stays free to back up d4.", "y:e5"],
    8: ["7...Bd6 offers to trade your London bishop. Put the f3 knight on e5 first: it hits f7 and d7, and it stands between your f4 bishop and the d6 bishop.", "y:f4d6 r:f7"],
    9: ["8...Nbd7? blocks Black's queen from guarding d6. Your e5 knight is all that stands between the f4 bishop and d6: move it with a capture.", "r:d6 y:f4d6 y:d8d6"],
    10: ["9...Kxf7. Now take the d6 bishop: nothing can take back.", "r:d6"],
  },
  "London System: Queen's Indian, ...Nbd7? and Nxf7": {
    1: LW_1,
    2: LW_BF4,
    3: ["2...e6. Build the pyramid: the e-pawn backs up d4 and opens the f1 bishop.", "y:d4"],
    4: ["3...b6 heads for b7, aimed at e4. Develop the king's knight, which also covers e5.", "y:a8h1 y:e5"],
    5: ["4...Bb7. Make a home for your f4 bishop first: without one, a black knight on h5 could take it.", "y:h5 r:f4"],
    6: ["5...d5. Develop the light bishop to its best diagonal, aimed at h7.", "y:d3h7"],
    7: ["6...c5 hits d4. Support it with the c-pawn and keep the pyramid whole.", "r:d4"],
    8: ["7...Bd6 offers to trade your London bishop. Put the f3 knight on e5 first: it hits f7 and d7, and it stands between your f4 bishop and the d6 bishop.", "y:f4d6 r:f7"],
    9: ["8...c4 hits your d3 bishop. Keep it on the b1-h7 diagonal.", "r:d3 y:b1h7"],
    10: ["9...Nbd7? blocks Black's queen from guarding d6. Your e5 knight is all that stands between the f4 bishop and d6: move it with a capture.", "r:d6 y:f4d6 y:d8d6"],
    11: ["10...Kxf7. Now take the d6 bishop: nothing can take back.", "r:d6"],
  },
  "London System: hxg3, ...Nxe5? and Bxh7+": {
    ...lwStart("Nf6"),
    5: lwBd6(4),
    6: lwCastled(5),
    7: ["6...Nc6. Develop the queen's knight to a square that backs up e4 and e5.", "y:e4 y:e5"],
    8: lwBxg3(7),
    9: ["8...Re8 gets ready for ...e5. Jump into e5 first: the knight blocks the e-pawn and eyes f7.", "y:e5 r:f7"],
    10: ["9...Nxe5? Take back with the pawn: it hits the f6 knight, the piece that guards h7.", "r:f6 r:h7"],
    11: ["10...Nd7. With the f6 knight gone, only the king guards h7, and your rook stands behind it on the h-file. Take with check.", "r:h7 y:h1h7"],
    12: ["11...Kf8. Bring the queen to the h-file: the h7 bishop is safe, and queen, rook and bishop all aim at Black's king.", "y:h1h8 r:f8"],
  },
  "London System: hxg3, ...Nxd2? and Bxh7+": {
    ...lwStart("Nf6"),
    4: LW_NC6,
    5: ["4...e6. Build the pyramid with the c-pawn: it backs up d4.", "y:d4"],
    6: lwBd6(5),
    7: lwCastled(6),
    8: lwBxg3(7),
    9: ["8...Ne4 sits on a strong square, hitting g3 and f2. Challenge it with the queen's knight.", "y:e4"],
    10: ["9...Nxd2? took the knight, but the e4 knight was what blocked your d3 bishop from h7. Before taking back, take on h7 with check: your rook is behind it on h1.", "r:h7 y:h1h7 y:d3h7"],
    11: ["10...Kh8. Now take back on d2. The h7 bishop is safe, guarded by the rook, and Black's king sits in line for a discovered check.", "y:h1h8 r:d2"],
  },
  "London System: hxg3, g4-g5 and ...hxg5?": {
    ...lwStart("Nf6"),
    5: lwBd6(4),
    6: lwBxg3(5),
    7: lwCastled(6),
    8: ["7...Nbd7. The f6 knight is h7's best defender. Push the g-pawn at it: from g5 it would kick the knight away.", "r:f6 y:g5"],
    9: ["8...h6 guards g5, but your g-pawn is backed by the f3 knight. Push it anyway: if Black takes, the h-file opens wider.", "r:h6 y:h1h8"],
    10: ["9...hxg5? opens the h-file. Take back with the knight: it eyes h7 and e6, and your rook, bishop and queen all point at Black's king.", "y:h1h8 r:h7"],
  },
  "London System: ...Qb6 and ...c4, 6...Bf5? Qxf5": {
    ...lwStart("Nf6"),
    4: LW_C5,
    5: ["4...Qb6 hits b2, which your f4 bishop no longer guards. Meet it queen to queen: if Black trades, the a-file opens for your rook.", "r:b2"],
    6: ["5...c4 hits your queen. Keep it on the b1-h7 diagonal, where it still guards b2 along the second rank.", "r:c4 y:b1h7"],
    7: ["6...Bf5? attacks your queen, but nothing guards it: take it. Grabbing b2 back doesn't work for Black: Qxf5 Qxb2 Qc8# is mate, because the b8 knight stops the a8 rook from covering.", "r:f5 y:f5c8"],
    8: ["7...e5 tries to open lines. Take: you're a piece up, and the pawn on e5 hits the f6 knight.", "r:e5 r:f6"],
  },
  "London System: ...Qb6 and ...Qxc5?, Qxb7": {
    ...lwStart("Nf6"),
    4: LW_C5,
    5: ["4...Nc6 adds to d4. Develop the queen's knight where it backs up e4; the c-pawn already holds d4.", "y:e4"],
    6: ["5...Qb6 hits b2. Meet it queen to queen: if Black trades, the a-file opens for your rook.", "r:b2"],
    7: ["6...Bf5. Take on c5: it's the base of Black's pressure, and if the queen takes back, look at b7.", "r:c5 r:b7"],
    8: ["7...Qxc5? left b7 with no defender. Take it: your queen hits the a8 rook and the c6 knight.", "r:b7 r:a8"],
    9: ["8...Rc8 saves the rook. Kick Black's queen with the d2 knight: it can't stay on c5.", "r:c5"],
    10: ["9...Qb6 offers a trade. Take: you're a clean pawn up, and the endgame is easy.", "r:b6"],
  },
  "London System: King's Indian, ...dxe5? and the e5 pawn": {
    1: LW_1,
    2: LW_BF4,
    3: ["2...g6 heads for a King's Indian. Build the pyramid: the e-pawn backs up d4 and opens the f1 bishop.", "y:d4"],
    4: ["3...Bg7 aims at d4 and b2. Develop the king's knight, which also covers e5.", "y:g7b2 y:e5"],
    5: ["4...O-O. Develop the light bishop modestly: on d3 it would be hit by ...e5-e4.", "y:d3"],
    6: ["5...d6 prepares ...e5, which will hit your f4 bishop. Make it a retreat square first.", "r:f4 y:h2"],
    7: ["6...Nc6 backs up ...e5. Castle: your king is safe before Black's break comes.", "y:e5"],
    8: ["7...e5 hits your bishop. It's a fine move (h2 is the quiet retreat), but taking on e5 sets a trap: if Black takes back with the pawn, only the c6 knight guards it, and the queens face each other on the d-file.", "r:e5 y:d1d8"],
    9: ["8...dxe5? is the natural recapture and the mistake (Black had to jump into e4 with the knight first). Only the c6 knight guards e5, and the queens face each other on the d-file. Take the pawn.", "r:e5 y:d1d8"],
    10: ["9...Nxe5. Trade queens before taking the knight: then your bishop lands on e5 with no black queen left to hit it (...Qe7) or to trade on its own terms.", "y:d1d8 r:e5"],
    11: ["10...Rxd8. Now take the e5 knight: you've won a pawn.", "r:e5"],
  },
  "London System: Bb5 and Ne5, ...bxc6? Bxc6+": {
    ...lwStart("Nf6"),
    4: LW_NC6,
    5: ["4...Bf5 copies your setup. Pin the c6 knight: a knight on e5 can then pile up on it.", "r:c6 y:b5e8"],
    6: ["5...e6. Jump into e5: the knight hits c6 a second time, and the pin keeps it there.", "r:c6"],
    7: ["6...Bd6 offers to trade your London bishop. Take on c6 first: Black has to take back, and look at the long diagonal to a8.", "r:c6 y:c6a8"],
    8: ["7...bxc6? opened the diagonal: your b5 bishop takes c6 with check, and the a8 rook is behind it.", "r:c6 y:c6a8"],
    9: ["8...Ke7. Take the rook.", "r:a8"],
  },
  "London System: Mirror, ...c5 Bb5+ and ...a6?": {
    ...lwStart("Bf5 copies you"),
    4: LW_E6,
    5: ["4...c5 hits d4. Check from b5 first: Black has to block, and a piece on d7 gets in the way.", "y:b5e8"],
    6: ["5...Nd7 blocks. Hit d5 with the c-pawn: Black's pieces are tangled, so open the centre.", "r:d5"],
    7: ["6...a6? asks the bishop, but taking on d7 brings Black's queen there, and your knight comes to e5 with tempo.", "r:d7 y:e5"],
    8: ["7...Qxd7. Hit the queen with the f3 knight: from e5 it also eyes f7.", "r:d7 r:f7"],
    9: ["8...Qd8. Check on the a4-e8 diagonal: blocking on d7 runs into mate there (your e5 knight guards it), and ...b5 just drops a pawn, so Black's king has to move.", "y:a4e8"],
    10: ["9...Ke7. Open the centre at Black's king: take on d5.", "r:d5 r:e7"],
  },
  // London System: punishing White. Main lines to know.
  "London System: ...c5 and ...Qb6, 6.Qc2 e5": {
    1: LON_1,
    2: LON_BF4,
    3: LON_E3,
    4: ["4.c3 holds d4 a third time. Now the queen: b2 has no bishop behind it, and from the right square the queen hits b2 and d4 together.", "r:b2 r:d4"],
    5: lonQb3(5),
    6: ["6.Qc2 watches f5, and with d5 unguarded your light bishop can't go there yet. Strike in the centre instead: a pawn offer that hits the f4 bishop and opens the c8 bishop's diagonal.", "r:f4 y:c2h7"],
    7: ["7.dxe5 takes the pawn. Now the bishop comes out with tempo on the c2 queen.", "r:c2 y:c8h3"],
    8: ["8.Qc1 steps back to guard b2. Hit the e5 pawn with the f-pawn: you win it back, or White spends more time holding it.", "r:e5"],
  },
  "London System: ...c5 and ...Qb6, 6.Qxb6 axb6": {
    1: LON_1,
    2: LON_BF4,
    3: LON_E3,
    4: ["4.c3 holds d4 a third time. Now the queen: b2 has no bishop behind it, and from the right square the queen hits b2 and d4 together.", "r:b2 r:d4"],
    5: lonQb3(5),
    6: ["6.Qxb6 trades queens. Take back with the pawn: your rook gets the a-file, aimed at a2.", "y:a8a2 r:a2"],
  },
  "London System: ...c5 and ...Qb6 with Nf3, 7.Qc2 Bf5": {
    1: LON_1,
    2: LON_BF4,
    3: LON_E3,
    4: LON_NF3,
    5: ["5.c3 holds d4. The queen goes after b2, which the f4 bishop no longer guards.", "r:b2"],
    6: lonQb3(6),
    7: ["7.Qc2 watches f5. But your f6 knight guards d5, so the light bishop can go there anyway: if the queen takes it, your queen takes b2 and the a1 rook goes too.", "y:f6d5 r:b2 y:c2h7"],
    8: ["8.Qc1 drops back to guard b2. Shore up d5 with the e-pawn, which also opens the f8 bishop.", "y:d5"],
  },
  "London System: ...c5, 5.Nbd2 cxd4 and ...Bf5": {
    1: LON_1,
    2: LON_BF4,
    3: LON_E3,
    4: LON_NF3,
    5: ["5.Nbd2 skips c3. Trade on d4 first: once the e-pawn takes back, the London bishop loses its e3 support.", "r:d4"],
    6: ["6.exd4. With White's e-pawn gone, your light bishop's diagonal is open: develop it before ...e6 shuts it in.", "y:b1h7"],
  },
  "London System: 3.dxc5 e6 and ...f6": {
    1: LON_1,
    2: LON_BF4,
    3: LON_DXC5,
    4: ["4.e3. Take the pawn back with the bishop: developed, with the pawn regained.", "r:c5"],
    5: ["5.c3 keeps your bishop off b4 and d4. Develop the king's knight where it doesn't block the f-pawn: you want the f-pawn to support a big centre.", "y:f6 y:e5"],
    6: ["6.Nf3 watches e5. Support the e5 square with the f-pawn; then the e-pawn can go forward and hit the f4 bishop.", "y:e5 r:f4"],
  },
  "London System: Jobava-style 4.Nc3 a6": {
    1: LON_1,
    2: LON_BF4,
    3: LON_E3,
    4: ["4.Nc3 is the Jobava setup: Nb5 next would hit c7, where the f4 bishop also aims. Take b5 away from the knight.", "y:b5 r:c7"],
    5: ["5.Nf3. A solid pawn move: it holds d5 and opens the f8 bishop.", "y:d5"],
  },
  // London System: punishing White. Natural moves that lose something.
  "London System: ...c5, 4.Nd2? cxd4 and ...Nxd4": {
    1: LON_1,
    2: LON_BF4,
    3: LON_E3,
    4: ["4.Nd2? looks like normal London development, but the knight stands between the queen and d4. Count the defenders of d4 after a trade there.", "y:d1d4 r:d4"],
    5: ["5.exd4. Now d4 has no defender: the queen can't see through the d2 knight. Take it.", "r:d4 r:d2"],
    6: ["6.Ngf3 hits your knight. Bring it back to its first square; you're a clean pawn up.", "r:d4"],
  },
  "London System: ...c5 and ...Qb6 with Nf3, 8.Qxf5? Qxb2": {
    1: LON_1,
    2: LON_BF4,
    3: LON_E3,
    4: LON_NF3,
    5: ["5.c3 holds d4. The queen goes after b2, which the f4 bishop no longer guards.", "r:b2"],
    6: lonQb3(6),
    7: ["7.Qc2 watches f5. But your f6 knight guards d5, so the light bishop can go there anyway: if the queen takes it, your queen takes b2 and the a1 rook goes too.", "y:f6d5 r:b2 y:c2h7"],
    8: ["8.Qxf5? takes the bishop. Now the point: b2 is unguarded, with the a1 rook and the b1 knight behind it.", "r:b2 r:a1 r:b1"],
  },
  "London System: 3.Nf3 cxd4 4.Nxd4 Nd7 5.e3?": {
    1: LON_1,
    2: LON_BF4,
    3: LON_NF3_3,
    4: ["4.Nxd4. The knight on d4 and the bishop on f4 stand side by side, one pawn push from a fork. Get ready for it with a knight move that guards e5.", "y:e5 r:d4 r:f4"],
    5: ["5.e3? does nothing against your idea: fork the bishop and the knight with the e-pawn.", "r:d4 r:f4"],
    6: ["6.Bg3 saves the bishop. Take the knight.", "r:d4"],
    7: ["7.Qxd4. You're a piece up for a pawn: develop the last knight, and keep your d5 pawn guarded.", "y:d5"],
  },
  "London System: 3.Nf3 cxd4 4.Qxd4 Nc6 5.Qa4 Bd7 6.e3?": {
    1: LON_1,
    2: LON_BF4,
    3: LON_NF3_3,
    4: ["4.Qxd4 takes back with the queen. Develop with tempo: a knight that hits it.", "r:d4"],
    5: ["5.Qa4 pins your c6 knight to the king. Break the pin with the light bishop, which then lines up on the queen behind the knight.", "y:a4e8"],
    6: ["6.e3? lets your e-pawn come with tempo on the f4 bishop. Remember the c6 knight is all that screens your d7 bishop from the a4 queen.", "r:f4 y:d7a4"],
    7: ["7.Bg3. Now move the knight with a threat of its own: it uncovers the d7 bishop on the queen, and from the centre it hits c2 and f3.", "y:d7a4 r:c2 r:f3"],
    8: ["8.Qxd7+ gives the queen for the bishop. Take back.", "r:d7"],
    9: ["9.exd4 takes the knight. Take back with the pawn: queen against two minor pieces.", "r:d4"],
  },
  "London System: 3.c3 Qb6 4.Qc2 cxd4 and 7.Bd3?": {
    1: LON_1,
    2: LON_BF4,
    3: LON_C3,
    4: ["4.Qc2 guards b2 along the second rank. Trade on d4 first, opening the c-file toward the c2 queen.", "y:c8c2"],
    5: ["5.cxd4. Develop the knight, adding to d4.", "r:d4"],
    6: ["6.e3. The queen on c2 shares a diagonal with f5: develop the light bishop there with tempo. If the queen takes it, b2 falls with the a1 rook behind.", "y:c2h7 r:b2"],
    7: ["7.Bd3? offers a trade, but trading on d3 pulls White's queen off the second rank, away from b2.", "y:f5d3 r:b2"],
    8: ["8.Qxd3. b2 is loose, but taking it at once lets White's queen come to c3 and offer a trade. Push the e-pawn first, with tempo on the f4 bishop.", "r:f4 r:b2"],
    9: ["9.Bxe5 takes the pawn. Now take b2: the queen hits the a1 rook and the b1 knight.", "r:b2 r:a1 r:b1"],
  },
  "London System: 3.c3 Qb6 4.b3 and 8.Nd2?": {
    1: LON_1,
    2: LON_BF4,
    3: LON_C3,
    4: ["4.b3 stops the queen taking b2 for good, but it loosens c3 and the a5-e1 diagonal. Trade on d4.", "y:a5e1 r:d4"],
    5: ["5.cxd4. The light bishop comes out before ...e6 shuts it in.", "y:b1h7"],
    6: ["6.e3. Now hold d5 with the e-pawn, which also opens the f8 bishop.", "y:d5"],
    7: ["7.Bd3 offers a bishop trade. Look at the a5-e1 diagonal that b3 opened: a check there makes White block.", "y:a5e1"],
    8: ["8.Nd2? blocks the check but cuts the d1 queen off from the d3 bishop. Take it.", "y:d1d3 r:d3"],
  },
  "London System: 3.dxc5 e6 4.b4? Qf6": {
    1: LON_1,
    2: LON_BF4,
    3: LON_DXC5,
    4: ["4.b4? holds the c5 pawn but takes the b-pawn off the long diagonal. Look at the a1 rook and the f4 bishop: one queen move hits both.", "r:a1 r:f4 y:f6a1"],
    5: ["5.Bxb8 grabs your knight. Take the rook first.", "r:a1"],
    6: ["6.Bg3 saves the bishop. Pick up the a-pawn too; your queen is safe there for now.", "r:a2"],
  },
  "London System: 3.dxc5 e6 and 8.Nxe5?": {
    1: LON_1,
    2: LON_BF4,
    3: LON_DXC5,
    4: ["4.e3. Take the pawn back with the bishop: developed, with the pawn regained.", "r:c5"],
    5: ["5.c3 keeps your bishop off b4 and d4. Develop the king's knight where it doesn't block the f-pawn: you want the f-pawn to support a big centre.", "y:f6 y:e5"],
    6: ["6.Nf3 watches e5. Support the e5 square with the f-pawn; then the e-pawn can go forward and hit the f4 bishop.", "y:e5 r:f4"],
    7: ["7.Bd3. Now the e-pawn goes forward: it hits the f4 bishop, and the f6 pawn guards it.", "r:f4 y:e5"],
    8: ["8.Nxe5? gives the knight for pawns. Take it: the check that follows only wins a second pawn.", "r:e5"],
    9: ["9.Qh5+. Block with the g-pawn.", "r:h5 y:h5e8"],
    10: ["10.Qxe5 hits the h8 rook and the e7 knight. Castle: the rook gets out of the attack onto the open f-file, and your queen still guards e7.", "r:e7 y:f8f2"],
  },
};

/**
 * The note for the student's move when the board shows `ply` plies of `line`, if the line has one:
 * keyed by that move's number.
 */
export function guideAt(line: TrainingLine, ply: number): GuideNote | null {
  const note = GUIDES[line.name]?.[Math.floor(ply / 2) + 1];
  if (!note) return null;
  return typeof note === "string" ? { text: note, draw: "" } : { text: note[0], draw: note[1] };
}

export const hasGuide = (line: TrainingLine) => line.name in GUIDES;

export { GUIDES };
