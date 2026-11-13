// The endgame trainer's positions: the standard ones every player should be able to win (or hold)
// against best defence. Each was checked with Stockfish (scripts/check-endgames.mjs): the wins
// are wins, the draws are draws.
import type { Color } from "../store";

export type EndgameGoal =
  /** Deliver checkmate. */
  | "mate"
  /** Promote a pawn and keep the win. */
  | "promote"
  /** Hold the draw: reach a drawn result, or survive `moves` moves without losing. */
  | "draw"
  /** Turn an advantage into a decisive one (mate, or the engine's eval reaching `winAt`). */
  | "convert";

export interface Endgame {
  id: string;
  group: "Basic mates" | "Pawn endings" | "Rook endings" | "Minor pieces" | "Queen endings" | "From your games";
  name: string;
  fen: string;
  /** The side the student plays. The engine moves first when it's the other side's turn. */
  side: Color;
  goal: EndgameGoal;
  /** For draws: how many of the student's moves to survive. For mates: how many moves the mate may take (default 50). */
  moves?: number;
  /** One line on how to do it, shown on request. */
  hint: string;
  level: 1 | 2 | 3;
  /** Positions from the student's games (convert/positions.ts) set their own bars, student's view, centipawns. */
  /** Convert: below this the advantage is gone (default 150). */
  failBelow?: number;
  /** Convert: at or above this it's decisive and the try is won (default 600). */
  winAt?: number;
  /** Draw: at or below this it's lost (default −400). */
  lostAt?: number;
  /** Where the position came from, shown above the board ("Your game, 12 Oct: you drew it"). */
  note?: string;
}

export const ENDGAMES: Endgame[] = [
  {
    id: "kq-k",
    group: "Basic mates",
    name: "Queen and king vs king",
    fen: "8/8/8/4k3/8/8/8/3QK3 w - - 0 1",
    side: "white",
    goal: "mate",
    hint: "Use the queen a knight's move away from the king to shrink its box, bring your king up, and watch for stalemate.",
    level: 1,
  },
  {
    id: "kr-k",
    group: "Basic mates",
    name: "Rook and king vs king",
    fen: "8/8/8/4k3/8/8/8/R3K3 w - - 0 1",
    side: "white",
    goal: "mate",
    hint: "Cut the king off with the rook, walk your king up into opposition, then check along the edge. Waiting rook moves keep the opposition.",
    level: 1,
  },
  {
    id: "kbb-k",
    group: "Basic mates",
    name: "Two bishops vs king",
    fen: "8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1",
    side: "white",
    goal: "mate",
    hint: "Side by side, the bishops make a wall the king can't cross. Push it to a corner with your king's help; mate comes on the edge.",
    level: 3,
  },
  {
    id: "krr-k",
    group: "Basic mates",
    name: "Two rooks: the ladder",
    fen: "8/8/8/3k4/8/8/8/R3K2R w - - 0 1",
    side: "white",
    goal: "mate",
    hint: "The rooks take turns: one cuts off a rank, the other checks on the next one. When the king comes close to a rook, swing that rook to the far side of the board.",
    level: 1,
  },
  {
    id: "kp-sixth",
    group: "Pawn endings",
    name: "King in front on the sixth",
    fen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1",
    side: "white",
    goal: "promote",
    hint: "With your king on the sixth in front of the pawn, you win whoever is to move. Keep the king ahead of the pawn and take the opposition.",
    level: 1,
  },
  {
    id: "kp-opposition-defend",
    group: "Pawn endings",
    name: "Hold the opposition",
    fen: "8/4k3/8/4K3/4P3/8/8/8 w - - 0 1",
    side: "black",
    goal: "draw",
    moves: 15,
    hint: "Stay in front of the pawn. When the white king steps up, face it (take the opposition); when the pawn reaches the sixth, step straight back.",
    level: 2,
  },
  {
    id: "square",
    group: "Pawn endings",
    name: "Rule of the square",
    fen: "7k/8/8/p7/8/8/8/4K3 w - - 0 1",
    side: "white",
    goal: "draw",
    moves: 8,
    hint: "Draw the square from the pawn to its queening rank. If your king can step into it, the king catches the pawn.",
    level: 1,
  },
  {
    id: "key-squares",
    group: "Pawn endings",
    name: "Key squares",
    fen: "8/4k3/8/8/4K3/8/4P3/8 w - - 0 1",
    side: "white",
    goal: "promote",
    hint: "A pawn on the second to fourth rank has three key squares two ranks ahead of it (here d4, e4, f4). Your king already stands on one: keep the king ahead, win the opposition, and only push the pawn when it's safe.",
    level: 2,
  },
  {
    id: "outside-passer",
    group: "Pawn endings",
    name: "Outside passed pawn",
    fen: "8/8/6p1/4k2p/P6P/4K1P1/8/8 w - - 0 1",
    side: "white",
    goal: "promote",
    hint: "Push the a-pawn to pull the black king away to the queenside, then march your king to the kingside pawns and eat them.",
    level: 2,
  },
  {
    id: "breakthrough",
    group: "Pawn endings",
    name: "Pawn breakthrough",
    fen: "8/ppp5/8/PPP5/8/8/8/K6k w - - 0 1",
    side: "white",
    goal: "promote",
    hint: "Three against three, kings far away: sacrifice the middle pawn first (b6!). Whichever way Black takes, the outside pawn next to it goes through.",
    level: 2,
  },
  {
    id: "lucena",
    group: "Rook endings",
    name: "Lucena: build the bridge",
    fen: "1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1",
    side: "white",
    goal: "promote",
    hint: "Cut the black king off with Rd1, put your rook on the fourth rank, then walk out with the king: the rook blocks the checks.",
    level: 3,
  },
  {
    id: "philidor",
    group: "Rook endings",
    name: "Philidor: the third-rank defence",
    fen: "4k3/8/r7/3KP3/8/8/8/7R b - - 0 1",
    side: "black",
    goal: "draw",
    moves: 20,
    hint: "Keep your rook on the sixth rank so the white king can't come forward. When the pawn moves to the sixth, drop the rook back and check from behind.",
    level: 2,
  },
  {
    id: "vancura",
    group: "Rook endings",
    name: "Vancura: attack from the side",
    fen: "R7/6k1/P4r2/1K6/8/8/8/8 b - - 0 1",
    side: "black",
    goal: "draw",
    moves: 20,
    hint: "Keep your rook on the sixth rank, attacking the a-pawn from the side, so the white rook stays stuck in front of it. When the white king comes near the rook, check it from behind.",
    level: 3,
  },
  {
    id: "wrong-bishop",
    group: "Minor pieces",
    name: "Wrong bishop, rook pawn",
    fen: "k7/8/1K6/P7/8/8/8/2B5 b - - 0 1",
    side: "black",
    goal: "draw",
    moves: 15,
    hint: "The bishop can't control the corner square a8. Get your king to the corner and stay there: it can never be driven out.",
    level: 2,
  },
  {
    id: "opposite-bishops",
    group: "Minor pieces",
    name: "Opposite bishops hold",
    fen: "8/3k4/8/3PK3/2B5/8/8/6b1 b - - 0 1",
    side: "black",
    goal: "draw",
    moves: 15,
    hint: "Your bishop can't be blocked off on the dark squares: blockade the pawn with your king on d6, or watch its path with the bishop, and never give the bishop away.",
    level: 1,
  },
  {
    id: "kq-kp",
    group: "Queen endings",
    name: "Queen vs pawn on the seventh",
    fen: "K7/8/8/8/8/8/3pk3/7Q w - - 0 1",
    side: "white",
    goal: "mate",
    moves: 50,
    hint: "Check, or pin the pawn, until the king has to step in front of it (onto d1). That one tempo lets your king take a step closer. Repeat, then win the pawn and mate.",
    level: 3,
  },
];
