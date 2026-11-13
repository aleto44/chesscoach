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

const GUIDES: Record<string, Notes> = {
  // Orthodox 7.O-O Nc6: main lines to know.
  "King's Indian Defense: Mar del Plata, 10.f3 and the ...g5 storm": {
    8: ["8.d5 closes the center and hits the c6 knight. In this structure your attack is on the kingside, so the knight doesn't go back to b8: it heads that way, to a square where it will back up ...f5.", "r:d5 r:c6"],
    9: ["9.Ne1 sends the knight to d3 to support c5, White's attack on the queenside. Your break is ...f5, and the f6 knight stands in the f-pawn's way: move it, keeping an eye on e5 and c5.", "y:f7f5"],
    10: ["10.f3 props up e4. Now play the break you prepared: the f-pawn hits e4 and opens the way for your pieces to the kingside.", "y:f7f5 r:e4"],
    11: ["11.Be3 waits for ...fxe4, which would open the f-file for White's rooks too. Go past e4 instead: the pawn gains space, hits the e3 bishop and shuts it out of the kingside.", "y:f5f4 r:e3"],
    12: ["The center is locked, so it's a race: White on the queenside, you on the kingside. Bring the next pawn into the storm; ...g4 comes later to break open f3.", "y:g6g4 r:f3"],
    13: ["13.Nd3 backs up c5. Let it come: your e7 knight does nothing where it is. Bring it to the kingside, toward f4 and h4.", "y:h4 y:f4"],
    14: ["14.c5 opens lines on your queenside. Don't spend moves defending there: the d7 knight goes back to the kingside to support ...g4. Every tempo goes into the attack.", "y:g5g4 r:f3"],
  },
  "King's Indian Defense: Bayonet, 9.b4 Nh5": {
    8: ["8.d5 closes the center and hits the c6 knight. Your attack is on the kingside: the knight heads that way, ready to back up ...f5.", "r:d5 r:c6"],
    9: ["9.b4 is the Bayonet: White races on the queenside at once. Here the slow ...Nd7 is too slow. The f6 knight clears the f-pawn's path with a jump to the edge, where it also eyes f4.", "y:f7f5 y:f4"],
    10: ["10.Re1 makes room for the bishop on f1. The break is ready: hit e4 with the f-pawn.", "y:f7f5 r:e4"],
    11: ["11.Ng5 aims at e6, and the h5 knight is loose: Bxh5 would split your pawns. Bring it back toward the center, hitting e4.", "r:h5 r:e4"],
    12: ["12.Bf3 props up e4. Undermine the d5 pawn: ...c6 hits it, and the trade on d5 opens your queenside pieces.", "r:d5"],
  },
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 main line": {
    8: ["8.Be3 guards d4 a third time. Hit the bishop with your f6 knight: White has to decide about it now, and the knight on g4 also eyes f2.", "r:e3 r:f2"],
    9: ["9.Bg5 hits your queen. Block with a pawn: it blunts the bishop for good and guards e5.", "r:g5 y:d8g5"],
    10: ["10.Bh4 pins again along the h4-d8 diagonal. Kick it with a pawn: it gains kingside space too.", "r:h4 y:h4d8"],
    11: ["11.Bg3 is safe for now, but your g4 knight is out on a limb (h3 would chase it). Reroute it to h6: from there it backs up ...f5 and can come to f7.", "y:f5 y:f7"],
    12: ["12.d5 hits the c6 knight and closes the center. Same idea as the Mar del Plata: the knight goes toward the kingside, where your attack is.", "r:d5 r:c6"],
    13: ["13.Nd2 lets f3 come and heads for c4. Now the break: the f-pawn hits e4, with the h6 knight behind it.", "y:f7f5 r:e4"],
  },
  // Orthodox: natural moves that lose something.
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 9.Qd2?": {
    8: ["8.Be3 guards d4 a third time. Hit the bishop with your f6 knight: White has to decide about it now, and the knight on g4 also eyes f2.", "r:e3 r:f2"],
    9: ["9.Qd2? leaves the bishop on e3 for your knight. Take it: White has to take back with the f-pawn, and the bishop pair is yours.", "r:e3"],
    10: ["Now open your g7 bishop: trade on d4. After exd4 the d4 pawn stands alone, hit by the bishop and the c6 knight.", "y:g7d4 r:d4"],
    11: ["d4 is hit twice (the g7 bishop, the c6 knight) and held by the f3 knight and the queen. Go after a defender: the f3 knight.", "y:g7d4 r:d4 r:f3"],
  },
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 9.Bc1?": {
    8: ["8.Be3 guards d4 a third time. Hit the bishop with your f6 knight: White has to decide about it now, and the knight on g4 also eyes f2.", "r:e3 r:f2"],
    9: ["9.Bc1? retreats: the bishop no longer covers d4 or the diagonal to g1. With your f6 knight gone, a trade on d4 opens the g7 bishop's diagonal.", "y:g7d4 r:f2"],
    10: ["Look along the diagonal from d4 to g1: once the d4 knight goes, your bishop lands there aimed straight at the king. Take on f2 first; Rxf2 walks into it.", "y:g7d4 y:d4g1 r:f2"],
    11: ["The shot: take the d4 knight with the bishop. It wins the piece back and pins the f2 rook to the king.", "y:g7d4 y:d4g1 r:f2"],
    12: ["12.Qe1 holds the pinned rook. You're a pawn up: hit e4 with the f-pawn and open the f-file toward f2.", "y:f7f5 r:e4 r:f2"],
  },
  "King's Indian Defense: Orthodox, 8.Bg5 and 10.Bg3?": {
    7: ["The Classical main line. Develop the queen's knight to c6: it adds pressure on d4.", "r:d4"],
    8: ["8.Bg5 pins the f6 knight to the queen. Ask the bishop right away.", "r:g5 y:g5d8"],
    9: ["9.Bh4 keeps the pin. Break it for good with a pawn: it gains space too.", "r:h4 y:h4d8"],
    10: ["10.Bg3? looks natural, but now only the c3 knight guards e4. Trade on d4 first: then a knight capture on e4 also uncovers the g7 bishop.", "r:e4 y:g7d4"],
    11: ["Now take on e4: the f6 knight leaves, and the g7 bishop hits the d4 knight. Nxe4 drops it to Bxd4.", "r:e4 r:d4 y:g7d4"],
    12: ["12.Nxc6 hits your queen, but first take the c3 knight: your knight hits the queen and the e2 bishop, so White has to take back.", "r:c3 r:d8"],
    13: ["Now take back on c6. You're a pawn up, White's queenside pawns are split, and the g7 bishop looks straight at c3.", "y:g7c3 r:c3"],
  },
  "King's Indian Defense: Gligoric, 7.Be3 Ng4 8.Bd2?": {
    6: ["The classical setup. Strike the center with the e-pawn: it hits d4 and opens the d8-h4 diagonal for your queen.", "r:d4 y:d8h4"],
    7: ["7.Be3 skips castling. Hit the bishop with your f6 knight.", "r:e3 r:f2"],
    8: ["8.Bd2? backs off and lets the knight stay. With the f6 knight gone, a trade on d4 opens the long diagonal.", "y:g7d4 r:d4"],
    9: ["The d4 knight has only the queen behind it, and the e2 bishop hits your g4 knight. Take on d4 anyway: if Bxg4, a queen move hits two things at once.", "y:g7d4 r:d4 r:g4"],
    10: ["Count what's loose: the g4 bishop has no defender, and your d4 bishop already hits f2. One queen move attacks both.", "y:d8h4 r:g4 r:f2"],
    11: ["11.O-O covers f2. Collect the bishop: you're a piece up.", "r:g4"],
  },
  // 7...exd4 8.Nxd4 Re8: only f3 or Bf3 keeps e4.
  "King's Indian Defense: Classical, ...exd4 and ...d5": {
    8: ["After the trade on d4, e4 is White's soft spot, and as soon as your f6 knight moves, the g7 bishop hits the d4 knight. Put a rook on the e-file to hit e4.", "y:g7d4 y:e8e4 r:e4"],
    9: ["9.f3 holds e4 with a pawn, the sound answer. Get ready for the central break ...d5: support it with the c-pawn first, which also keeps White's pieces off d5.", "y:d6d5 y:c6"],
    10: ["10.Kh1 steps off the g1-a7 diagonal. Now break: ...d5 hits c4 and e4 at once.", "y:d6d5 r:c4 r:e4"],
    11: ["Take back with the pawn: you get a strong d5 pawn and the open c-file, and White's e4 pawn is gone.", "y:c8c1 r:d4"],
  },
  "King's Indian Defense: Classical, ...exd4 9.Qc2?": {
    8: ["After the trade on d4, e4 is White's soft spot, and as soon as your f6 knight moves, the g7 bishop hits the d4 knight. Put a rook on the e-file to hit e4.", "y:g7d4 y:e8e4 r:e4"],
    9: ["9.Qc2? looks like it guards e4, but the queen left d1, and now nothing guards the d4 knight. Count: take on e4, and if Nxe4, the g7 bishop takes d4.", "r:e4 r:d4 y:g7d4"],
    10: ["The knight on d4 is loose: take it with the bishop. You've won the e4 pawn, and your rook keeps the e4 knight in its sights.", "y:g7d4 r:d4 y:e8e4"],
    11: ["11.Bg5 hits your queen. Block with the f-pawn: it also takes g5 and e5 from the e4 knight.", "r:g5 y:d8g5"],
    12: ["Pin the e4 knight to the c2 queen with your light-squared bishop. You stay a pawn up with active pieces.", "r:e4 r:c2"],
  },
  "King's Indian Defense: Classical, ...exd4 9.Bf4?": {
    8: ["After the trade on d4, e4 is White's soft spot, and as soon as your f6 knight moves, the g7 bishop hits the d4 knight. Put a rook on the e-file to hit e4.", "y:g7d4 y:e8e4 r:e4"],
    9: ["9.Bf4? develops, but it leaves e4 guarded only by the c3 knight, and you have the e8 rook behind it. Take e4.", "r:e4 y:e8e4"],
    10: ["Take back with the rook. From e4 it hits the f4 bishop and the d4 knight, and the g7 bishop hits d4 too.", "r:f4 r:d4 y:g7d4"],
    11: ["11.Be3 covers d4. You're a clean pawn up: bring the queen to the e-file behind the rook, hitting e3 and e2.", "y:e8e3 r:e3"],
  },
  // Glek, 7...Na6.
  "King's Indian Defense: Glek, 8.Be3 Ng4": {
    7: ["The Glek: the queen's knight goes to a6, not c6. It doesn't block the c-pawn, and after d5 it comes to c5 to hit e4.", "y:c5 r:e4"],
    8: ["8.Be3 again: hit the bishop with your f6 knight, as in the Orthodox. White can't keep the bishop on e3 without giving something.", "r:e3"],
    9: ["9.Bg5 hits your queen. Step out of the pin to e8: from there the queen still guards e5 and doesn't block the f-pawn.", "r:g5 y:d8g5"],
    10: ["10.dxe5 opens the d-file. Take back with the pawn: e5 is your strong point, and d4 becomes a square for your pieces.", "r:e5 y:d4"],
    11: ["11.h3 hits the g4 knight. Before it moves, kick the g5 bishop: if hxg4, then hxg5, and White has gained nothing.", "r:g5 r:g4"],
    12: ["12.Bd2 drops back. The knight goes back to f6, hitting e4. It's about equal, with the structure you want: the e5 pawn, the g7 bishop behind it, and ...Nc5 to come.", "r:e4 y:c5"],
  },
  "King's Indian Defense: Glek, 8.d5 Nc5": {
    7: ["The Glek: the queen's knight goes to a6, not c6. It doesn't block the c-pawn, and after d5 it comes to c5 to hit e4.", "y:c5 r:e4"],
    8: ["8.d5 closes the center: this is why the knight went to a6. Jump to c5, hitting e4.", "y:c5 r:e4"],
    9: ["9.Qc2 holds e4. Make the c5 knight permanent: a pawn move stops b4 from kicking it.", "y:c5 r:b4"],
    10: ["10.Bg5 pins the f6 knight. Ask the bishop.", "r:g5 y:g5d8"],
    11: ["11.Be3 hits the c5 knight. Back it up with a pawn: the knight stays on c5 for good, and your queenside is safe.", "y:c5 r:e3"],
  },
  "King's Indian Defense: Glek, queens off and 11.Nd5?": {
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
    8: ["Against the Four Pawns, open lines before White's pawns roll. Trade on d5: you get the e-file and a target on d5.", "r:d5"],
    9: ["9.cxd5 gives you the Benoni structure. Put a rook on the e-file: it stops e5 for now and lines up on e4 with the e2 bishop behind it.", "y:e8e2 r:e4"],
    10: ["10.e5 is the sharp main line. Take: White's center comes forward but goes loose.", "r:e5"],
    11: ["11.fxe5. The e5 pawn is the target, and your rook already hits it. Add the f6 knight from a square where its move also uncovers the g7 bishop.", "r:e5 y:g7e5 y:e8e5"],
    12: ["12.Bg5 hits your queen. Bring it to b6, where it hits b2 and stands on the diagonal to g1.", "r:g5 y:b6g1 r:b2"],
    13: ["13.O-O. Now take e5.", "r:e5"],
    14: ["Take back with the bishop: it sits on e5, aimed at c3 and h2.", "y:e5c3 y:e5h2"],
  },
  "King's Indian Defense: Four Pawns, early 9.e5? and 10.Nxd5": {
    9: ["9.e5? comes before cxd5, so the d5 pawn is still yours. Don't retreat: jump into e4 with the knight, hitting c3.", "y:e4 r:c3"],
    10: ["10.Nxd5 takes the pawn back, but the d5 knight is on its own. Develop with tempo: a knight that hits e5 and d4.", "r:e5 r:d4"],
    11: ["11.Bd3 hits your e4 knight. Back it up with the f-pawn rather than retreat.", "r:e4 y:f7f5"],
    12: ["Open the center: take on e5. With the pawns gone, the g7 bishop's diagonal opens.", "r:e5 y:g7e5"],
    13: ["The e5 pawn is weak and your g7 bishop sees it. Develop the light bishop to e6, hitting the d5 knight.", "r:d5 r:e5"],
  },
  "King's Indian Defense: Four Pawns, early 9.e5? and 10.cxd5": {
    9: ["9.e5? comes before cxd5, so the d5 pawn is still yours. Don't retreat: jump into e4 with the knight, hitting c3.", "y:e4 r:c3"],
    10: ["10.cxd5. Take the c3 knight: White's pawns end up broken, and once e5 falls the g7 bishop hits c3.", "r:c3"],
    11: ["11.bxc3. Hit e5: it's already attacked by the d6 pawn, and the knight from d7 adds another.", "r:e5"],
    12: ["12.e6 gives a pawn to make a mess. Take it with the f-pawn.", "r:e6"],
    13: ["13.dxe6. Knight back to f6: your king is safe, and the e6 pawn is weak.", "r:e6"],
  },
  // London.
  "London System: King's Indian, 7.c4 Nh5": {
    5: ["Against the London, keep the King's Indian shape: the d-pawn first, then ...e5, which will also hit the f4 bishop.", "r:f4 y:e5"],
    6: ["6.O-O. The knight goes to d7 to back up ...e5.", "y:e5"],
    7: ["7.c4. The f4 bishop is the London's best piece: go after it with the knight from h5.", "r:f4"],
    8: ["8.Bg5 dodges. Kick it with a pawn: it's running out of squares.", "r:g5"],
    9: ["9.Bh4. Again: the g-pawn kicks it, and on g3 it's in range of your h5 knight.", "r:h4 y:g3"],
    10: ["10.Bg3. Take the bishop: you get the bishop pair, and your g7 bishop has no rival on the dark squares.", "r:g3 y:g7d4"],
  },
  "London System: King's Indian, ...Qb6 and ...Be6": {
    5: ["Against the London, keep the King's Indian shape: the d-pawn first, then ...e5, which will also hit the f4 bishop.", "r:f4 y:e5"],
    6: ["6.h3 is slow. Hit d4 with the c-pawn: d4 is what the g7 bishop is aimed at.", "y:g7d4 r:d4"],
    7: ["7.c3. With the bishop gone to f4, nothing guards b2: your queen can hit b2 and d4 at once.", "r:b2 r:d4"],
    8: ["8.Qb3 offers a queen trade. Don't take on b3 (that opens the a-file for White's rook): develop the bishop with tempo on the queen instead.", "r:b3"],
    9: ["9.Qxb6. Take back with the a-pawn: your rook gets the open a-file against a2. The position is equal and easy to play.", "y:a8a2 r:a2"],
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
