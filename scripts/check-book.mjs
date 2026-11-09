// Checks that every line in the book and the opening training sets is legal, and that every training
// line has a plan whose drawings fit its final position: node scripts/check-book.mjs
import { readFileSync } from "node:fs";
import { Chess } from "chess.js";
import { PLANS } from "../src/openings/plans.ts";

const src = readFileSync("src/openings/book.ts", "utf8") + readFileSync("src/openings/training.ts", "utf8");
const lines = [...src.matchAll(/([LT])\("([A-E]\d\d)", "([^"]+)", "([^"]+)"(?:, \d+)?\)/g)];
let bad = 0;
const seen = new Map();
for (const [, kind, eco, name, moves] of lines) {
  const chess = new Chess();
  for (const m of moves.split(" ")) {
    try {
      chess.move(m);
    } catch {
      console.error(`${eco} ${name}: illegal ${m} after ${chess.history().join(" ")}`);
      bad++;
      break;
    }
  }
  // A training line that stops on a check leaves the student with a forced reply and no book move.
  if (kind === "T" && moves.split(" ").at(-1).includes("+")) console.error(`${eco} ${name}: ends on a check, add the answer`), bad++;
  if (kind === "T") bad += checkPlan(name, chess);
  if (seen.has(moves)) console.error(`duplicate line: ${name} / ${seen.get(moves)}`), bad++;
  seen.set(moves, name);
}
for (const name of Object.keys(PLANS))
  if (!lines.some(([, kind, , n]) => kind === "T" && n === name)) console.error(`plan for an unknown line: ${name}`), bad++;
console.log(`${lines.length} lines, ${bad} problems`);

/** Each drawing starts on a piece, or where an earlier arrow of the same idea ends (a route). */
function checkPlan(name, chess) {
  const ideas = PLANS[name];
  if (!ideas?.length) return console.error(`${name}: no plan`), 1;
  let problems = 0;
  for (const idea of ideas) {
    if (!idea.title || !idea.text) console.error(`${name}: an idea without title or text`), problems++;
    const reached = new Set();
    for (const token of idea.draw.split(" ").filter(Boolean)) {
      const m = token.match(/^([gbry]):([a-h][1-8])([a-h][1-8])?$/);
      if (!m) {
        console.error(`${name} / ${idea.title}: bad drawing "${token}"`), problems++;
        continue;
      }
      const [, brush, from, to] = m;
      // Circles and yellow lines (a diagonal, a file) may mark any square.
      if (to && brush !== "y" && !chess.get(from) && !reached.has(from))
        console.error(`${name} / ${idea.title}: "${token}" starts on an empty square`), problems++;
      if (to) reached.add(to);
    }
  }
  return problems;
}
process.exit(bad ? 1 : 0);
