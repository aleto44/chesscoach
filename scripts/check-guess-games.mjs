// Replays the guess-the-move games (src/guess/games.ts) with chess.js: every move must be legal and
// each game must end in checkmate. Usage: node scripts/check-guess-games.mjs
import { readFileSync } from "node:fs";
import { Chess } from "chess.js";

const src = readFileSync(new URL("../src/guess/games.ts", import.meta.url), "utf8");
const games = [...src.matchAll(/id: "([^"]+)"[\s\S]*?moves:\s*"([^"]+)"/g)].map((m) => ({ id: m[1], moves: m[2] }));
let failed = 0;
for (const g of games) {
  const chess = new Chess();
  const sans = g.moves.split(/\s+/).map((t) => t.replace(/^\d+\.+/, "")).filter(Boolean);
  try {
    for (const san of sans) chess.move(san);
    const ok = chess.isCheckmate();
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${g.id.padEnd(18)} ${sans.length} plies${ok ? ", ends in mate" : ", no mate at the end"}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${g.id.padEnd(18)} ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
