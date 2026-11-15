// Finds the opening trainer's traps ahead of time: node scripts/find-traps.mjs
//
// For every opponent move in every training line, Maia says which other moves players really make
// there (at several ratings) and Stockfish keeps the ones that lose at least a pawn against the book
// move. It also tries detours: a sound move people play instead of the book one, the student's natural
// answer, and the mistakes from there. The result goes to src/openings/traps.ts, which the trainer
// plays from instantly. Takes a while; run it again after adding or changing lines.
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
/** Detours tried from each book position: its commonest sound non-book moves. */
const MAX_LEADS = 3;
/** The student's natural answer on a detour may be this much worse than the engine's (centipawns). */
const REPLY_SLACK = 30;
/** The punishment is played out at most this far (plies, the student's moves and the opponent's). */
const CONT_PLIES = 11;

// node scripts/find-traps.mjs [--set london] [--out file] [--no-detours]
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ONLY_SET = arg("--set");
const OUT = arg("--out") ?? "src/openings/traps.ts";
const DETOURS = !process.argv.includes("--no-detours");

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
  .filter((s) => s.color && s.lines.length && (!ONLY_SET || s.id === ONLY_SET));

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

const uciMove = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const sanOf = (fen, uci) => uciMove(new Chess(fen), uci).san;

/** How often players of each band play each move here (only moves at MIN_P or more), leaving out `skip`. */
async function played(fen, skip = new Set()) {
  const byMove = new Map();
  for (const band of BANDS)
    for (const { uci, p } of await policy(fen, band))
      if (p >= MIN_P && !skip.has(uci)) byMove.set(uci, { ...byMove.get(uci), [band]: Math.round(p * 1000) / 1000 });
  return byMove;
}

/**
 * The mistakes among `byMove` in `fen` (opponent to move): each leaves the student at least SWING over
 * `baseline` (the student's eval after the move the opponent should play) and WINNING overall.
 * `scans` collects the shallow eval of every move looked at, for the detours.
 */
async function mistakesAt(fen, byMove, baseline, scans) {
  const found = [];
  for (const [uci, p] of byMove) {
    const scan = await afterMove(fen, uci, SCAN_DEPTH);
    scans?.set(uci, scan);
    if (scan.cp - baseline < SWING || scan.cp < WINNING) continue;
    const deep = await afterMove(fen, uci, DEPTH);
    const best = deep.pv[0];
    if (deep.cp - baseline < SWING || deep.cp < WINNING || !best) continue;
    const chess = new Chess(fen);
    const mistake = uciMove(chess, uci);
    const reply = uciMove(chess, best);
    // Too plain: the refutation just takes the piece that moved (a capture taken back is fine: the
    // trap is in why the trade goes wrong).
    if (reply.captured && reply.to === mistake.to && !mistake.captured) continue;
    found.push({ san: mistake.san, best: reply.san, bestUci: best, eval: deep.cp, p, cont: contOf(fen, uci, deep.pv) });
  }
  return found;
}

const VALUE = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
/** Material for `color` minus the other side's (centipawns). */
function materialFor(chess, color) {
  let n = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) n += (sq.color === color ? 1 : -1) * VALUE[sq.type];
  return n;
}

/**
 * How far the trainer plays the punishment out: the engine's line `pv` from the student's first move
 * after `mistake` in `fenBefore`, cut where the win is on the board: the student's move after which
 * they're at least a pawn up on material over the position before the mistake, with the opponent's
 * next move no capture (nothing left to take back), or a mate. Without either inside CONT_PLIES, only
 * the first move: the gain is positional, and there's nothing more to play out.
 */
function contOf(fenBefore, mistake, pv) {
  const chess = new Chess(fenBefore);
  const student = chess.turn() === "w" ? "b" : "w";
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
    if (materialFor(chess, student) - base >= 100 && !(next && chess.get(next.slice(2, 4)))) return sans;
  }
  return sans.slice(0, 1);
}

/** The likeliest of a band's moves, by Maia. */
const topMove = async (fen, band) => (await policy(fen, band)).sort((a, b) => b.p - a.p)[0]?.uci;

/** Writes the traps file, which the trainer imports. */
function writeOut(traps, routes) {
  writeFileSync(
    OUT,
    `// Generated by scripts/find-traps.mjs: don't edit by hand, run it again after changing the lines.
// Mistakes players really make in the training lines' positions (Maia), each losing real material
// (Stockfish, depth ${DEPTH}), keyed by the position before the mistake (FEN without move counters).
// ROUTES are the detours to positions one step off the book, keyed by the book position they leave.
import type { Route, Trap } from "./blunders";

export const TRAPS: Record<string, Trap[]> = ${JSON.stringify(traps, null, 1)};

export const ROUTES: Record<string, Route[]> = ${JSON.stringify(routes, null, 1)};
`,
  );
}

// --backfill: only work out the played-out punishment (cont) for the traps already in OUT.
if (process.argv.includes("--backfill")) {
  const stored = readFileSync(OUT, "utf8");
  const objectAfter = (name) => {
    const a = stored.indexOf("= ", stored.indexOf(`export const ${name}`)) + 2;
    return JSON.parse(stored.slice(a, stored.indexOf(";\n", a)));
  };
  const traps = objectAfter("TRAPS");
  let done = 0;
  for (const [k, list] of Object.entries(traps))
    for (const t of list) {
      const fen = `${k} 0 1`;
      const after = new Chess(fen);
      const uci = after.move(t.san).lan;
      const deep = await analyze(after.fen(), DEPTH);
      // The engine's line from the stored punishment, should a deeper look prefer another first move.
      const pv = deep.pv[0] === t.bestUci ? deep.pv : [t.bestUci, ...(await afterMove(after.fen(), t.bestUci, DEPTH)).pv];
      t.cont = contOf(fen, uci, pv);
      process.stdout.write(`
${++done} ${t.san}? ${t.cont.join(" ")}                    `);
    }
  engine.terminate?.();
  writeOut(traps, objectAfter("ROUTES"));
  console.log(`\nbackfilled ${done} traps`);
  process.exit(0);
}

const traps = {};
/** Detours: from a book position, a sound move people play instead of the book one, the student's
 *  natural answer, and then a position where the opponent's mistakes are in `traps`. */
const routes = {};
const detoured = new Set();
let n = 0;
const started = Date.now();
for (const [k, pos] of positions) {
  n++;
  // The book move the opponent would rather play: the swing is measured from it.
  let baseline = Infinity;
  for (const uci of pos.book) baseline = Math.min(baseline, (await afterMove(pos.fen, uci, SCAN_DEPTH)).cp);

  // Every move people play here at some rating, with how often at each.
  const byMove = await played(pos.fen, pos.book);
  const scans = new Map();
  const found = await mistakesAt(pos.fen, byMove, baseline, scans);
  if (found.length) {
    traps[k] = found;
    console.log(`${n}/${positions.size} ${[...pos.lines][0]}: ${found.map((t) => `${t.san}? ${t.best}!`).join(", ")}`);
  }
  if (!DETOURS) continue;

  // One level further: the opponent leaves the book with a sound, common move, the student answers
  // naturally, and the opponent's next move can go wrong. Most quiet openings hide their tactics there.
  const leads = [...byMove]
    .filter(([uci]) => !found.some((t) => t.san === sanOf(pos.fen, uci)))
    .filter(([uci]) => scans.get(uci) && scans.get(uci).cp - baseline < SWING)
    .sort(([, a], [, b]) => Math.max(...Object.values(b)) - Math.max(...Object.values(a)))
    .slice(0, MAX_LEADS);
  for (const [lead, leadP] of leads) {
    const scan = scans.get(lead);
    const engineBest = scan.pv[0];
    if (!engineBest) continue;
    const afterLead = new Chess(pos.fen);
    uciMove(afterLead, lead);
    const f1 = afterLead.fen();
    // The student's answer: what a strong player would play, when the engine agrees it's about as
    // good as its own; otherwise the engine's move.
    let reply = engineBest;
    const natural = await topMove(f1, BANDS[BANDS.length - 1]);
    if (natural && natural !== engineBest && -(await afterMove(f1, natural, SCAN_DEPTH)).cp >= scan.cp - REPLY_SLACK) reply = natural;
    const q = new Chess(f1);
    uciMove(q, reply);
    const qKey = key(q.fen());
    if (q.isGameOver()) continue;
    if (!detoured.has(qKey)) {
      detoured.add(qKey);
      // The opponent's best here is what the mistake is measured from.
      const best = await analyze(q.fen(), SCAN_DEPTH);
      const qBest = best.pv[0];
      const qBaseline = qBest ? (await afterMove(q.fen(), qBest, SCAN_DEPTH)).cp : -best.cp;
      const qFound = await mistakesAt(q.fen(), await played(q.fen(), new Set(qBest ? [qBest] : [])), qBaseline);
      if (qFound.length) traps[qKey] = [...(traps[qKey] ?? []), ...qFound.filter((t) => !traps[qKey]?.some((o) => o.san === t.san))];
    }
    if (!traps[qKey]?.length) continue;
    const route = { lead: sanOf(pos.fen, lead), reply: sanOf(f1, reply), p: leadP };
    routes[k] = [...(routes[k] ?? []), route];
    console.log(`${n}/${positions.size} ${[...pos.lines][0]}: detour ${route.lead} ${route.reply}, then ${traps[qKey].map((t) => `${t.san}? ${t.best}!`).join(", ")}`);
  }
}
engine.terminate?.();

writeOut(traps, routes);
const total = Object.values(traps).reduce((t, l) => t + l.length, 0);
console.log(
  `${total} traps in ${Object.keys(traps).length} positions, ${Object.values(routes).flat().length} detours, from ${positions.size} book positions, ${Math.round((Date.now() - started) / 1000)}s`,
);
