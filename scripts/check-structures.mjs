// Where the opening trainer's structure cards (src/openings/structures.ts) open along every training
// line, and whether the tactic patterns hold up: every position where one fires, Stockfish has to
// rate the tactic within half a pawn of its best move. node scripts/check-structures.mjs
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { Chess } from "chess.js";
import { STRUCTURES, structuresAt, patternAt } from "../src/openings/structures.ts";

const training = readFileSync("src/openings/training.ts", "utf8");
const blocks = training.split(/\r?\n  \{\r?\n/);
const engine = spawn(process.execPath, [new URL("../node_modules/stockfish/bin/stockfish-19-lite-single.js", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")]);
let buf = "";
let waiter = null;
const out = [];
engine.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    out.push(l);
    if (waiter?.re.test(l)) {
      const w = waiter;
      waiter = null;
      w.res(out.splice(0));
    }
  }
});
const send = (s) => engine.stdin.write(s + "\n");
const wait = (re) => new Promise((res) => (waiter = { re, res }));
/** The engine's score for each of the given first moves (side to move's view, centipawns). */
async function scores(fen) {
  send(`position fen ${fen}`);
  send("go depth 16");
  const lines = await wait(/^bestmove/);
  const best = new Map();
  for (const l of lines) {
    const m = l.match(/multipv (\d+) .*score (cp|mate) (-?\d+).* pv (\S+)/);
    if (m) best.set(m[4], m[2] === "mate" ? Math.sign(+m[3]) * 10000 : +m[3]);
  }
  return best;
}

send("uci");
await wait(/uciok/);
send("setoption name MultiPV value 5");
let bad = 0;
const checked = new Set();
for (const block of blocks) {
  const color = /color: "black"/.test(block) ? "black" : /color: "white"/.test(block) ? "white" : null;
  if (!color) continue;
  for (const [, name, moves] of block.matchAll(/T\("[A-E]\d\d", "([^"]+)", "([^"]+)"/g)) {
    const chess = new Chess();
    const met = [];
    for (const [i, san] of moves.split(" ").entries()) {
      const fen = chess.fen();
      const pattern = patternAt(fen, color);
      if (pattern && !checked.has(fen)) {
        checked.add(fen);
        const s = await scores(fen);
        const top = Math.max(...s.values());
        const move = new Chess(fen).move(pattern.id === "fork-trick" ? "Nxe4" : san);
        const mine = s.get(move.from + move.to);
        const ok = mine !== undefined && top - mine <= 50;
        if (!ok) bad++;
        console.log(`${ok ? "ok " : "BAD"} ${pattern.name} at ${Math.floor(i / 2) + 1}${i % 2 ? "..." : "."} in ${name} (book ${san}; ${mine ?? "not in top 5"} vs best ${top})`);
      }
      chess.move(san);
      for (const s of structuresAt(chess.fen(), color)) if (!met.some((m) => m.id === s.id)) met.push({ id: s.id, at: `${Math.floor(i / 2) + 1}${i % 2 ? "..." : "."}${san}` });
    }
    if (met.length) console.log(`  ${name}: ${met.map((m) => `${m.id} @ ${m.at}`).join(", ")}`);
  }
}
for (const s of STRUCTURES) if (!s.ideas.length) console.error(`${s.id}: no ideas`), bad++;
console.log(`${bad} problems`);
engine.kill();
process.exit(bad ? 1 : 0);
