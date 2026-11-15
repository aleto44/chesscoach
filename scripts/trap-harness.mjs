// Lays out the opening trainer's traps as drills in one self-contained page, outside the app, to
// judge whether each one should count: node scripts/trap-harness.mjs [--set london] [--detours]
//   [--traps src/openings/traps.ts] [--out trap-preview.html]
//
// Each drill steps through what the trainer would do: the book line up to the spot, the opponent's
// detour and the student's expected answer (if any), the mistake, the punishment, and Stockfish's
// line after it, so the "why" is on the board too.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Chess } from "chess.js";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ONLY_SET = arg("--set");
const DETOURS_ONLY = process.argv.includes("--detours");
const TRAPS_FILE = arg("--traps") ?? "src/openings/traps.ts";
const OUT = arg("--out") ?? "trap-preview.html";
const PV_DEPTH = 16;
const PV_PLIES = 8;

// ---- Data: the lines (as find-traps.mjs reads them) and the stored traps ----

const src = readFileSync("src/openings/training.ts", "utf8");
const sets = src
  .split(/\n    id: "/)
  .slice(1)
  .map((block) => ({
    id: block.slice(0, block.indexOf('"')),
    color: block.match(/color: "(white|black)"/)?.[1],
    lines: [...block.matchAll(/T\("[A-E]\d\d", "([^"]+)", "([^"]+)"/g)].map(([, name, moves]) => ({ name, moves: moves.split(" ") })),
  }))
  .filter((s) => s.color && s.lines.length && (!ONLY_SET || s.id === ONLY_SET));

const stored = readFileSync(TRAPS_FILE, "utf8");
const objectAfter = (name) => {
  const at = stored.indexOf(`export const ${name}`);
  if (at < 0) return {};
  const start = stored.indexOf("= ", at) + 2;
  const end = stored.indexOf(";\n", start);
  return JSON.parse(stored.slice(start, end));
};
const TRAPS = objectAfter("TRAPS");
const ROUTES = objectAfter("ROUTES");
const key = (fen) => fen.split(" ").slice(0, 4).join(" ");

// ---- Engine, for the line after the punishment ----

const require = createRequire(import.meta.url);
let pending = null;
let last = null;
const engine = require("stockfish")("lite-single", (line) => {
  if (line.startsWith("info") && line.includes(" pv ")) last = line;
  if (line.startsWith("bestmove") && pending) {
    const done = pending;
    pending = null;
    done(last);
  }
});
engine.processCommand("uci");
engine.processCommand("setoption name Hash value 64");
const pvOf = (fen) =>
  new Promise((resolve) => {
    last = null;
    pending = (info) => resolve(info?.match(/ pv (.+)$/)?.[1].split(" ") ?? []);
    engine.processCommand(`position fen ${fen}`);
    engine.processCommand(`go depth ${PV_DEPTH}`);
  });

// ---- Drills ----

const pct = (p) => Object.entries(p).map(([band, v]) => `${band}: ${Math.round(v * 100)}%`).join(", ");
const evalText = (cp) => (Math.abs(cp) >= 9000 ? `mate in ${10000 - Math.abs(cp)}` : `${cp >= 0 ? "+" : "−"}${(Math.abs(cp) / 100).toFixed(2)}`);
const numbered = (sans, startPly = 0) =>
  sans.map((s, i) => ((startPly + i) % 2 === 0 ? `${(startPly + i) / 2 + 1}.${s}` : i === 0 ? `${Math.floor((startPly + i) / 2) + 1}...${s}` : s)).join(" ");
const arrowOf = (m, color) => ({ from: m.from, to: m.to, color });

/** One step of a drill: the position, the arrow for the move that led there, and what to say. */
const step = (fen, text, arrow = null) => ({ fen, text, arrow });

async function drill(set, line, ply, chess, trap, detour) {
  const steps = [];
  const book = chess.fen();
  const bookMove = line.moves[ply];
  steps.push(step(book, `Book: ${numbered(line.moves.slice(0, ply))}. The book move here is ${bookMove}.`));
  const c = new Chess(book);
  if (detour) {
    const lead = c.move(detour.lead);
    steps.push(step(c.fen(), `Opponent leaves the book: ${detour.lead} instead of ${bookMove} (played by ${pct(detour.p)}). Sound, not a mistake.`, arrowOf(lead, "blue")));
    const reply = c.move(detour.reply);
    steps.push(step(c.fen(), `Student's expected answer: ${detour.reply}. Anything engine-equal is accepted but ends the drill; worse is marked as a slip.`, arrowOf(reply, "green")));
  }
  const before = c.fen();
  const m = c.move(trap.san);
  steps.push(step(c.fen(), `Opponent's mistake: ${trap.san} (played by ${pct(trap.p)}). Your move: punish it.`, arrowOf(m, "red")));
  const punish = c.move(trap.best);
  const cont = trap.cont?.length ? trap.cont : [trap.best];
  steps.push(step(c.fen(), `Punishment: ${trap.best}, ${evalText(trap.eval)} for the student (Stockfish depth 18).${cont.length > 1 ? " The trainer plays it out:" : ""}`, arrowOf(punish, "green")));
  // The rest of the played-out punishment, as the trainer runs it: the opponent defends, the student finds the next move.
  for (let i = 1; i < cont.length; i++) {
    const mv = c.move(cont[i]);
    const last = i === cont.length - 1;
    steps.push(
      step(
        c.fen(),
        i % 2 ? `Opponent defends: ${cont[i]}. The student has to find the next move.` : `Student: ${cont[i]}.${last ? ` The win is on the board: ${cont.join(" ")}. The drill ends here.` : ""}`,
        arrowOf(mv, i % 2 ? "blue" : "green"),
      ),
    );
  }
  if (cont.length === 1) steps[steps.length - 1].text += " The drill ends here (no material to play out).";
  const pv = (await pvOf(c.fen())).slice(0, PV_PLIES);
  const pvSans = [];
  for (const uci of pv) {
    let mv;
    try {
      mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    pvSans.push(mv.san);
    steps.push(step(c.fen(), `After the drill, the engine goes on: ${pvSans.join(" ")}`, arrowOf(mv, "yellow")));
  }
  const moverPly = new Chess(before).moveNumber() * 2 - (new Chess(before).turn() === "w" ? 2 : 1);
  return {
    set: set.id,
    color: set.color,
    line: line.name,
    kind: detour ? "detour" : "direct",
    title: detour
      ? `${detour.lead} ${detour.reply}, then ${trap.san}? ${trap.best}!`
      : `${numbered([trap.san], moverPly)}? ${trap.best}!`,
    steps,
  };
}

const drills = [];
const seen = new Set();
for (const set of sets)
  for (const line of set.lines) {
    const chess = new Chess();
    for (let ply = 0; ply < line.moves.length; ply++) {
      const fen = chess.fen();
      const opponent = (chess.turn() === "w" ? "white" : "black") !== set.color;
      if (opponent) {
        const k = key(fen);
        if (!DETOURS_ONLY)
          for (const t of TRAPS[k] ?? []) {
            const id = `${k}|${t.san}`;
            if (seen.has(id)) continue;
            seen.add(id);
            drills.push(await drill(set, line, ply, chess, t, null));
          }
        for (const r of ROUTES[k] ?? []) {
          const c = new Chess(fen);
          c.move(r.lead);
          c.move(r.reply);
          for (const t of TRAPS[key(c.fen())] ?? []) {
            const id = `${k}|${r.lead}|${r.reply}|${t.san}`;
            if (seen.has(id)) continue;
            seen.add(id);
            drills.push(await drill(set, line, ply, chess, t, r));
          }
        }
      }
      chess.move(line.moves[ply]);
    }
    process.stdout.write(`\r${drills.length} drills`);
  }
engine.terminate?.();

// ---- The page ----

const css = readFileSync("node_modules/chessground/assets/chessground.cburnett.css", "utf8");
const pieces = {};
for (const [, type, color, url] of css.matchAll(/piece\.(\w+)\.(white|black) \{\s*background-image: url\('([^']+)'\)/g)) pieces[`${color}-${type}`] = url;

const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Opening traps: ${ONLY_SET ?? "all sets"}${DETOURS_ONLY ? " (detours)" : ""}</title>
<style>
body { font: 14px system-ui, sans-serif; margin: 0; display: flex; height: 100vh; color: #222; }
#list { width: 340px; overflow: auto; border-right: 1px solid #ccc; padding: 8px; box-sizing: border-box; }
#list h3 { margin: 12px 0 4px; font-size: 13px; color: #555; }
#list button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 4px 6px; cursor: pointer; border-radius: 4px; }
#list button.on { background: #dde8ff; }
#list .detour::before { content: "↪ "; color: #36c; }
main { flex: 1; padding: 16px; overflow: auto; }
#board { position: relative; width: min(480px, calc(100vw - 32px)); aspect-ratio: 1; display: grid; grid-template: repeat(8, 1fr) / repeat(8, 1fr); }
.sq { position: relative; background-size: 100%; }
.light { background-color: #f0d9b5; } .dark { background-color: #b58863; }
.sq.hl { box-shadow: inset 0 0 0 100px rgba(155,199,0,.41); }
.coord { position: absolute; font-size: 10px; left: 2px; bottom: 1px; opacity: .6; }
#arrows { position: absolute; inset: 0; pointer-events: none; }
#text { max-width: 480px; margin: 12px 0; min-height: 3em; font-size: 15px; }
#nav button { font-size: 14px; padding: 4px 12px; }
@media (max-width: 860px) { body { flex-direction: column; height: auto; } #list { width: auto; max-height: 35vh; border-right: 0; border-bottom: 1px solid #ccc; } }
#meta { color: #666; margin-bottom: 8px; }
</style></head><body>
<div id="list"></div>
<main><div id="meta"></div><div id="board"><svg id="arrows" viewBox="0 0 8 8"></svg></div>
<div id="text"></div><div id="nav"><button id="prev">◀ Back</button> <span id="count"></span> <button id="next">Next ▶</button>
<span style="color:#888;margin-left:12px">← → step, ↑ ↓ drill</span></div></main>
<script>
const DRILLS = ${JSON.stringify(drills)};
const PIECES = ${JSON.stringify(pieces)};
const NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const COLORS = { red: "#c33", green: "#15781b", blue: "#36c", yellow: "#d9a400" };
let d = 0, s = 0;
const list = document.getElementById("list");
let group = "";
DRILLS.forEach((x, i) => {
  const g = x.set + ": " + x.line;
  if (g !== group) { group = g; const h = document.createElement("h3"); h.textContent = g; list.append(h); }
  const b = document.createElement("button");
  b.textContent = x.title; b.className = x.kind; b.onclick = () => { d = i; s = 0; draw(); };
  list.append(b);
});
function squares(fen) {
  const rows = fen.split(" ")[0].split("/"), out = {};
  rows.forEach((row, r) => { let f = 0; for (const ch of row) { if (/\\d/.test(ch)) f += +ch; else { out["abcdefgh"[f] + (8 - r)] = (ch === ch.toUpperCase() ? "white-" : "black-") + NAMES[ch.toLowerCase()]; f++; } } });
  return out;
}
function draw() {
  const x = DRILLS[d]; if (!x) return;
  const st = x.steps[s], flip = x.color === "black", pos = squares(st.fen);
  const board = document.getElementById("board"), svg = document.getElementById("arrows");
  board.querySelectorAll(".sq").forEach((e) => e.remove());
  const xy = (sq) => { const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; return flip ? [7 - f + .5, r + .5] : [f + .5, 7 - r + .5]; };
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const f = flip ? 7 - col : col, r = flip ? row : 7 - row, sq = "abcdefgh"[f] + (r + 1);
    const e = document.createElement("div");
    e.className = "sq " + ((f + r) % 2 ? "light" : "dark") + (st.arrow && (st.arrow.from === sq || st.arrow.to === sq) ? " hl" : "");
    if (pos[sq]) e.style.backgroundImage = "url('" + PIECES[pos[sq]] + "')";
    if (col === 0 || row === 7) e.innerHTML = '<span class="coord">' + (row === 7 ? "abcdefgh"[f] : "") + (col === 0 ? r + 1 : "") + "</span>";
    board.insertBefore(e, svg);
  }
  svg.innerHTML = "";
  if (st.arrow) {
    const [x1, y1] = xy(st.arrow.from), [x2, y2] = xy(st.arrow.to), c = COLORS[st.arrow.color];
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    svg.innerHTML = '<defs><marker id="h" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4z" fill="' + c + '"/></marker></defs>' +
      '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + (x2 - ux * .35) + '" y2="' + (y2 - uy * .35) + '" stroke="' + c + '" stroke-width=".18" opacity=".8" marker-end="url(#h)"/>';
  }
  document.getElementById("meta").textContent = x.set + " (student plays " + x.color + ") · " + x.line + " · " + (x.kind === "detour" ? "detour trap" : "trap on the line");
  document.getElementById("text").textContent = st.text;
  document.getElementById("count").textContent = (s + 1) + " / " + x.steps.length;
  list.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === d));
}
const go = (ds, dd) => { if (dd) { d = Math.max(0, Math.min(DRILLS.length - 1, d + dd)); s = 0; } else s = Math.max(0, Math.min(DRILLS[d].steps.length - 1, s + ds)); draw(); };
document.getElementById("prev").onclick = () => go(-1, 0);
document.getElementById("next").onclick = () => go(1, 0);
addEventListener("keydown", (e) => { const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (k) { e.preventDefault(); go(...k); } });
const at = location.hash.match(/^#(\\d+)(?:\\.(\\d+))?$/);
if (at) { d = +at[1]; s = +(at[2] ?? 0); }
draw();
</script></body></html>`;
writeFileSync(OUT, page);
console.log(`\n${drills.length} drills (${drills.filter((x) => x.kind === "detour").length} detours) written to ${OUT}`);
