// Checks the endgame trainer's positions (src/endgames/positions.ts and the surprise endings in
// surprise.ts) with Stockfish: each "mate" or "promote" position must be winning for the student's
// side, each "convert" one clearly better, each "draw" one level. Surprise endings must have ideas,
// and every arrow in their drawings must start on a piece or where an earlier arrow of that idea ends.
// Usage: node scripts/check-endgames.mjs
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { Chess } from "chess.js";

const src = ["positions.ts", "surprise.ts"].map((f) => readFileSync(new URL(`../src/endgames/${f}`, import.meta.url), "utf8")).join("\n");
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

let failed = 0;
// Node runs the TypeScript directly (its imports are type-only).
const { SURPRISES } = await import(new URL("../src/endgames/surprise.ts", import.meta.url));
for (const e of SURPRISES) {
  if (!e.ideas?.length) {
    failed++;
    console.log(`FAIL ${e.id}: no ideas`);
  }
  const board = new Chess(e.fen);
  for (const idea of e.ideas ?? []) {
    const ends = new Set();
    for (const token of idea.draw.split(" ").filter(Boolean)) {
      const [b, sq] = token.split(":");
      const squares = sq.length === 4 ? [sq.slice(0, 2), sq.slice(2)] : [sq];
      const bad = !"gbry".includes(b) || squares.some((x) => !/^[a-h][1-8]$/.test(x)) || (squares.length === 2 && !board.get(squares[0]) && !ends.has(squares[0]));
      if (bad) {
        failed++;
        console.log(`FAIL ${e.id}: "${idea.title}" draws ${token}, which doesn't start on a piece`);
      }
      if (squares.length === 2) ends.add(squares[1]);
    }
  }
}

send("uci");
await until((l) => l === "uciok");
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
  const better = score.kind === "mate" ? v > 0 : v >= 100;
  const ok = p.goal === "draw" ? level : p.goal === "convert" ? better : winning;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${p.id.padEnd(22)} ${p.goal.padEnd(8)} ${score.kind === "mate" ? `mate ${v}` : `${v} cp`} (student's view)`);
}
engine.kill();
process.exit(failed ? 1 : 0);
