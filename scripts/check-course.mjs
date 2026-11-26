// Checks the opening courses (src/openings/courses/): node scripts/check-course.mjs [--no-engine]
//
// Every node's path is legal and ends with the course's side to move; its answer, the moves it also
// accepts and its played-out point (cont) are legal; its drawings parse; every move its texts name
// can be shown on the board (as check-book.mjs does for plans). With the engine (Stockfish, depth
// DEPTH): the answer and the accepted moves are within SLACK of the engine's best, a watch move loses
// at least WATCH more than the answer, and a punishment leaves the student at least PUNISH ahead.
import { createRequire } from "node:module";
import { Chess } from "chess.js";
import { COURSES as ALL } from "../src/openings/courses/index.ts";
import { splitSquares } from "../src/chess/squareRefs.ts";

const COURSE_ID = (() => {
  const i = process.argv.indexOf("--course");
  return i > 0 ? process.argv[i + 1] : null;
})();
const COURSES = ALL.filter((c) => !COURSE_ID || c.id === COURSE_ID);
const DEPTH = 18;
/** How far below the engine's best an accepted move may be (centipawns). */
const SLACK = 45;
/** A watch move loses at least this much more than the answer, and leaves the student at least LOSING behind. */
const WATCH = 40;
const LOSING = -65;
const PUNISH = 80;
const ENGINE = !process.argv.includes("--no-engine");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i > 0 ? process.argv[i + 1] : null;
})();

const require = createRequire(import.meta.url);
let pending = null;
let last = null;
const engine = ENGINE
  ? require("stockfish")("lite-single", (line) => {
      if (line.startsWith("info") && line.includes(" pv ")) last = line;
      if (line.startsWith("bestmove") && pending) {
        const done = pending;
        pending = null;
        done(last);
      }
    })
  : null;
engine?.processCommand("uci");
engine?.processCommand("setoption name Hash value 64");

/** The eval for the side to move (centipawns; mates as ±(10000 − distance)) and the best line. */
function analyze(fen) {
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
    engine.processCommand(`go depth ${DEPTH}`);
  });
}

/** The student's eval after their move `san` from `fen`. */
async function after(fen, san) {
  const chess = new Chess(fen);
  chess.move(san);
  return -(await analyze(chess.fen())).cp;
}

const sanOfUci = (fen, uci) => new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;

let bad = 0;
const fail = (where, what) => (console.error(`${where}: ${what}`), bad++);
const ids = new Set();
let nodes = 0;

for (const course of COURSES) {
  const side = course.color === "white" ? "w" : "b";
  for (const chapter of course.chapters)
    for (const node of chapter.nodes) {
      if (ONLY && !node.id.includes(ONLY)) continue;
      nodes++;
      const where = `${course.id}/${node.id}`;
      if (ids.has(node.id)) fail(where, "duplicate id");
      ids.add(node.id);
      const chess = new Chess();
      const fens = [chess.fen()];
      const sans = [];
      let ok = true;
      for (const m of node.path.split(" ")) {
        try {
          sans.push(chess.move(m).san);
          fens.push(chess.fen());
        } catch {
          fail(where, `illegal ${m} in the path`);
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const fen = chess.fen();
      if (chess.turn() !== side) fail(where, "the path ends with the course's side to move... not its turn");
      const legal = (san) => {
        try {
          new Chess(fen).move(san);
          return true;
        } catch {
          return false;
        }
      };
      for (const m of [node.answer, ...(node.also ?? []), ...(node.watch ? [node.watch.move] : [])]) if (!legal(m)) fail(where, `${m} isn't legal here`);
      if (node.cont) {
        const c = new Chess(fen);
        try {
          c.move(node.answer);
          for (const m of node.cont.split(" ")) c.move(m);
        } catch (e) {
          fail(where, `cont doesn't play: ${e.message}`);
        }
        if (node.cont.split(" ").length % 2 === 1)
          fail(where, "cont ends with the opponent's move: end it on the student's");
      }
      for (const token of node.draw.split(" ").filter(Boolean))
        if (!/^[gbry]:[a-h][1-8]([a-h][1-8])?$/.test(token)) fail(where, `bad drawing "${token}"`);
      // Texts: read from the node's position, with the path as the game.
      const game = { fens, sans };
      const ctx = { at: fen, game, played: game, earlier: fens.slice(-4, -1).reverse() };
      for (const [what, text] of [
        ["title", node.title],
        ["recognize", node.recognize],
        ["why", node.why],
        ...(node.watch ? [["watch", node.watch.text]] : []),
      ])
        for (const part of splitSquares(text, ctx)) {
          if (typeof part === "string" || !/^(?:[wb]:)/.test(part.ref)) continue;
          const needsMove = /^[KQRBN]|^[a-h]x|^[O0]-|^[a-h][1-8][-x]/.test(part.text);
          if (!part.place?.uci && needsMove) fail(where, `${what}: "${part.text}" has no move to show`);
        }
      if (!ENGINE || !legal(node.answer)) continue;
      const best = await analyze(fen);
      const bestSan = best.pv[0] ? sanOfUci(fen, best.pv[0]) : "?";
      const answer = await after(fen, node.answer);
      const line = `${where} (${node.answer} ${answer}, best ${bestSan} ${best.cp})`;
      // The engine's own move can't be below itself: two searches of a won position can differ by more than SLACK.
      if (node.answer !== bestSan && best.cp - answer > SLACK) fail(line, `${node.answer} is ${best.cp - answer} below the engine's ${bestSan}`);
      for (const m of node.also ?? []) {
        if (!legal(m)) continue;
        const e = await after(fen, m);
        if (best.cp - e > SLACK) fail(line, `also ${m} is ${best.cp - e} below best (${e})`);
      }
      if (node.watch && legal(node.watch.move)) {
        const e = await after(fen, node.watch.move);
        if (answer - e < WATCH || e > LOSING) fail(line, `watch ${node.watch.move} only loses ${answer - e} (${e})`);
        else console.log(`  ${where}: watch ${node.watch.move} ${e}`);
      }
      if (node.kind === "punish" && answer < PUNISH) fail(line, `the punishment only leaves ${answer}`);
      console.log(line);
    }
}
engine?.terminate?.();
console.log(`${nodes} nodes, ${bad} problems`);
process.exit(bad ? 1 : 0);
