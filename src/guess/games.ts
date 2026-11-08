// Classic games for "guess the move": short, sharp, and famous for a reason. Each replays to the
// end with chess.js (scripts/check-guess-games.mjs); the last move of each is checkmate.
import type { Color } from "../store";

export interface MasterGame {
  id: string;
  white: string;
  black: string;
  event: string;
  year: number;
  /** The side to guess by default: the winner's. */
  side: Color;
  blurb: string;
  moves: string;
}

export const MASTER_GAMES: MasterGame[] = [
  {
    id: "opera",
    white: "Paul Morphy",
    black: "Duke of Brunswick and Count Isouard",
    event: "Paris Opera",
    year: 1858,
    side: "white",
    blurb: "Fast development, open lines, and a queen sacrifice to finish. The model game for beginners.",
    moves:
      "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8#",
  },
  {
    id: "reti-tartakower",
    white: "Richard Réti",
    black: "Savielly Tartakower",
    event: "Vienna",
    year: 1910,
    side: "white",
    blurb: "Black grabs a pawn and castles too late: a queen sacrifice on d8 and a double check.",
    moves: "1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Nf6 5.Qd3 e5 6.dxe5 Qa5+ 7.Bd2 Qxe5 8.O-O-O Nxe4 9.Qd8+ Kxd8 10.Bg5+ Kc7 11.Bd8#",
  },
  {
    id: "immortal",
    white: "Adolf Anderssen",
    black: "Lionel Kieseritzky",
    event: "London",
    year: 1851,
    side: "white",
    blurb: "The Immortal Game: White gives up both rooks and the queen and mates with three minor pieces.",
    moves:
      "1.e4 e5 2.f4 exf4 3.Bc4 Qh4+ 4.Kf1 b5 5.Bxb5 Nf6 6.Nf3 Qh6 7.d3 Nh5 8.Nh4 Qg5 9.Nf5 c6 10.g4 Nf6 11.Rg1 cxb5 12.h4 Qg6 13.h5 Qg5 14.Qf3 Ng8 15.Bxf4 Qf6 16.Nc3 Bc5 17.Nd5 Qxb2 18.Bd6 Bxg1 19.e5 Qxa1+ 20.Ke2 Na6 21.Nxg7+ Kd8 22.Qf6+ Nxf6 23.Be7#",
  },
  {
    id: "evergreen",
    white: "Adolf Anderssen",
    black: "Jean Dufresne",
    event: "Berlin",
    year: 1852,
    side: "white",
    blurb: "The Evergreen Game: an Evans Gambit, a king in the centre and a famous combination down the open files.",
    moves:
      "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4 Bxb4 5.c3 Ba5 6.d4 exd4 7.O-O d3 8.Qb3 Qf6 9.e5 Qg6 10.Re1 Nge7 11.Ba3 b5 12.Qxb5 Rb8 13.Qa4 Bb6 14.Nbd2 Bb7 15.Ne4 Qf5 16.Bxd3 Qh5 17.Nf6+ gxf6 18.exf6 Rg8 19.Rad1 Qxf3 20.Rxe7+ Nxe7 21.Qxd7+ Kxd7 22.Bf5+ Ke8 23.Bd7+ Kf8 24.Bxe7#",
  },
  {
    id: "lasker-thomas",
    white: "Edward Lasker",
    black: "George Alan Thomas",
    event: "London",
    year: 1912,
    side: "white",
    blurb: "A queen sacrifice on h7 drags the black king all the way to g1.",
    moves:
      "1.d4 e6 2.Nf3 f5 3.Nc3 Nf6 4.Bg5 Be7 5.Bxf6 Bxf6 6.e4 fxe4 7.Nxe4 b6 8.Ne5 O-O 9.Bd3 Bb7 10.Qh5 Qe7 11.Qxh7+ Kxh7 12.Nxf6+ Kh6 13.Neg4+ Kg5 14.h4+ Kf4 15.g3+ Kf3 16.Be2+ Kg2 17.Rh2+ Kg1 18.Kd2#",
  },
];
