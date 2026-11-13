// Finds the opening trainer's traps ahead of time: node scripts/find-traps.mjs
//
// For every opponent move in every training line, Maia says which other moves players really make
// there (at several ratings) and Stockfish keeps the ones that lose at least a pawn against the book
// move. The result goes to src/openings/traps.ts, which the trainer plays from instantly. Takes a
// few minutes; run it again after adding or changing lines.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Chess } from "chess.js";
import * as ort from "onnxruntime-web";
import { policyFrom, tokens } from "../src/engine/maiaInput.ts";
import { toLichess } from "../src/rating.ts";

/** The ratings (chess.com scale) traps are worked out for; the trainer uses the nearest. */
const BANDS = [800, 1000, 1200, 1400, 1600, 1800, 2000];
/** A move Maia gives less than this chance at a rating isn't one people play there. */
const MIN_P = 0.03;
/** Not before the opponent's this-many-th ply: the line should be under way first. */
const FIRST_PLY = 3;
/** The mistake has to give the student at least this much over the book move (centipawns, about a pawn)… */
const SWING = 90;
/** …and leave the student at least this much ahead. */
const WINNING = 70;
const SCAN_DEPTH = 12;
const DEPTH = 18;

// ---- The lines, read from training.ts the way check-book.mjs does ----

const src = readFileSync("src/openings/training.ts", "utf8");
/** Each set's student color, then its lines. */
const sets = src
  .split(/\n    id: "/)
  .slice(1)
  .map((block) => ({
    id: block.slice(0, block.indexOf('"')),
    color: block.match(/color: "(white|black)"/)?.[1],
    lines: [...block.matchAll(/T\("[A-E]\d\d", "([^"]+)", "([^"]+)"/g)].map(([, name, moves]) => ({ name, moves: moves.split(" ") })),
  }))
  .filter((s) => s.color && s.lines.length);

/** A position without the move counters: the same position reached by another order is the same trap. */
const key = (fen) => fen.split(" ").slice(0, 4).join(" ");

/** Every position where the opponent moves, with every book move played there across the lines. */
const positions = new Map();
for (const set of sets)
  for (const line of set.lines) {
    const chess = new Chess();
    line.moves.forEach((san, ply) => {
      const fen = chess.fen();
      const mover = chess.turn() === "w" ? "white" : "black";
      if (mover !== set.color && ply >= FIRST_PLY) {
        const k = key(fen);
        const p = positions.get(k) ?? { fen, book: new Set(), lines: new Set() };
        p.book.add(chess.move(san).lan);
        chess.undo();
        p.lines.add(line.name);
        positions.set(k, p);
      }
      chess.move(san);
    });
  }

// ---- Engines ----

const maia = await ort.InferenceSession.create("public/maia3/maia3.onnx");
async function policy(fen, rating) {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true }).map((m) => m.lan);
  const elo = new Float32Array([toLichess(rating)]);
  const out = await maia.run({
    tokens: new ort.Tensor("float32", tokens(chess), [1, 64, 12]),
    elo_self: new ort.Tensor("float32", elo, [1]),
    elo_oppo: new ort.Tensor("float32", elo, [1]),
  });
  return policyFrom(out.logits_move.data, legal, chess.turn() === "b");
}

const require = createRequire(import.meta.url);
let pending = null;
let last = null;
const engine = require("stockfish")("lite-single", (line) => {
  if (line.startsWith("info") && line.includes(" pv ") && !line.includes("multipv 2")) last = line;
  if (line.startsWith("bestmove") && pending) {
    const done = pending;
    pending = null;
    done(last);
  }
});
engine.processCommand("uci");
engine.processCommand("setoption name Hash value 64");

/** The eval for the side to move (centipawns, mates as ±(10000 − distance)) and the best line. */
function analyze(fen, depth) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return Promise.resolve({ cp: -10000, pv: [] });
  if (chess.isDraw()) return Promise.resolve({ cp: 0, pv: [] });
  return new Promise((resolve) => {
    last = null;
    pending = (info) => {
      const mate = info?.match(/score mate (-?\d+)/);
      const cp = info?.match(/score cp (-?\d+)/);
      resolve({
        cp: mate ? Math.sign(+mate[1]) * (10000 - Math.abs(+mate[1])) : cp ? +cp[1] : 0,
        pv: info?.match(/ pv (.+)$/)?.[1].split(" ") ?? [],
      });
    };
    engine.processCommand(`position fen ${fen}`);
    engine.processCommand(`go depth ${depth}`);
  });
}

/** The student's eval after the opponent's move `uci` in `fen` (the student is then to move). */
async function afterMove(fen, uci, depth) {
  const chess = new Chess(fen);
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { ...(await analyze(chess.fen(), depth)), fen: chess.fen() };
}

// ---- The search ----

const traps = {};
let n = 0;
const started = Date.now();
for (const [k, pos] of positions) {
  n++;
  // The book move the opponent would rather play: the swing is measured from it.
  let baseline = Infinity;
  for (const uci of pos.book) baseline = Math.min(baseline, (await afterMove(pos.fen, uci, SCAN_DEPTH)).cp);

  // Every move people play here at some rating, with how often at each.
  const byMove = new Map();
  for (const band of BANDS)
    for (const { uci, p } of await policy(pos.fen, band))
      if (p >= MIN_P && !pos.book.has(uci)) byMove.set(uci, { ...byMove.get(uci), [band]: Math.round(p * 1000) / 1000 });

  const found = [];
  for (const [uci, p] of byMove) {
    const scan = await afterMove(pos.fen, uci, SCAN_DEPTH);
    if (scan.cp - baseline < SWING || scan.cp < WINNING) continue;
    const deep = await afterMove(pos.fen, uci, DEPTH);
    const best = deep.pv[0];
    if (deep.cp - baseline < SWING || deep.cp < WINNING || !best) continue;
    const chess = new Chess(pos.fen);
    const mistake = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const reply = chess.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
    // Too plain: the refutation just takes the piece that moved (a capture taken back is fine: the
    // trap is in why the trade goes wrong).
    if (reply.captured && reply.to === mistake.to && !mistake.captured) continue;
    found.push({ san: mistake.san, best: reply.san, bestUci: best, eval: deep.cp, p });
  }
  if (found.length) {
    traps[k] = found;
    console.log(`${n}/${positions.size} ${[...pos.lines][0]}: ${found.map((t) => `${t.san}? ${t.best}!`).join(", ")}`);
  }
}
engine.terminate?.();

const total = Object.values(traps).reduce((t, l) => t + l.length, 0);
writeFileSync(
  "src/openings/traps.ts",
  `// Generated by scripts/find-traps.mjs: don't edit by hand, run it again after changing the lines.
// Mistakes players really make in the training lines' positions (Maia), each losing real material
// (Stockfish, depth ${DEPTH}), keyed by the position before the mistake (FEN without move counters).
import type { Trap } from "./blunders";

export const TRAPS: Record<string, Trap[]> = ${JSON.stringify(traps, null, 1)};
`,
);
console.log(`${total} traps in ${Object.keys(traps).length} of ${positions.size} positions, ${Math.round((Date.now() - started) / 1000)}s`);
