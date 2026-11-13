// What each training line is for: when the student reaches the end of a book line, the trainer shows
// the plan for their side in that position, one idea at a time, each with its own drawings on the
// board, so "from here it's a middlegame" comes with a reason to make the next moves.
//
// Each plan reads in the same order: first the big picture (what the opening and its pawn structure
// are about, and where each side plays), then how to carry that out in this position, then what the
// opponent is playing for. Concrete moves and tactics come in only where the position demands them.
// Written by hand and checked against the engine's view of each final position (not generated on the
// fly); scripts/check-book.mjs checks that every line has a plan and every drawing starts on a piece
// or where an earlier arrow of the same idea ends.
//
// `draw` is a list of shapes on the line's final position: "g:e3e4" is an arrow, "r:c5" a circle.
// Brushes: g green (your move or break), b blue (a piece route), r red (the opponent's idea or a
// target), y yellow (a square, file or diagonal worth noting). Moves in `text` are written as usual
// ("Ne5", "...c5"); hovering or tapping one shows it on the board (components/SquareText.tsx).
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import type { TrainingLine } from "./training";

export interface PlanIdea {
  title: string;
  text: string;
  draw: string;
}

const I = (title: string, text: string, draw: string): PlanIdea => ({ title, text, draw });

const BRUSH: Record<string, string> = { g: "green", b: "blue", r: "red", y: "yellow" };

/** An idea's drawings as Chessground shapes. */
export function planShapes(idea: PlanIdea): DrawShape[] {
  return idea.draw
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      const [b, sq] = token.split(":");
      const brush = BRUSH[b] ?? "green";
      return sq.length === 4
        ? { orig: sq.slice(0, 2) as Key, dest: sq.slice(2, 4) as Key, brush }
        : { orig: sq as Key, brush };
    });
}

/** The plan for a built-in line; the student's own repertoire lines have none. */
export function planOf(line: TrainingLine): PlanIdea[] | null {
  return PLANS[line.name] ?? null;
}

// ---- Shared plans: lines that reach the same structure ----

// London lines where Black played ...c4: the queenside is locked, the centre is White's.
const LONDON_C4: PlanIdea[] = [
  I(
    "...c4 handed you the centre",
    "By pushing ...c4, Black stopped pressuring d4 to grab space on the queenside. The d5 pawn has no c-pawn behind it any more, so the centre is where you play.",
    "r:c4 y:d5",
  ),
  I(
    "Prepare and play e4",
    "Develop the kingside (Ngf3, Be2, castle), then e4. It hits d5 and opens lines while your pieces are better placed for an open centre.",
    "g:e3e4 r:d5",
  ),
  I(
    "Black's plan: ...b5-b4",
    "Black's space is on the queenside: ...e6, ...b5 and ...b4 to break your c3 pawn. b3 at the right moment questions the c4 pawn before that bind gets going.",
    "r:b7b5 g:b2b3 r:c4",
  ),
];

// The Classical Caro-Kann (via 3.Nc3 or 3.Nd2): the same position after 10...e6.
const CARO_CLASSICAL: PlanIdea[] = [
  I(
    "The Caro-Kann bargain",
    "You have no weaknesses and a solid c6-e6 structure; White has more space and a pawn on h5. Your job is to finish developing safely, then challenge the d4 pawn, White's only foothold in the centre.",
    "y:c6 y:e6 r:d4",
  ),
  I(
    "Develop, and pick a side for your king",
    "...Ngf6, ...Be7 (or ...Bd6) and ...Qc7. White's h5 pawn and queen on d3 aim at the kingside, so castling long with ...O-O-O is common and safe.",
    "b:g8f6 b:f8e7 b:d8c7",
  ),
  I(
    "The ...c5 break, and the h5 pawn",
    "...c5 attacks d4 and frees your position. Long term, White's h5 pawn is far from home: in an endgame it can become a target, and it already rules out ...g6 for you.",
    "g:c6c5 r:d4 y:h5",
  ),
];

export const PLANS: Record<string, PlanIdea[]> = {
  // ---- London System (White) ----
  // The London: a solid c3-d4-e3 pyramid, the dark bishop outside it on f4, then play on the
  // kingside (Ne5, f4) or in the centre (e4) depending on what Black does.
  "London System: Classical, ...e6 and ...Bd6": [
    I(
      "Your structure, your side of the board",
      "Your c3-d4-e3 pyramid is rock solid. Black will play on the queenside with ...c5, ...b6 and ...Bb7. Your play is in the centre and on the kingside, where your bishops on d3 and g3 already point.",
      "y:d3h7 r:c5",
    ),
    I(
      "Ne5 backed by f4",
      "A knight on e5 supported by f4 is the classic London attacking setup: no pawn can kick it, it frees f3 for the queen or rook, and it points at Black's king. If Black trades ...Bxg3, hxg3 opens the h-file too.",
      "b:f3e5 g:f2f4 y:e5",
    ),
    I(
      "Or open the centre with e4",
      "If Black's pieces aren't ready for it, Qe2, castling and e4 opens the centre in your favour. e5 then kicks the f6 knight, the main defender of Black's king.",
      "b:d1e2 g:e3e4",
    ),
  ],
  "London System: ...c5 and ...Qb6": LONDON_C4,
  "London System: Mirror, ...Bf5": [
    I(
      "With the light bishops gone, e4 is the plan",
      "Black copied your setup and traded light bishops. That helps you in one way: your queen on d3 and knight on d2 both support e4. Castle, then e4 opens the centre where you're better coordinated.",
      "b:e1g1 g:e3e4 y:d3e4",
    ),
    I(
      "The bishop question",
      "...Bd6 asks your bishop to trade. Bxd6 Qxd6 is simple and fine; Bg3 keeps the tension, and after ...Bxg3 hxg3 your rook gets the h-file.",
      "y:f4d6 b:f4g3",
    ),
    I(
      "Black's play is the c-file",
      "Black will use ...cxd4 and ...Rc8 on the c-file, or ...c4 for space. dxc5 at the right moment takes that away and frees d4 for your knight.",
      "r:c5 g:d4c5 b:f3d4",
    ),
  ],
  "London System: ...c5 and ...cxd4": [
    I(
      "Your structure: the e-file and e5",
      "After exd4 you have the half-open e-file and a great square on e5; Black has the half-open c-file. Ngf3, Bd3, O-O, Re1 and Ne5: all your pieces point at Black's kingside.",
      "b:g1f3 b:f3e5 y:e5",
    ),
    I(
      "Trade off Black's good bishop",
      "Black's bishop on f5 is its best minor piece. Bd3 challenges it; once it's gone, Black's light squares and the b7 pawn are harder to defend.",
      "b:f1d3 r:f5",
    ),
    I(
      "Black's plan: the minority attack",
      "With ...b5-b4, Black will try to break up your c3-d4 chain. Qb3, hitting b7 (no longer guarded by the bishop), slows that down and keeps Black busy.",
      "r:b7b5 g:d1b3 r:b7",
    ),
  ],
  "London System: ...c6 and the ...Bg4 pin": [
    I(
      "Black's bishop left the queenside",
      "Black solved its problem bishop by bringing it out before ...e6, a Slav idea. The cost: b7 has no bishop to guard it. Qb3 asks Black to spend time on it.",
      "g:d1b3 r:b7",
    ),
    I(
      "Break the pin, then Ne5",
      "Be2 unpins the f3 knight. Then Ne5 offers to trade the d7 knight and gets your knight to the London's best square.",
      "b:f1e2 b:f3e5",
    ),
    I(
      "Later, the e4 break",
      "Black's pawns on c6-d5-e6 are a solid wall. e4, prepared by your pieces, is how you open the position for your bishops.",
      "g:e3e4 r:d5",
    ),
  ],
  "London System: Grünfeld setup, ...g6": [
    I(
      "c3 blunts the Grünfeld bishop",
      "Black's bishop on g7 aims down the long diagonal at d4 and b2 (once the f6 knight moves). Your c3 pawn holds that diagonal; keep the pyramid intact and d4 safe.",
      "y:g7b2 r:d4",
    ),
    I(
      "Keep your London bishop",
      "h3 gives your bishop on f4 a retreat to h2 and stops ...Nh5 and ...Bg4. The London bishop is your best piece; don't let it be traded cheaply.",
      "g:h2h3 b:f4h2",
    ),
    I(
      "Nbd2 and Ne5",
      "Then Nbd2 and Ne5: a knight on e5 is hard to kick, since Black's d-pawn is past d6 and the f6 knight is in the way of ...f6. If Black hits b2 with ...Qb6, Qb3 meets it.",
      "b:b1d2 b:f3e5 y:e5",
    ),
  ],
  "London System: ...Nh5 hunting the bishop": [
    I(
      "Your structure: the e-file and e5",
      "After ...cxd4 exd4 you have the half-open e-file and the e5 square; Black has the c-file. Play on your side: Bd3, O-O, Re1 and Ne5.",
      "b:f1d3 b:f3e5 y:e5",
    ),
    I(
      "c3, and the bishop comes back",
      "c3 gives d4 a solid base. Black's knight went back to f6, so Bf4 can put the bishop on its best diagonal again.",
      "g:c2c3 b:e3f4",
    ),
    I(
      "Black's plan: pressure on d4",
      "Black will use the c-file and go after d4: ...Bg4 pins the knight that guards it, and ...Qb6 or ...Qc7 add pressure. Keep d4 covered before going for the attack.",
      "r:c8g4 r:d4",
    ),
  ],
  "London System: Chigorin setup, ...Nc6 and ...Bf5": [
    I(
      "No ...c5 for Black",
      "With the knight on c6, Black can't play ...c5. Black's only central break is ...e5, prepared by ...Bd6 and the knight. Keep e5 covered and Black runs short of plans.",
      "r:e6e5 y:e5",
    ),
    I(
      "b7 is weak",
      "Black's bishop left c8 and the knight blocks ...c6, so b7 is loose. Qb3 hits it.",
      "g:d1b3 r:b7",
    ),
    I(
      "Remove the ...e5 helpers",
      "Bxd6 takes off a piece that supports ...e5; Nh4 then goes after Black's best minor piece, the bishop on f5.",
      "y:f4d6 b:f3h4 r:f5",
    ),
  ],
  "London System: King's Indian setup": [
    I(
      "Black's whole plan is ...e5",
      "In the King's Indian setup, Black wants ...e5 to challenge d4 and hit your bishop. h3 already gave the bishop h2, so it stays on the h2-b8 diagonal when ...e5 comes.",
      "r:e7e5 b:f4h2",
    ),
    I(
      "dxc5 opens the d-file",
      "dxc5 dxc5 opens the d-file. Then ...e5 leaves holes on d5 and d6, and your queen and rooks use the open file.",
      "g:d4c5 y:d1d8",
    ),
    I(
      "Quiet development, then e4",
      "Nbd2, O-O and Qc2, then e4: you take the centre once Black's pieces are committed.",
      "b:b1d2 g:e3e4",
    ),
  ],
  "London System: ...d5, ...c5 and ...Qb6": [
    I(
      "Expect ...Nh5 first",
      "Black's most testing reply is ...Nh5 against your bishop. Bg5 keeps it active (Bg3 is fine too): the London bishop is worth keeping.",
      "r:f6h5 b:f4g5",
    ),
    ...LONDON_C4,
  ],
  "London System: Queen's Indian setup, ...b6": [
    I(
      "A fight over e4",
      "Black's Queen's Indian setup is about the light squares: the b7 bishop and f6 knight both aim at e4. Nbd2 and Qe2 add guards, so you can push e4 yourself.",
      "r:b7e4 b:b1d2 b:d1e2 y:e4",
    ),
    I(
      "Your bishop points at h7",
      "With Black castled and the b7 bishop far from the kingside, Bd3 plus Ne5 and Qf3 or Qe2 aims at h7: a classic London attack.",
      "y:d3h7 b:f3e5",
    ),
    I(
      "If Black plays ...d5",
      "...d5 shuts Black's own b7 bishop in behind the pawn. Then e4 is harder to get in, so switch to Ne5 and f4.",
      "r:d7d5",
    ),
  ],
  "London System: Early ...c5 and ...Qb6": [
    I(
      "You're playing for development",
      "Nc3 makes b2 a gambit: if the queen takes it, Rb1 or Na4 chase it while you develop. Every queen move is a move Black doesn't develop a piece.",
      "r:b6b2 b:c3a4",
    ),
    I(
      "Take the centre",
      "Without ...d5, Black hasn't claimed the centre. dxc5 Qxc5, then Nf3 and e4: a big centre, gained with tempo on the queen.",
      "g:d4c5 g:e3e4",
    ),
    I(
      "Why ...a6",
      "Black played ...a6 to stop Nb5, which would hit c7 and d6. So your knight does its work elsewhere: Na4, or support for e4.",
      "r:a6 y:b5",
    ),
  ],
  "London System: Old Indian, ...d6 and ...e5": [
    I(
      "Why ...e5 lost a pawn",
      "In the Old Indian, Black's whole plan is ...e5. Played here, e5 was attacked by your knight and bishop and defended only by the d7 knight: Black's own f6 knight blocks the g7 bishop. So dxe5 dxe5 Nxe5 wins it, and after ...Nxe5 Qxd8 Rxd8 Bxe5 your bishop is safe.",
      "y:e5 y:g7e5 r:f6",
    ),
    I(
      "Expect ...Nh5",
      "Black's best try is ...Nh5, hitting your bishop. Bxh5 removes the attacker; after ...Nxe5 you're still a clean pawn up.",
      "r:f6h5 b:e2h5",
    ),
    I(
      "Up a pawn: trade pieces",
      "Every trade brings you closer to an endgame where the extra pawn wins. Aim for the queen trade on the open d-file, develop with Nc3 and Rd1, and don't grab more.",
      "y:d1d8 b:b1c3",
    ),
  ],
  "London System: Dutch, ...f5": [
    I(
      "...f5 is about e4",
      "Black's Dutch setup, with the bishop on b7, is all about the e4 square: a knight there would dominate. Nbd2 contests it, and your bishop on d3 already eyes it.",
      "r:f6e4 b:b1d2 y:e4",
    ),
    I(
      "The hole on e5",
      "...f5 also left e5 for your knight. Ne5 is hard to dislodge: Black needs ...d6, which weakens e6.",
      "b:f3e5 y:e5",
    ),
    I(
      "Open lines toward the king",
      "...f5 loosened Black's kingside light squares. After you castle and develop, g4 or e4 at the right moment opens lines toward Black's king.",
      "g:g2g4 r:f5",
    ),
  ],
  "Englund Gambit": [
    I(
      "Against a dubious gambit: develop, don't grab",
      "You're a pawn up and far ahead in development: Black's queen is stuck out on a3. The way to beat a bad gambit is to bring pieces out with tempo, not to win more material.",
      "r:a3 g:e2e4 b:f1c4",
    ),
    I(
      "Nxc7+ is threatened",
      "Nd5 attacks c7: Nxc7+ forks the king and the rook on a8. It also hits the bishop on b4.",
      "g:d5c7 r:e8 r:a8 r:b4",
    ),
    I(
      "Remember the trap",
      "Back on move 6, Bc3?? lost to ...Bb4: the bishop is pinned and Black's queen gets to c1 with mate. 6.Nc3 was right.",
      "y:d2c3",
    ),
  ],
  "Old Benoni, ...c5": [
    I(
      "Black closed the centre",
      "With pawns on c5, d6 and e5, Black is solid but cramped, and you have more space. In closed positions the plan is pawn breaks: f4 on the kingside, or b4 on the queenside.",
      "g:f2f4 g:b2b4",
    ),
    I(
      "a4 and a knight on c4",
      "a4 stops ...b5, Black's queenside counterplay. Then a knight on c4 (via a3 or d2) hits d6 and can't be kicked by a pawn.",
      "g:a2a4 b:b1d2 b:d2c4 r:d6",
    ),
    I(
      "Black's break: ...f5",
      "Black's freeing move is ...f5, after ...Ne7 or ...Nf6-e8. Meet it with exf5 and use the e4 square for your pieces.",
      "r:f7f5 y:e4",
    ),
  ],

  // ---- Italian Game (White) ----
  // The slow Italian: c3 and d3 now, d4 later; the knight goes d2-f1-g3, the bishop stays on the
  // a2-g8 diagonal, and the queenside (a4, b4) gives extra space.
  "Italian Game: Giuoco Pianissimo, ...d6 and ...a5": [
    I(
      "The slow Italian",
      "This is a manoeuvring game. c3 and d3 prepared d4 for later, not for now: first improve every piece, then play d4 when it opens lines for you.",
      "g:d3d4 r:e5",
    ),
    I(
      "The Italian knight's tour",
      "Nf1 then Ng3: the knight leaves d2 (freeing your c1 bishop) and heads toward f5 and Black's king.",
      "b:d2f1 b:f1g3 y:f5",
    ),
    I(
      "Black wants ...d5 and your bishop",
      "Black's freeing break is ...d5, and ...Be6 would trade off your best bishop. Bb3 or Ba2 keeps the bishop on the diagonal toward f7.",
      "r:d6d5 b:c4b3 y:f7",
    ),
  ],
  "Italian Game: Giuoco Pianissimo, ...a6 and ...Ba7": [
    I(
      "The slow Italian",
      "Black's bishop dropped to a7 so d4 won't hit it with tempo. Your plan is still d4 when ready: first h3, then Nbd2-f1-g3.",
      "g:h2h3 b:b1d2 g:d3d4",
    ),
    I(
      "Queenside space",
      "With a4 in, b4 (and sometimes a5) gains space and cramps Black's queenside pieces.",
      "g:b2b4",
    ),
    I(
      "Neutralise the a7 bishop",
      "Black's bishop on a7 aims at f2 and your king. Be3 offers to trade it.",
      "b:c1e3 r:a7 y:f2",
    ),
  ],
  "Italian Game: Giuoco Piano, early ...d6": [
    I(
      "You've got the classical centre",
      "Pawns on e4 and d4 side by side is what the Italian aims for. Keep both: develop with Nc3 and O-O, and use d5 to gain space with tempo on the c6 knight.",
      "b:b1c3 g:d4d5 r:c6",
    ),
    I(
      "Black is hitting d4",
      "Black's bishop on b6 and knight on c6 target d4, and ...Bg4 would pin its defender on f3. h3 stops that; Bb5 pins the c6 knight to Black's king.",
      "y:b6d4 g:h2h3 b:c4b5",
    ),
  ],
  "Italian Game: Two Knights, d3 and ...Be7": [
    I(
      "It's a Ruy Lopez now",
      "Black's ...Na5, ...b5 and ...c5 is the Chigorin plan from the Ruy Lopez: space on the queenside. Your answer is the Ruy's: h3, then d4 in the centre.",
      "r:b5 g:h2h3 g:d3d4",
    ),
    I(
      "Bring the knight over",
      "Nbd2-f1-g3 brings the queen's knight to the kingside, where your pieces will play.",
      "b:b1d2 b:d2f1 b:f1g3",
    ),
    I(
      "The bishop on c2",
      "Your bishop on c2 points at h7. Once the centre opens, it's a big attacking piece.",
      "y:c2h7",
    ),
  ],
  "Italian Game: Two Knights, d3 and ...d5": [
    I(
      "Black freed the game: now take e5",
      "...d5 is Black's active answer to d3, but it leaves e5 defended only by the c6 knight. Nxe5 Nxe5 Rxe5 wins it: your rook on e1 was aiming there all along.",
      "g:f3e5 b:e1e5 r:c6",
    ),
    I(
      "Keep the bishop on f7's diagonal",
      "In the open game that follows, your bishop is your best piece. If ...Nb6 hits it, drop it back to b3, where it still eyes f7.",
      "b:c4b3 y:f7",
    ),
  ],
  "Italian Game: Hungarian Defense, ...Be7": [
    I(
      "Black chose a passive setup",
      "The bishop on e7 doesn't pressure f2, so you have time for the full Italian plan: h3, Nbd2-f1-g3, then d4.",
      "g:h2h3 g:d3d4",
    ),
    I(
      "...Na5 is coming",
      "Black's most useful move is ...Na5, going for your bishop. Bb5 or Bb3 keeps it.",
      "r:c6a5 b:c4b5",
    ),
    I(
      "Bring the knight over",
      "Nbd2-f1-g3 brings your last piece toward the kingside.",
      "b:b1d2 b:d2f1 b:f1g3",
    ),
  ],
  "Petrov's Defense: Classical": [
    I(
      "The e4 knight is Black's centrepiece",
      "In the Petrov, Black's knight on e4 holds the position together, supported by the d5 pawn. Your whole plan is to undermine it: c4 hits d5, Nc3 challenges the knight.",
      "g:c4d5 r:e4 b:b1c3",
    ),
    I(
      "Expect ...Nb4",
      "Black's main answer is ...Nb4, hitting your d3 bishop. Be2 keeps it, and Black's knight is off on the edge.",
      "r:c6b4 b:d3e2",
    ),
    I(
      "Re1 on the e-file",
      "Re1 puts your rook on the open e-file, against the knight and toward Black's king.",
      "b:f1e1",
    ),
  ],
  "Philidor Defense: Exchange": [
    I(
      "More space",
      "Your e4 pawn against Black's d6 means more space; Black is solid but cramped. Keep the space and build up: Re1 or Bf4, or f4 to push on the kingside.",
      "y:e4 b:f1e1 g:f2f4",
    ),
    I(
      "Black's freeing trick",
      "Black's way out is ...Nxe4 Nxe4 d5, forking your bishop and knight. Bd3 after ...d5 keeps it level; know it's coming.",
      "r:f6e4 r:d6d5",
    ),
  ],

  // ---- Queen's Gambit (White) ----
  "Queen's Gambit Declined: Orthodox": [
    I(
      "Black's freeing manoeuvre",
      "The QGD is solid but cramped. ...dxc4 and ...Nd5 is Capablanca's freeing idea: trade pieces so the cramped position breathes.",
      "r:d5c3 y:g5e7",
    ),
    I(
      "Keep the space",
      "Bxe7 Qxe7 and O-O. When Black trades on c3, e4 takes the whole centre.",
      "y:g5e7 b:e1g1 g:e3e4",
    ),
    I(
      "Black's breaks: ...e5 and ...c5",
      "Black frees the game with ...e5 or ...c5. After ...Nxc3 Rxc3 your rook already stands on the c-file to meet ...c5.",
      "r:e6e5 r:c6c5",
    ),
  ],
  "Queen's Gambit Declined: ...Be7 move order": [
    I(
      "Black's plan: ...Bb7 and ...c5",
      "This is the Tartakower setup: ...b6, ...Bb7 and ...c5, often leaving Black with 'hanging pawns' on c5 and d5. Those pawns are your targets.",
      "r:c7c5 r:d5",
    ),
    I(
      "Rc1 and the c-file",
      "Rc1 lines up against c7 and the c-file, which opens after cxd5.",
      "b:a1c1 y:c7",
    ),
    I(
      "Fix d5",
      "Bxf6 and cxd5 leave Black with a fixed pawn on d5 that your pieces can pressure.",
      "y:h4f6 g:c4d5",
    ),
  ],
  "Slav Defense: Main line, ...dxc4 and ...Bf5": [
    I(
      "It's all about e4",
      "In the Slav, Black gave up the centre to get the light bishop out. Your plan is e4; Black's bishops on f5 and b4 are there to stop it.",
      "b:d1e2 g:e3e4 r:f5",
    ),
    I(
      "Nh4 for the bishop pair",
      "Nh4 goes after the f5 bishop; taking it gives you the two bishops and makes e4 easier.",
      "b:f3h4 r:f5",
    ),
    I(
      "a4 holds b5",
      "Your a4 pawn stops ...b5, so the bishop on c4 can't be kicked.",
      "y:a4 r:b5",
    ),
  ],
  "Semi-Slav Defense: Meran setup": [
    I(
      "Black's Meran plan",
      "Black waits for the right moment to play ...dxc4, then ...b5 to gain queenside space, or ...e5 to free the centre.",
      "r:d5c4 r:b7b5",
    ),
    I(
      "Your plan: e4",
      "Qc2 and Bd3 already support e4. If Black waits, e4 grabs the centre; after ...dxc4 Bxc4 your pieces stay active.",
      "g:e3e4 y:d3e4",
    ),
  ],
  "Queen's Gambit Accepted: Classical": [
    I(
      "You have the centre",
      "Black gave up the centre for free development, and wants ...b5 and ...Bb7 next. a4 stops that.",
      "g:a2a4 r:b5",
    ),
    I(
      "Qe2 and Rd1",
      "Qe2 and Rd1 line up on the d-file, ready for when the c5-d4 tension resolves.",
      "b:d1e2 b:f1d1",
    ),
    I(
      "The isolated d-pawn",
      "If ...cxd4 exd4, you get an isolated d-pawn: play actively with Nc3 and Ne5 and, at the right moment, d5.",
      "y:d4 b:f3e5",
    ),
  ],
  "Queen's Gambit: Chigorin Defense": [
    I(
      "Centre against pieces",
      "The Chigorin gives up the centre for quick piece play against d4. Take the pawn back with Bxc4, and you keep the big e4-d4 centre.",
      "g:f1c4 r:c4",
    ),
    I(
      "Black's pressure on d4",
      "The c6 knight and the g4 bishop (pinning your f3 knight) gang up on d4. h3 asks the bishop; Be2 unpins.",
      "r:g4f3 g:h2h3",
    ),
    I(
      "d5 kicks the knight",
      "When it helps, d5 kicks the c6 knight out of the centre.",
      "g:d4d5 r:c6",
    ),
  ],
  "Queen's Gambit: Albin Countergambit": [
    I(
      "Keep the pawn, finish developing",
      "Black's d4 wedge is the price you're paying for the extra pawn. Castle quickly: Black's play is ...O-O-O and ...Bh3, trading your g2 bishop and going for your king.",
      "r:e6h3 r:e8c8",
    ),
    I(
      "Nb3 against d4, then the queenside",
      "Nb3 attacks the d4 pawn; a3 and b4 then get your queenside majority moving.",
      "b:d2b3 r:d4 g:a2a3",
    ),
  ],

  // ---- Caro-Kann (Black) ----
  "Caro-Kann Defense: Advance, Short Variation": [
    I(
      "Your bishop is outside the chain",
      "The point of the Advance Caro-Kann: unlike the French, your light bishop is already outside the pawn chain. So you can attack the base of White's chain, d4, with no bad bishop.",
      "y:f5 r:d4",
    ),
    I(
      "Pile on d4",
      "...Nc6 (from e7), ...Qb6 and ...cxd4 at the right moment pile on d4 and open the c-file.",
      "b:e7c6 b:d8b6 r:d4",
    ),
    I(
      "Expect c4",
      "White's best is c4, hitting d5. ...dxc4 and then ...Nc6 or ...Nd5 is fine for you.",
      "r:c2c4 y:d5",
    ),
  ],
  "Caro-Kann Defense: Advance, Bayonet g4": [
    I(
      "Hit back in the centre",
      "White's pawns have charged up the kingside; a wing attack is best met in the centre. ...cxd4, ...Nc6 and ...Nge7 attack e5 and d4.",
      "g:c5d4 b:b8c6 b:g8e7",
    ),
    I(
      "The h5 pawn",
      "Nxh5 wins your h5 pawn but costs White time: you get ...Nc6 and ...Qb6 or ...Qc7.",
      "r:f4h5",
    ),
    I(
      "Castle long",
      "Your king is safer on the queenside, away from White's pawns: ...Qc7 and ...O-O-O.",
      "b:d8c7 b:e8c8",
    ),
  ],
  "Caro-Kann Defense: Classical, h4 and h5": CARO_CLASSICAL,
  "Caro-Kann Defense: Classical via 3.Nd2": CARO_CLASSICAL,
  "Caro-Kann Defense: Exchange, Bd3 and Qb3": [
    I(
      "The minority attack",
      "In the Exchange Caro-Kann you have two queenside pawns against White's three. That's your plan: ...Rb8 and ...b5-b4 break up the c3-d4 chain and leave White with a weak pawn.",
      "g:b7b5 g:b5b4 r:c3",
    ),
    I(
      "Trade the dark bishops",
      "...Bxf4 (or letting Bxd6 Qxd6 happen) trades off White's best minor piece.",
      "y:d6f4",
    ),
    I(
      "Castle, then ...Ne4",
      "...O-O, then ...Ne4 or ...Rfc8: your pieces are active and your structure is solid.",
      "b:e8g8 b:f6e4",
    ),
  ],
  "Caro-Kann Defense: Panov Attack": [
    I(
      "Play against the isolated pawn",
      "White's d4 pawn is isolated: it gives White space and attacking chances, but it's a long-term weakness. Your plan is to blockade it, trade pieces, then win it.",
      "r:d4 y:d5",
    ),
    I(
      "Blockade d5",
      "Keep a piece on d5, the square in front of the pawn: no pawn can ever chase it from there.",
      "y:d5",
    ),
    I(
      "Trade pieces, then hit d4",
      "Each trade takes the sting out of White's attack and leaves the pawn weaker. ...Nc6, ...O-O and ...Bf6 put pressure on d4.",
      "b:b8c6 b:e7f6 r:d4",
    ),
  ],
  "Caro-Kann Defense: Two Knights": [
    I(
      "Pawns on the light squares",
      "You traded your light bishop for the f3 knight. Keep your pawns on light squares (c6, d5, e6), where White's bishops can't attack them.",
      "y:c6 y:d5 y:e6",
    ),
    I(
      "Close the long diagonal",
      "...d4 kicks the c3 knight and shuts White's d2 bishop out.",
      "g:d5d4 r:c3",
    ),
    I(
      "Queen to b6",
      "...Qb6 hits b2 and f2. Then castle long: White's pawns may come on the kingside.",
      "b:d8b6 r:b2 r:f2",
    ),
  ],
  "Caro-Kann Defense: Fantasy Variation": [
    I(
      "f3 weakened White's dark squares",
      "f3 props up e4, but it takes the knight's best square and weakens the a7-g1 diagonal toward White's king. Your pieces aim at the dark squares.",
      "y:a7g1 b:d8b6",
    ),
    I(
      "Pressure e4",
      "...Bb4 pins the c3 knight, which defends e4. ...dxe4 and ...c5 go after White's centre.",
      "y:b4c3 r:e4 g:c6c5",
    ),
    I(
      "If e5, French-style play",
      "If White pushes e5, ...c5 and ...Ne7-f5 attack d4, which f3 left without its best defender.",
      "g:c6c5 b:g8e7 b:e7f5 r:d4",
    ),
  ],

  // ---- 1...e5 (Black) ----
  "Ruy Lopez: Closed, ...b5 and ...d6": [
    I(
      "Hold e5, take queenside space",
      "The Closed Ruy is about the e5 strongpoint: as long as it stands, White's pieces can't use the centre. Your active plan is on the queenside.",
      "y:e5",
    ),
    I(
      "...Na5 and ...c5",
      "The Chigorin plan: ...Na5 hits the bishop on b3, then ...c5 and ...Qc7 gain queenside space and support e5.",
      "b:c6a5 r:b3 g:c7c5",
    ),
    I(
      "White's plan: d4 and the knight's tour",
      "White plays d4 and Nbd2-f1-g3. ...Bb7 and ...Re8 put pressure on e4 so that d4 is harder to play.",
      "r:d2d4 b:c8b7 b:f8e8",
    ),
  ],
  "Ruy Lopez: Exchange, ...f6": [
    I(
      "Bishops against structure",
      "White gave up the Ruy bishop and has the better pawn structure: four pawns against three on the kingside, while your doubled c-pawns can't make a passed pawn. You have the two bishops. Keep pieces on and the position open.",
      "y:c8 y:f8 r:e4",
    ),
    I(
      "Fast development after the queen trade",
      "After Nb3 Qxd1 Rxd1, ...Bg4 and ...O-O-O get your pieces out with tempo.",
      "b:c8g4 b:e8c8",
    ),
    I(
      "Avoid pawn endgames",
      "With fewer pieces, White's kingside majority counts more. Trade pawns, not bishops.",
      "r:f2 y:e4",
    ),
  ],
  "Italian Game: Two Knights, d3 and ...Bc5": [
    I(
      "The slow game, from Black's side",
      "White's c3-d3 Italian is slow; so is your setup. Your freeing break is ...d5, when your pieces are ready for it.",
      "g:d6d5",
    ),
    I(
      "Keep your bishop, challenge White's",
      "...Ba7 keeps your bishop safe from d4; ...Be6 challenges White's bishop on c4. ...a4 next stops White's b4 ideas.",
      "b:c5a7 b:c8e6 g:a5a4",
    ),
    I(
      "Knight to g6",
      "...Ne7-g6 brings the queen's knight to the kingside, where your king needs it.",
      "b:c6e7 b:e7g6",
    ),
  ],
  "Two Knights Defense: Ng5, ...Na5 main line": [
    I(
      "Development and space for the pawn",
      "You're a pawn down but ahead in development, and your e4 pawn cramps White: the f3 square is gone and White's pieces are boxed in. Use the time.",
      "y:e4",
    ),
    I(
      "Bring the pieces out",
      "...Bd6 or ...Bc5 and ...O-O, then ...Qc7 or ...Qd4 against the e5 knight and f2.",
      "b:f8d6 r:e5 r:f2",
    ),
    I(
      "The a5 knight comes back",
      "The knight on a5 is offside; ...c5 and ...Nc6, or ...Nb7, brings it back into play.",
      "g:c6c5 b:a5c6",
    ),
  ],
  "Scotch Game: Mieses, ...Qe7": [
    I(
      "Bishops and pressure for the pawn structure",
      "Your queenside pawns are broken up, but your pieces are active. The plan is to pressure White's two advanced pawns: c4 and e5.",
      "r:c4 r:e5",
    ),
    I(
      "Pressure c4",
      "Your bishop on a6 and knight on d5 aim at c4. ...Nb6 adds another attacker.",
      "y:a6c4 b:d5b6 r:c4",
    ),
    I(
      "Undermine e5",
      "...g6, ...Bg7 and ...O-O, then ...d6 or ...f6 to break the e5 pawn.",
      "g:g7g6 b:f8g7 g:d7d6",
    ),
  ],
  "Four Knights Game: Scotch, ...Bb4": [
    I(
      "Your centre pawn and the b-file",
      "You have a pawn on d5 and the half-open b-file; White has the cleaner structure. Use the activity: ...Rb8 hits b2.",
      "y:d5 b:a8b8 y:b8b2",
    ),
    I(
      "Ask the bishop",
      "...h6 asks the g5 bishop to decide; then ...Bd6 and ...Re8.",
      "g:h7h6 r:g5 b:b4d6",
    ),
  ],
  "Vienna Game: Vienna Gambit, ...d5": [
    I(
      "Your knight on e4",
      "Your knight on e4 is a monster in the centre. Keep it there, and challenge White's advanced e5 pawn.",
      "y:e4 r:e5",
    ),
    I(
      "Break with ...f6 and ...c5",
      "...f6 breaks the e5 pawn and, after ...O-O, opens the f-file for your rook. When White plays d4, ...c5 hits it.",
      "g:f7f6 b:e8g8 g:c7c5",
    ),
    I(
      "Pin the defender",
      "...Bg4 pins the f3 knight, the main defender of e5.",
      "b:c8g4 r:f3 r:e5",
    ),
  ],
  "King's Gambit Accepted: Modern, ...d5": [
    I(
      "Keep the f4 pawn",
      "Your f4 pawn cramps White and blocks the c1 bishop. ...Bd6 and ...O-O keep it; giving it back for free hands White the initiative.",
      "b:f8d6 y:f4",
    ),
    I(
      "Watch f7",
      "White's bishop on c4 hits your d5 knight, with f7 behind it. ...Be6 covers both.",
      "r:c4d5 y:f7 b:c8e6",
    ),
  ],

  // ---- King's Indian (Black) ----
  "King's Indian Defense: Mar del Plata, ...Ne7 and ...f5": [
    I(
      "The King's Indian race",
      "The centre is closed. White plays on the queenside (c5), you play on the kingside, and whoever gets there first usually wins. Don't stop to defend the queenside.",
      "r:c4c5 y:g2",
    ),
    I(
      "The pawn storm",
      "...f4 locks the centre, then ...g5-g4 breaks open White's king.",
      "g:f5f4 g:g6g5 g:g5g4",
    ),
    I(
      "Bring the knights",
      "...Nf6, and ...Ng6 once ...g5 has cleared the square, support the storm.",
      "b:d7f6 b:e7g6",
    ),
  ],
  "King's Indian Defense: Exchange, queens off": [
    I(
      "A symmetrical endgame, and the d4 hole",
      "With queens off and the d-file open, the game is about squares. d4 is a great square for your knight (...Na6-c5 or ...Nc6-d4); White's version, d5, can be covered with ...c6.",
      "b:b8a6 b:a6c5 y:d4",
    ),
    I(
      "...h6 and ...c6",
      "...h6 asks the g5 bishop; ...c6 keeps White's knights out of d5 and b5.",
      "g:h7h6 g:c7c6",
    ),
  ],
  "King's Indian Defense: Petrosian, d5 and Bg5": [
    I(
      "White's pin is the problem",
      "Petrosian's Bg5 pins your f6 knight, so the usual ...Nh5 and ...f5 plan is slower. Free the knight first: ...Qe8 breaks the pin, ...h6 and ...g5 kicks the bishop.",
      "b:d8e8 r:h4",
    ),
    I(
      "...Nc5 and the kingside",
      "...Nc5 hits e4; ...g5 and ...Nh5-f4 is the kingside plan.",
      "b:a6c5 r:e4 g:g6g5 b:f6h5 b:h5f4",
    ),
  ],
  "King's Indian Defense: Sämisch, ...c5 gambit": [
    I(
      "Activity for the pawn",
      "You gave a pawn for development and the open d-file. Use every tempo: ...Nd7 hits the c5 bishop, ...Be6 and the rooks follow.",
      "b:f6d7 r:c5",
    ),
    I(
      "The long diagonal",
      "Your g7 bishop has the long diagonal. When the f6 knight moves, it hits c3 and b2.",
      "y:g7b2",
    ),
    I(
      "Watch Nd5",
      "Nd5 eyes e7 and c7. ...e6 or ...Nxd5 deals with it.",
      "r:c3d5",
    ),
  ],
  "King's Indian Defense: Four Pawns Attack": [
    I(
      "Pressure White's big centre",
      "White's four pawns are impressive but overextended. Your rook on e8 and knight on f6 hit e4; ...Na6-c7 and ...b5 come next.",
      "r:e4 b:b8a6 b:a6c7",
    ),
    I(
      "Watch e5",
      "White's e5 push is the danger. Answer ...dxe5 fxe5 Ng4, attacking e5 again.",
      "r:e4e5 b:f6g4",
    ),
    I(
      "Queenside majority",
      "You have more pawns on the queenside: ...b5 gets them moving.",
      "g:b7b5",
    ),
  ],
  "King's Indian Defense: Averbakh, Bg5": [
    I(
      "A Benoni structure",
      "...c5 and ...e6 turn this into a Benoni: after ...exd5, the e-file and pressure on e4 are yours, and the queenside is where your pawns advance.",
      "g:e6d5 b:f8e8 r:e4",
    ),
    I(
      "Queenside space",
      "...a6 and ...b5 gain space against White's c4.",
      "g:a7a6 g:b7b5",
    ),
    I(
      "Watch h6",
      "Qd2 lines up against h6 (Bxh6). ...Kh7 or ...h5 sidesteps it.",
      "r:e3h6 b:g8h7",
    ),
  ],
  "King's Indian Defense: Fianchetto, ...Nbd7 and ...e5": [
    I(
      "Keep the tension, pressure the centre",
      "Against the Fianchetto, your pieces work on d4 and e4. ...Qb6 hits d4 and b2; ...exd4 and ...Re8 add pressure on e4.",
      "r:d4 r:b2 g:e5d4",
    ),
    I(
      "Watch c5",
      "White's sharpest answer is c5, hitting your queen. ...dxc5 dxe5 Ne8: the knight comes back to c7 or d6.",
      "r:c4c5",
    ),
  ],
  "London System: King's Indian setup, ...Nbd7 and ...e5": [
    I(
      "You've got ...e5 in",
      "Against the London, ...e5 is your main goal, and you've achieved it. Now ...e4 gains space and kicks the f3 knight, opening the way for a kingside attack.",
      "g:e5e4 r:f3",
    ),
    I(
      "...Ne4",
      "...Ne4 jumps into the centre at once.",
      "b:f6e4",
    ),
    I(
      "The e-file",
      "...exd4 opens the e-file for your queen on e8.",
      "g:e5d4 y:e8e3",
    ),
  ],
  "Torre Attack: King's Indian setup": [
    I(
      "Space, and break the pin",
      "Your King's Indian setup has ...e5 in, so you're fighting for space. White's main idea is the Torre bishop pinning your f6 knight: ...g5 kicks it, which is what ...h6 prepared.",
      "g:g6g5 r:h4",
    ),
    I(
      "...Re8 and ...e4",
      "...Re8 supports ...e4, gaining space and kicking the f3 knight.",
      "b:f8e8 g:e5e4 r:f3",
    ),
  ],
  "English Opening: Botvinnik setup vs the King's Indian": [
    I(
      "White's grip on d5",
      "The Botvinnik setup (c4 and e4) grips d5. ...c6 already took it away; your play is on the queenside with ...a6 and ...b5 against c4.",
      "y:d5 g:a7a6 g:b7b5",
    ),
    I(
      "Knight route",
      "...Na6-c7 brings the knight to support ...b5.",
      "b:b8a6 b:a6c7",
    ),
    I(
      "Watch f4",
      "White's kingside plan is f4. Take with ...exf4 when it comes.",
      "r:f2f4",
    ),
  ],

  // ---- King's Indian: punishing White (Black) ----
  "King's Indian Defense: Mar del Plata, 10.f3 and the ...g5 storm": [
    I(
      "The race is on",
      "The centre is locked, so each side attacks where its pawns point. White has c5 in and will open the c-file with cxd6 and Nb5 against c7. Your attack on the kingside is usually faster: don't spend moves on the queenside unless c7 really falls.",
      "r:c5d6 r:c3b5 r:c7",
    ),
    I(
      "...h5 and ...g4",
      "...h5 then ...g4 opens lines at White's king. The knights on f6 and g6 are already in place, and ...Rf7 helps twice: it guards c7 along the seventh rank and can swing to g7 once the g-file opens.",
      "g:h7h5 g:g5g4 r:f3 b:f8f7",
    ),
    I(
      "When Nb5 comes",
      "After cxd6 cxd6, Nb5 hits d6 and eyes c7. ...Ne8 or ...Rf7 holds both; then go straight back to ...g4.",
      "r:c3b5 b:f6e8 y:c7",
    ),
  ],
  "King's Indian Defense: Bayonet, 9.b4 Nh5": [
    I(
      "Kick the knight with ...h6",
      "Ng5 eyes e6 and f7. ...h6 sends it away; if it jumps to e6, take it: ...Bxe6 dxe6, and the e6 pawn is cut off from White's chain and becomes a target.",
      "g:h7h6 r:g5e6 b:c8e6",
    ),
    I(
      "Then ...fxe4 and ...d5",
      "With the knight gone, trade on e4 (...fxe4) and push ...d5 once the square is free. Your centre rolls forward and the g7 bishop's diagonal opens toward c3 and a1.",
      "g:f5e4 g:d6d5 y:g7a1",
    ),
    I(
      "White's queenside: c5 and b5",
      "White's plan is c5 and b5 to open lines on your queenside. ...c6 already asked d5 the question; take back toward the centre (...cxd5) so the c-file opens for you too.",
      "r:c4c5 r:b4b5 g:c6d5",
    ),
  ],
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 main line": [
    I(
      "Play where your pawns point",
      "d5 closed the centre. Your f5 and g5 pawns point at White's king, so that's where you play; White's play is c5 on the queenside.",
      "y:f5 y:g5 r:c4c5",
    ),
    I(
      "A knight to f4",
      "Bring the e7 knight to g6 and on to f4, where it hits e2, g2 and d3. It's so strong there that White often gives the g3 bishop for it.",
      "b:e7g6 b:g6f4 y:f4",
    ),
    I(
      "If exf5, take with the bishop",
      "exf5 Bxf5 gives your light bishop a fine diagonal, and Nde4 is met by ...Ng6, heading for f4 again.",
      "r:e4f5 b:c8f5",
    ),
  ],
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 9.Qd2?": [
    I(
      "Qd2 gave you the bishop pair",
      "Qd2 left the e3 bishop to be taken: ...Nxe3 fxe3 won you the bishop pair, and after ...exd4 exd4 the d4 pawn has no e3 pawn behind it. Now everything hits d4: the g7 bishop, the c6 knight, and ...Bg4, which threatens to take its defender on f3.",
      "y:g7d4 r:d4 b:c6d4 r:g4f3",
    ),
    I(
      "If d5, ...Bxf3 and ...Nd4",
      "d5 is White's best, kicking the knight. Answer ...Bxf3 and ...Nd4: the knight sits on d4 for good, and ...Qh4 and ...f5 go after White's loosened king.",
      "g:g4f3 b:c6d4 b:d8h4 g:f7f5",
    ),
  ],
  "King's Indian Defense: Orthodox, 8.Be3 Ng4 9.Bc1?": [
    I(
      "The rook on f2 is pinned",
      "Retreating the bishop let ...exd4 and ...Nxf2 through, and now the d4 bishop pins the f2 rook to White's king. Pile up on it: ...fxe4 opens the f-file for your f8 rook.",
      "y:d4g1 r:f2 g:f5e4 y:f8f2",
    ),
    I(
      "Keep the pin until it pays",
      "You're a pawn up and the pin costs White time. Develop with ...Be6; don't trade the d4 bishop for a minor piece, which just lets the rook go.",
      "b:c8e6 y:d4",
    ),
  ],
  "King's Indian Defense: Orthodox, 8.Bg5 and 10.Bg3?": [
    I(
      "The g7 bishop won the pawn",
      "Bg3 took the pin off your f6 knight, and ...exd4 and ...Nxe4 worked because the g7 bishop x-rays d4 and c3: White couldn't take back on e4 without dropping the d4 knight. You're a clean pawn up, White's c-pawns are doubled, and the bishop already hits c3.",
      "y:g7c3 r:c3 r:c4",
    ),
    I(
      "Go after c4",
      "...Be6 and ...Rb8 gang up on the queenside pawns; the b-file is half-open for your rook.",
      "b:c8e6 r:c4 b:a8b8",
    ),
    I(
      "White's only play: f4",
      "White wants f4 to open lines at your king, aiming at the g5 pawn. f4 also loosens c3: ...Bxc3 often just takes another pawn.",
      "r:f2f4 r:g5 g:g7c3",
    ),
  ],
  "King's Indian Defense: Gligoric, 7.Be3 Ng4 8.Bd2?": [
    I(
      "You're a piece up",
      "...exd4 Nxd4 Bxd4 Bxg4 Qh4 forked the g4 bishop and f2, so you've won a piece. The g4 bishop now hits White's queen, which has to move.",
      "r:g4d1 y:d4f2",
    ),
    I(
      "Trade down, keep it simple",
      "Develop the last pieces (...Nc6 or ...Nd7, ...Be6) and trade when you can: every trade makes the extra piece count more. Nb5 hits your d4 bishop and c7; ...Bb6 is the retreat.",
      "b:b8c6 r:c3b5 b:d4b6",
    ),
  ],
  "King's Indian Defense: Classical, ...exd4 and ...d5": [
    I(
      "...d5 opens the centre for your pieces",
      "f3 held e4, so you hit it again with ...d5. Now the e-file and the long diagonal are open: the g7 bishop and e8 rook aim at White's centre, and ...dxe4 can open them further.",
      "y:g7d4 y:e8e4 g:d5e4",
    ),
    I(
      "Develop with ...Nc6",
      "...Nc6 hits d4 a second time and makes ...Nxd4 a threat. Then ...Be6 and a rook to the open c-file.",
      "b:b8c6 r:d4 b:c8e6",
    ),
    I(
      "Watch the pins",
      "Bg5 pins your f6 knight and Bb5 hits the e8 rook. ...h6 and ...Bd7 deal with them; keep an eye on d5 while you do.",
      "r:c1g5 r:e2b5 g:h7h6",
    ),
  ],
  "King's Indian Defense: Classical, ...exd4 9.Qc2?": [
    I(
      "The e4 knight is pinned",
      "Your f5 bishop pins the e4 knight to White's queen, and the e8 rook hits it too. White has to spend moves holding it (Bd3), and you're already a pawn up.",
      "y:f5c2 r:e4 y:e8e4",
    ),
    I(
      "The d4 bishop runs the board",
      "After Nxe4 Bxd4 the g7 bishop landed on d4 with a pawn in hand, and it's your best piece: it hits b2 and f2. Keep it there; ...c5 supports it.",
      "y:d4b2 y:d4f2 g:c7c5",
    ),
    I(
      "Bring the last knight",
      "...Nc6 and ...Ne5 put the knight on a fine central square, eyeing c4, d3 and f3.",
      "b:b8c6 b:c6e5",
    ),
  ],
  "King's Indian Defense: Classical, ...exd4 9.Bf4?": [
    I(
      "A pawn up, and d4 is tied down",
      "...Nxe4 worked because after Nxe4 Rxe4 your rook and the g7 bishop both hit d4, and the f4 bishop was loose too. Now you're a clean pawn up; keep the pressure on d4.",
      "y:g7d4 y:e4d4 r:d4",
    ),
    I(
      "Develop and target c4",
      "...Nc6 adds to d4 and ...Be6 hits c4. Your queen on e7 backs up the rook on the e-file.",
      "b:b8c6 b:c8e6 r:c4",
    ),
    I(
      "Watch Nb5",
      "Nb5 hits c7. But the knight leaves d4, so your bishop sees b2: ...Bxb2 is often there, or ...Na6 simply covers c7.",
      "r:d4b5 r:c7 y:g7b2",
    ),
  ],
  "King's Indian Defense: Glek, 8.Be3 Ng4": [
    I(
      "The Glek knight's journey",
      "The point of ...Na6 is the route ...Nc5-e6-d4. With the d-file open, d4 is a hole in White's camp, and a knight there is the best piece on the board.",
      "b:a6c5 b:c5e6 b:e6d4 y:d4",
    ),
    I(
      "...Nh5-f4 too",
      "The other knight can head for f4, another hole, by ...Nh5. If White covers both squares with Be3, ...Ne6 and ...Nd4 still come.",
      "b:f6h5 b:h5f4 y:f4",
    ),
    I(
      "White's play",
      "White pushes the queenside (a3, b4, c5) and uses the d-file. ...c6 keeps a White knight off d5.",
      "r:b2b4 r:c4c5 g:c7c6",
    ),
  ],
  "King's Indian Defense: Glek, 8.d5 Nc5": [
    I(
      "d5 gave your knight c5",
      "Closing the centre handed the a6 knight c5, where it hits e4. ...a5 and ...b6 make sure b4 can't kick it, so White has to trade it (Nd2-b3, or Bxc5).",
      "y:c5 r:e4 r:b2b4",
    ),
    I(
      "Then ...Nh5 and ...f5",
      "As in every closed King's Indian, your break is ...f5. ...Nh5 (or ...Nh7) clears the f-pawn's path first.",
      "b:f6h5 g:f7f5",
    ),
    I(
      "If Bxc5",
      "Recapture with the b-pawn (...bxc5): your pawns then hold b4 and d4, and the b-file opens for your rook.",
      "r:e3c5 g:b6c5",
    ),
  ],
  "King's Indian Defense: Glek, queens off and 11.Nd5?": [
    I(
      "A pawn up, with the centre",
      "11.Nd5 left e4 without a guard: ...Nxe4 won the pawn, and Ne7+ and Nxc8 only traded a knight for your bishop. Your knight on e4 and the e5 and f5 pawns own the centre.",
      "y:e4 y:e5 y:f5",
    ),
    I(
      "Roll forward: ...f4 and ...e4",
      "...f4 kicks the e3 bishop, then ...e4 kicks the f3 knight and opens the long diagonal for your g7 bishop.",
      "g:f5f4 g:e5e4 y:g7b2",
    ),
    I(
      "A knight for d3",
      "...Nac5 heads for d3 once ...e4 is in, a knight White can hardly remove.",
      "b:a6c5 b:c5d3",
    ),
  ],
  "King's Indian Defense: Four Pawns, 10.e5 main line": [
    I(
      "...c4+ uncovers the queen",
      "Your queen on b6 and White's king on g1 share a diagonal, blocked only by your c5 pawn. ...c4+ gives check, gains a tempo and frees c5 for a knight.",
      "y:b6g1 g:c5c4",
    ),
    I(
      "Blockade the d-pawn",
      "You're a pawn up, but White's d5 pawn is passed. Put pieces in front of it: ...Bf5, ...Nd7 and a knight to c5 or d6 hold it, and the e5 bishop guards d6.",
      "b:c8f5 b:b8d7 r:d5",
    ),
    I(
      "White's play: the f-file and Bc4",
      "White has the open f-file against f7 and quick development (Bc4, Qd2). ...Bf5 and ...Nd7 cover the light squares; ...h6 asks the g5 bishop.",
      "r:f1f7 r:e2c4",
    ),
  ],
  "King's Indian Defense: Four Pawns, early 9.e5? and 10.Nxd5": [
    I(
      "e5 came too soon",
      "White pushed e5 before taking on d5, so ...Ne4 hit c3 at once and White had to give up the centre. Now e5 is attacked by your c6 knight and g7 bishop.",
      "y:c6e5 y:g7e5 r:e5",
    ),
    I(
      "Take on d5",
      "...Bxd5 cxd5 Qxd5 removes the knight and wins the d5 pawn with a centralised queen.",
      "g:e6d5 b:d8d5",
    ),
    I(
      "If Bxe4",
      "Bxe4 fxe4 opens the f-file for your rook, and the e4 pawn cramps White's kingside.",
      "r:d3e4 y:f8f3",
    ),
  ],
  "King's Indian Defense: Four Pawns, early 9.e5? and 10.cxd5": [
    I(
      "White's king and pawns are a mess",
      "Pushing e5 too early cost White the centre: the king is still on e1, c3 is weak, and the e6 pawn is cut off from the rest.",
      "r:e1 r:c3 r:e6",
    ),
    I(
      "Win the e6 pawn",
      "...Bxe6 takes it at once; ...Qe7 first also hits it and lines up on the e-file against the king.",
      "b:c8e6 b:d8e7",
    ),
    I(
      "Aim at e1 and c3",
      "...Re8 opens the e-file at the uncastled king, and once the f6 knight moves, the g7 bishop hits c3.",
      "y:e8e1 y:g7c3",
    ),
  ],
  "London System: King's Indian, 7.c4 Nh5": [
    I(
      "You took the London bishop",
      "The London's whole idea is the f4 bishop. Without h3 it had no safe retreat, so ...Nh5 hunted it down: you have the bishop pair and White has doubled g-pawns. Open the position for the bishops with ...c5 or ...e5.",
      "y:g7a1 g:c7c5 g:e7e5",
    ),
    I(
      "Mind your kingside",
      "...h6 and ...g5 loosened your king, and with White's h-pawn gone the h-file is half-open toward h6. Keep the g7 bishop and a knight (...Nf6) near the king, and don't rush ...f5.",
      "y:h1h6 b:d7f6",
    ),
  ],
  "London System: King's Indian, ...Qb6 and ...Be6": [
    I(
      "The a-file is yours",
      "Qb3 offered a queen trade, and ...Be6 made White take on your terms: after axb6 your rook owns the a-file, and a2 is attacked twice (rook and e6 bishop) and defended once. If White doesn't deal with it (a3), ...Rxa2.",
      "y:a8a2 y:e6a2 r:a2",
    ),
    I(
      "...Nd5 hits the London bishop",
      "After a3, ...cxd4 and ...Nd5: the knight hits the f4 bishop and c3, and ...Nc6 follows.",
      "b:f6d5 r:f4 b:b8c6",
    ),
    I(
      "The doubled b-pawns are fine",
      "The b6 pawn covers c5 and a5 and isn't easy to attack. The half-open a-file is worth far more.",
      "y:b6",
    ),
  ],

  // ---- Queen's Gambit Declined (Black) ----
  "Queen's Gambit Declined: Tartakower": [
    I(
      "The Tartakower plan",
      "...b6 was for this: ...Bb7, then ...c5. You often end up with 'hanging pawns' on c5 and d5: active, but they need piece support.",
      "b:c8b7 g:c7c5",
    ),
    I(
      "Trade on c3",
      "...Nxc3 bxc3 leaves White with a weak c-pawn.",
      "b:d5c3",
    ),
  ],
  "Queen's Gambit Declined: Exchange, Carlsbad": [
    I(
      "The Carlsbad structure",
      "White will play the minority attack, b4-b5 against your c6 pawn. Don't panic: answer b5 with ...c5 or by trading on b5.",
      "r:b2b4 r:b4b5",
    ),
    I(
      "Your play is the kingside",
      "...Nf8-g6, or ...Ne4 and ...f5: aim your pieces at White's king while White's are on the queenside.",
      "b:d7f8 b:f8g6 b:f6e4",
    ),
  ],
  "Queen's Gambit Declined: Harrwitz Attack, Bf4": [
    I(
      "You got the freeing break in",
      "...c5 is the QGD's freeing break, and your bishop on c5 is active. Develop with pressure: ...Nc6 and ...Qa5 hit c3 and keep White busy.",
      "b:b8c6 b:d8a5",
    ),
    I(
      "The isolated d-pawn",
      "If cxd5 exd5, you get an isolated d-pawn: play actively with ...Ne4 and ...Bg4.",
      "y:d5 b:f6e4",
    ),
  ],
  "Catalan Opening: Open, ...dxc4": [
    I(
      "Neutralise the Catalan bishop",
      "In the Catalan, White's g2 bishop is the key piece. Your b7 bishop faces it along the long diagonal.",
      "y:b7g2",
    ),
    I(
      "...Nbd7 and ...c5",
      "...Nbd7 and ...c5 free your position.",
      "b:b8d7 g:c7c5",
    ),
  ],
  "London System: ...Bd6 and the bishop trade": [
    I(
      "You traded the London bishop",
      "...Bd6 took off White's best piece, the London bishop. Now ...e5 frees your c8 bishop. ...Bg4 and ...Rfe8 come next.",
      "b:c8g4 b:f8e8",
    ),
    I(
      "...e4",
      "...e4 kicks the f3 knight, and your queen on d6 eyes h2.",
      "g:e5e4 r:f3 r:h2",
    ),
  ],
  "Colle-Zukertort System": [
    I(
      "Blunt the b2 bishop",
      "White's b2 bishop aims at your king as soon as the d4 pawn moves (dxc5 or ...cxd4). ...Qc7, ...b6 and ...Bb7 keep it in check.",
      "y:b2g7 b:d8c7",
    ),
    I(
      "...e5",
      "...Qc7 (or ...Qe7) and ...e5 frees your game.",
      "b:d8c7 g:e6e5",
    ),
  ],
};
