// Checks that every line in the book and the opening training sets is legal, and that every training
// line has a plan whose drawings fit its final position: node scripts/check-book.mjs
import { readFileSync } from "node:fs";
import { Chess } from "chess.js";
import { PLANS } from "../src/openings/plans.ts";
import { GUIDES } from "../src/openings/guides.ts";

const training = readFileSync("src/openings/training.ts", "utf8");
const src = readFileSync("src/openings/book.ts", "utf8") + training;
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
  if (kind === "T" && GUIDES[name]) bad += checkGuide(name, moves.split(" "));
  if (seen.has(moves)) console.error(`duplicate line: ${name} / ${seen.get(moves)}`), bad++;
  seen.set(moves, name);
}
for (const name of Object.keys(GUIDES))
  if (!lines.some(([, kind, , n]) => kind === "T" && n === name)) console.error(`notes for an unknown line: ${name}`), bad++;
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
/**
 * A line's move notes (guides.ts) run from their first move without gaps to the student's last move,
 * all for one side, and draw only yellow lines and circles (an arrow would give the move away).
 */
function checkGuide(name, moves) {
  const notes = GUIDES[name];
  const numbers = Object.keys(notes).map(Number).sort((a, b) => a - b);
  let problems = 0;
  // The side the notes are for: the color of the training set the line is in.
  const block = training.split(/\r?\n  \{\r?\n/).find((b) => b.includes(`"${name}"`)) ?? "";
  const black = /color: "black"/.test(block);
  const last = black ? Math.floor(moves.length / 2) : Math.ceil(moves.length / 2);
  for (let n = numbers[0]; n <= last; n++) if (!(n in notes)) console.error(`${name}: no note for move ${n}`), problems++;
  if (numbers.at(-1) > last) console.error(`${name}: a note past the line's end (move ${numbers.at(-1)})`), problems++;
  for (const n of numbers) {
    const draw = Array.isArray(notes[n]) ? notes[n][1] : "";
    for (const token of draw.split(" ").filter(Boolean)) {
      const m = token.match(/^([gbry]):([a-h][1-8])([a-h][1-8])?$/);
      if (!m || (m[3] && m[1] !== "y")) console.error(`${name} / move ${n}: drawing "${token}" (only y: lines and circles)`), problems++;
    }
  }
  return problems;
}
process.exit(bad ? 1 : 0);
