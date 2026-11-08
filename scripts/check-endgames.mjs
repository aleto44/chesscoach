// Checks the endgame trainer's positions (src/endgames/positions.ts) with Stockfish: each "mate" or
// "promote" position must be winning for the student's side, each "draw" one must be level.
// Usage: node scripts/check-endgames.mjs
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { Chess } from "chess.js";

const src = readFileSync(new URL("../src/endgames/positions.ts", import.meta.url), "utf8");
const positions = [...src.matchAll(/id: "([^"]+)"[\s\S]*?fen: "([^"]+)",\s*side: "(white|black)",\s*goal: "(\w+)"/g)].map((m) => ({
  id: m[1],
  fen: m[2],
  side: m[3],
  goal: m[4],
}));

const engine = spawn(process.execPath, [new URL("../node_modules/stockfish/bin/stockfish-19-lite-single.js", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")]);
let buffer = "";
let waiter = null;
engine.stdout.on("data", (d) => {
  buffer += d;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    waiter?.(line);
  }
});
const send = (cmd) => engine.stdin.write(cmd + "\n");
const until = (pred, onLine = () => {}) =>
  new Promise((resolve) => {
    waiter = (l) => {
      onLine(l);
      if (pred(l)) {
        waiter = null;
        resolve(l);
      }
    };
  });

send("uci");
await until((l) => l === "uciok");
let failed = 0;
for (const p of positions) {
  new Chess(p.fen); // throws on a bad FEN
  let score = null;
  send("ucinewgame");
  send(`position fen ${p.fen}`);
  send("go depth 24");
  await until(
    (l) => l.startsWith("bestmove"),
    (l) => {
      const m = l.match(/score (cp|mate) (-?\d+)/);
      if (m) score = { kind: m[1], v: Number(m[2]) };
    },
  );
  // Score is from the side to move; turn it to the student's side.
  const sign = p.fen.split(" ")[1] === (p.side === "white" ? "w" : "b") ? 1 : -1;
  const v = score.v * sign;
  const winning = score.kind === "mate" ? v > 0 : v >= 300;
  // Fortress draws (wrong bishop) show a material edge without tablebases; anything near a pawn is held.
  const level = score.kind === "cp" && Math.abs(v) <= 150;
  const ok = p.goal === "draw" ? level : winning;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${p.id.padEnd(22)} ${p.goal.padEnd(8)} ${score.kind === "mate" ? `mate ${v}` : `${v} cp`} (student's view)`);
}
engine.kill();
process.exit(failed ? 1 : 0);
