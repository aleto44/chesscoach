// Checks that every line in src/openings/book.ts is legal: node scripts/check-book.mjs
import { readFileSync } from "node:fs";
import { Chess } from "chess.js";

const src = readFileSync("src/openings/book.ts", "utf8");
const lines = [...src.matchAll(/L\("([A-E]\d\d)", "([^"]+)", "([^"]+)"\)/g)];
let bad = 0;
const seen = new Map();
for (const [, eco, name, moves] of lines) {
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
  if (seen.has(moves)) console.error(`duplicate line: ${name} / ${seen.get(moves)}`), bad++;
  seen.set(moves, name);
}
console.log(`${lines.length} lines, ${bad} problems`);
process.exit(bad ? 1 : 0);
