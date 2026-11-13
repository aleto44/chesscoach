// "Win it again": the moments in the student's own games where they were clearly better and didn't
// win, or worse but holding and went on to lose, played out again from there against Stockfish.
// They run in the endgame trainer's session (endgames/session.ts) as positions of its own, with the
// bars set from the game's eval: club players drop more points by not converting and by collapsing
// in worse positions than by any single missed tactic.
import type { Endgame } from "../endgames/positions";
import { forStudent, gameNote, outcome, type TrainingGame } from "../training/games";

/** Student's view, centipawns: from here it's "clearly better", worth converting. */
const BETTER = 300;
/** A worse position that's still holdable lies in this range. */
const WORSE: [number, number] = [-250, -60];
/** Past this the worse position has collapsed. */
const COLLAPSED = -400;
/** The opening isn't the point here. */
const MIN_PLY = 10;

const pawns = (cp: number) => (Math.abs(cp) >= 9000 ? (cp > 0 ? "mate on the board" : "mated") : `${cp >= 0 ? "+" : "−"}${(Math.abs(cp) / 100).toFixed(1)}`);
const moveNo = (ply: number) => Math.ceil(ply / 2);

export interface GamePositions {
  convert: Endgame[];
  defend: Endgame[];
}

/** The student's moves with an eval, as (ply, fen, student's-view eval before the move). */
function studentEvals(g: TrainingGame) {
  return g.moves
    .filter((m) => m.byStudent && m.evalBefore !== null && m.ply >= MIN_PLY)
    .map((m) => ({ ply: m.ply, fen: m.fenBefore, cp: forStudent(m.evalBefore!, g.color) }));
}

/** The first moment the student was clearly better in a game they didn't win. */
function convertFrom(g: TrainingGame): Endgame | null {
  if (outcome(g) === "won") return null;
  const evals = studentEvals(g);
  const at = evals.find((e) => e.cp >= BETTER);
  if (!at) return null;
  const mate = at.cp >= 9000;
  return {
    id: `g${g.id}-${at.ply}`,
    group: "From your games",
    name: `Move ${moveNo(at.ply)}, ${pawns(at.cp)}`,
    fen: at.fen,
    side: g.color,
    goal: mate ? "mate" : "convert",
    moves: mate ? 30 : undefined,
    winAt: Math.min(Math.max(600, at.cp + 300), 1500),
    failBelow: Math.min(300, Math.max(100, Math.round(at.cp * 0.4))),
    hint: mate
      ? "There's a forced mate here. Checks first, then captures, then threats."
      : "Ahead, trade pieces (not pawns), take away the counterplay before grabbing more, and check what the opponent threatens before every move.",
    level: 2,
    note: gameNote(g),
  };
}

/** The start of the stretch where the student was worse but holding, before it fell apart, in a lost game. */
function defendFrom(g: TrainingGame): Endgame | null {
  if (outcome(g) !== "lost") return null;
  const evals = studentEvals(g);
  const fell = evals.findIndex((e) => e.cp <= COLLAPSED);
  if (fell <= 0) return null;
  let start = fell - 1;
  if (evals[start].cp < WORSE[0] || evals[start].cp > WORSE[1]) return null;
  while (start > 0 && evals[start - 1].cp >= WORSE[0] && evals[start - 1].cp <= WORSE[1]) start--;
  const at = evals[start];
  return {
    id: `g${g.id}-${at.ply}`,
    group: "From your games",
    name: `Move ${moveNo(at.ply)}, ${pawns(at.cp)}`,
    fen: at.fen,
    side: g.color,
    goal: "draw",
    moves: 15,
    lostAt: Math.min(COLLAPSED, at.cp - 250),
    hint: "Worse but not lost: trade the attacking pieces, keep your pawns together, look for activity instead of waiting, and check every capture and check your opponent has.",
    level: 2,
    note: gameNote(g),
  };
}

/** Newest games first; one position of each kind per game at most. */
export function gamePositions(games: TrainingGame[]): GamePositions {
  const convert: Endgame[] = [];
  const defend: Endgame[] = [];
  for (const g of games) {
    const c = convertFrom(g);
    if (c) convert.push(c);
    const d = defendFrom(g);
    if (d) defend.push(d);
  }
  return { convert, defend };
}
