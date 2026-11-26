// Finds the pitfalls in the opening courses ahead of time: node scripts/find-pitfalls.mjs
//
// The other side of find-traps.mjs: for every decision in a course (the student to move), Maia says
// which moves players of each rating really make there, and Stockfish keeps the ones that lose at
// least SWING against the course's answer and leave the student clearly worse. Each comes with the
// punishment played out until the loss is on the board, so the trainer can show the student what
// happens: "Don't get caught". Written to src/openings/pitfalls.ts. Run it again after editing a course.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Chess } from "chess.js";
import * as ort from "onnxruntime-web";
import { policyFrom, tokens } from "../src/engine/maiaInput.ts";
import { toLichess } from "../src/rating.ts";
import { COURSES } from "../src/openings/courses/index.ts";

/** The ratings (chess.com scale) pitfalls are worked out for; the trainer uses the nearest. */
const BANDS = [800, 1000, 1200, 1400, 1600, 1800, 2000];
/** A move Maia gives less than this chance at a rating isn't one people play there. */
const MIN_P = 0.04;
/** It costs at least this much against the answer (centipawns)… */
const SWING = 100;
/** …and leaves the student at least this far behind. */
const LOSING = -80;
const SCAN_DEPTH = 12;
const DEPTH = 18;
/** The punishment is played out at most this far (plies). */
const CONT_PLIES = 11;
const OUT = "src/openings/pitfalls.ts";

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

function analyze(fen, depth) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return Promise.resolve({ cp: -10000, pv: [] });
  if (chess.isDraw()) return Promise.resolve({ cp: 0, pv: [] });
  return new Promise((resolve) => {
    last = null;
    pending = (info) => {
      const mate = info?.match(/score mate (-?\d+)/);
      const cp = info?.match(/score cp (-?\d+)/);
      resolve({ cp: mate ? Math.sign(+mate[1]) * (10000 - Math.abs(+mate[1])) : cp ? +cp[1] : 0, pv: info?.match(/ pv (.+)$/)?.[1].split(" ") ?? [] });
    };
    engine.processCommand(`position fen ${fen}`);
    engine.processCommand(`go depth ${depth}`);
  });
}

const uciMove = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** The student's eval after their move `uci` from `fen`, and the opponent's best line from there. */
async function afterMove(fen, uci, depth) {
  const chess = new Chess(fen);
  uciMove(chess, uci);
  const r = await analyze(chess.fen(), depth);
  return { cp: -r.cp, pv: r.pv };
}

const VALUE = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
function materialFor(chess, color) {
  let n = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) n += (sq.color === color ? 1 : -1) * VALUE[sq.type];
  return n;
}

/**
 * The punishment as the trainer plays it: the opponent's line from after the student's mistake, cut
 * where the loss is on the board (the student a pawn or more down on material, with nothing to take
 * back) or a mate. Without either, the first few moves: the loss is positional.
 */
function refutationOf(fen, mistake, pv) {
  const chess = new Chess(fen);
  const student = chess.turn();
  const base = materialFor(chess, student);
  uciMove(chess, mistake);
  const sans = [];
  for (let i = 0; i < Math.min(pv.length, CONT_PLIES); i++) {
    let m;
    try {
      m = uciMove(chess, pv[i]);
    } catch {
      break;
    }
    sans.push(m.san);
    if (i % 2) continue;
    if (chess.isCheckmate()) return sans;
    const next = pv[i + 1];
    if (base - materialFor(chess, student) >= 100 && !(next && chess.get(next.slice(2, 4)))) return sans;
  }
  return sans.slice(0, 3);
}

const key = (fen) => fen.split(" ").slice(0, 4).join(" ");
const out = {};
let found = 0;
const started = Date.now();
const all = COURSES.flatMap((c) => c.chapters.flatMap((ch) => ch.nodes));
for (const [i, node] of all.entries()) {
  const chess = new Chess();
  for (const m of node.path.split(" ")) chess.move(m);
  const fen = chess.fen();
  const accepted = new Set([node.answer, ...(node.also ?? [])].map((san) => new Chess(fen).move(san).lan));
  const answerUci = new Chess(fen).move(node.answer).lan;
  const base = (await afterMove(fen, answerUci, SCAN_DEPTH)).cp;
  const byMove = new Map();
  for (const band of BANDS)
    for (const { uci, p } of await policy(fen, band))
      if (p >= MIN_P && !accepted.has(uci)) byMove.set(uci, { ...byMove.get(uci), [band]: Math.round(p * 1000) / 1000 });
  // The course's own watch move is kept however rare it is (check-course.mjs checks that it loses).
  const watchUci = node.watch ? new Chess(fen).move(node.watch.move).lan : null;
  if (watchUci && !byMove.has(watchUci)) byMove.set(watchUci, {});
  const list = [];
  for (const [uci, p] of byMove) {
    const watched = uci === watchUci;
    const scan = await afterMove(fen, uci, SCAN_DEPTH);
    if (!watched && (base - scan.cp < SWING || scan.cp > LOSING)) continue;
    const deep = await afterMove(fen, uci, DEPTH);
    const deepBase = (await afterMove(fen, answerUci, DEPTH)).cp;
    if (!deep.pv.length || (!watched && (deepBase - deep.cp < SWING || deep.cp > LOSING))) continue;
    const san = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    list.push({ san, eval: deep.cp, answerEval: deepBase, p, refute: refutationOf(fen, uci, deep.pv) });
  }
  if (list.length) {
    out[key(fen)] = list;
    found += list.length;
  }
  console.log(`${i + 1}/${all.length} ${node.id}: ${list.map((x) => `${x.san}? ${x.refute.join(" ")} (${x.eval})`).join(", ") || "-"}`);
}
engine.terminate?.();

writeFileSync(
  OUT,
  `// Generated by scripts/find-pitfalls.mjs: don't edit by hand, run it again after changing a course.
// Moves players really make at the courses' decisions (Maia) that lose at least a pawn against the
// course's answer and leave them clearly worse (Stockfish, depth ${DEPTH}), keyed by the position
// (FEN without move counters). \`refute\` is the opponent's punishment played out, from the move after.
import type { Pitfall } from "./progress";

export const PITFALLS: Record<string, Pitfall[]> = ${JSON.stringify(out, null, 1)};
`,
);
console.log(`${found} pitfalls at ${Object.keys(out).length} of ${all.length} decisions, ${Math.round((Date.now() - started) / 1000)}s`);
