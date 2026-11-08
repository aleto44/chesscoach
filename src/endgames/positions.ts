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
  | "draw";

export interface Endgame {
  id: string;
  group: "Basic mates" | "Pawn endings" | "Rook endings" | "Minor pieces";
  name: string;
  fen: string;
  /** The side the student plays. The engine moves first when it's the other side's turn. */
  side: Color;
  goal: EndgameGoal;
  /** For draws: how many of the student's moves to survive. */
  moves?: number;
  /** One line on how to do it, shown on request. */
  hint: string;
  level: 1 | 2 | 3;
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
];
