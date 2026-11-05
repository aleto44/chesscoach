// Every rating the student sees is on the chess.com scale (see .github/copilot-instructions.md).
// Lichess numbers (puzzles, Maia's training data) are converted here, both ways.

/** chess.com rapid next to the Lichess rating that's roughly the same level. */
const LICHESS_SCALE: [chessCom: number, lichess: number][] = [
  [400, 900],
  [1000, 1400],
  [1500, 1750],
  [2000, 2100],
  [2500, 2500],
];

/** Piecewise-linear between the table's points, continuing the end segments past the ends. */
function convert(rating: number, from: 0 | 1, to: 0 | 1): number {
  const s = LICHESS_SCALE;
  let i = 1;
  while (i < s.length - 1 && rating > s[i][from]) i++;
  const [a, b] = [s[i - 1], s[i]];
  return a[to] + ((rating - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
}

/** A chess.com-scale rating as the Lichess rating of about the same strength. */
export const toLichess = (chessCom: number) => Math.round(convert(chessCom, 0, 1));
/** A Lichess rating (a puzzle's, the student's puzzle rating) as the chess.com rating shown to the student. */
export const fromLichess = (lichess: number) => Math.round(convert(lichess, 1, 0));
