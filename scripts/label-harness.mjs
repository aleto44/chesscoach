// Tries the "hidden value" labels (great / brilliant) on the student's recent games, outside the
// app, and lays out what it finds as drills in one page: node scripts/label-harness.mjs --db <copy of
// chesscoach.db> [--games 15] [--out label-preview.html]. The finds are also saved next to the page
// (label-preview.json); --from label-preview.json rebuilds the page from them without the engine.
//
// Hidden value: how much better a full search rates a move than a glance does (Stockfish at depth 2),
// measured against the move the glance would pick. A move the glance already finds (a recapture,
// taking what hangs) has none, however much worse the alternatives are; a quiet killer or a sound
// sacrifice has a lot. Great = correct and hidden value of GREAT or more; brilliant = that, plus the
// glance sees it giving up material, by a side not already clearly winning.
import { writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { Chess } from "chess.js";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DB = arg("--db");
const GAMES = +(arg("--games") ?? 15);
const OUT = arg("--out") ?? "label-preview.html";
const FROM = arg("--from");
if (!DB && !FROM) throw new Error("--db <path to a copy of chesscoach.db> is required");

const DEEP = 13; // the review's depth
const TOP = 6; // engine lines searched, to find the best-looking rivals
const GREAT = 15; // hidden value, points of winning chance
const NEAR = 8; // shown too, to judge the threshold
const CORRECT = 2; // points a move may lose and still count as correct
const BRILLIANT_MAX_CP = 300;
const SAC = 2; // material a move must look like it gives up, at a glance, to be a sacrifice
const WON_BACK = 4; // plies after the move within which a sacrifice won back is only "great"
const ONLY = arg("--game"); // one game id, to check a single case
const PV_PLIES = 8;

// ---- Engine ----

const require = createRequire(import.meta.url);
let pending = null;
let lines = new Map();
const engine = require("stockfish")("lite-single", (line) => {
  if (line.startsWith("info") && line.includes(" pv ") && line.includes(" score ")) {
    const k = +(line.match(/ multipv (\d+)/)?.[1] ?? 1);
    const mate = line.match(/ score mate (-?\d+)/);
    const cp = mate ? Math.sign(+mate[1]) * (10000 - Math.abs(+mate[1])) : +line.match(/ score cp (-?\d+)/)[1];
    lines.set(k, { cp, mate: !!mate, pv: line.match(/ pv (.+)$/)[1].split(" ") });
  }
  if (line.startsWith("bestmove") && pending) {
    const done = pending;
    pending = null;
    done([...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l));
  }
});
engine.processCommand("uci");
engine.processCommand("setoption name Hash value 64");

/** Lines from `fen`, side to move's view (cp; mates as ±(10000 − distance)). */
function search(fen, depth, { multipv = 1, moves } = {}) {
  return new Promise((resolve) => {
    lines = new Map();
    pending = resolve;
    // A fresh hash each time, or a search's scores depend on what was searched before it.
    engine.processCommand("ucinewgame");
    engine.processCommand(`setoption name MultiPV value ${multipv}`);
    engine.processCommand(`position fen ${fen}`);
    engine.processCommand(`go depth ${depth}${moves ? ` searchmoves ${moves.join(" ")}` : ""}`);
  });
}

// ---- The glance: material only, every capture sequence played out ----

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function material(chess) {
  let sum = 0;
  for (const sq of chess.board().flat()) if (sq) sum += (sq.color === chess.turn() ? 1 : -1) * VALUE[sq.type];
  return sum;
}
/** Material for the side to move once the captures settle (either side may stop capturing). */
function settle(chess, depth = 6, alpha = -1000, beta = 1000) {
  const check = chess.inCheck();
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return check ? -100 : 0;
  const stand = material(chess);
  if (depth === 0) return stand;
  let best = check ? -100 : stand;
  if (best >= beta) return best;
  alpha = Math.max(alpha, best);
  // Biggest captures first, cheapest capturer first, so the cut-offs come early.
  const tries = moves
    .filter((m) => check || m.captured || m.promotion)
    .sort((a, b) => VALUE[b.captured ?? "p"] * 10 - VALUE[b.piece] - (VALUE[a.captured ?? "p"] * 10 - VALUE[a.piece]));
  for (const m of tries) {
    chess.move(m);
    const v = -settle(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (v > best) best = v;
    if (best >= beta) break;
    alpha = Math.max(alpha, best);
  }
  return best;
}
/**
 * What a move looks like at a glance, in material for the mover: the move, the opponent's best reply
 * (any move), then the captures settled. Sees what's hanging, forks and simple threats, and mate in
 * one either way; not quiet follow-ups or anything deeper.
 */
function glanceOf(fen, uci) {
  const chess = new Chess(fen);
  uciMove(chess, uci);
  const replies = chess.moves({ verbose: true });
  if (!replies.length) return chess.inCheck() ? 100 : 0;
  let worst = Infinity;
  for (const r of replies) {
    chess.move(r);
    worst = Math.min(worst, settle(chess, 6, -1000, worst));
    chess.undo();
  }
  return worst;
}

/** Winning chances, mover's view, as the review (src/engine/live.ts). */
const W = (l) => (l.mate ? (l.cp > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * l.cp)) - 1));

// ---- The games ----

const db = FROM ? null : new DatabaseSync(DB, { readOnly: true });
const games = FROM ? [] : db
  .prepare(
    `SELECT id, started_at, student_color, opponent, opponent_name, result, source FROM games
     WHERE student_color != 'both' AND result IS NOT NULL ${ONLY ? `AND id = ${+ONLY}` : ""} ORDER BY started_at DESC LIMIT ?`,
  )
  .all(GAMES);
const movesOf = db?.prepare("SELECT ply, san, uci, fen_before, fen_after, by_student, label FROM moves WHERE game_id = ? ORDER BY ply");

const uciMove = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const sanOf = (fen, uci) => uciMove(new Chess(fen), uci).san;
const moveNo = (ply, san) => `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."}${san}`;
const pawns = (cp) => (Math.abs(cp) >= 9000 ? `${cp > 0 ? "" : "−"}M${10000 - Math.abs(cp)}` : `${cp >= 0 ? "+" : "−"}${(Math.abs(cp) / 100).toFixed(1)}`);

const opponentName = (g) => g.opponent_name ?? (g.opponent?.match(/:(\d+)$/) ? `the bot (${g.opponent.match(/:(\d+)$/)[1]})` : g.opponent);
const arrowOf = (uci, color) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), color });
/** A move and the engine's line after it, one board per step. */
function lineOf(fen, uci, pv) {
  const chess = new Chess(fen);
  const out = [];
  for (const [i, u] of [uci, ...pv].slice(0, PV_PLIES + 1).entries()) {
    let m;
    try {
      m = uciMove(chess, u);
    } catch {
      break;
    }
    out.push({ fen: chess.fen(), arrow: arrowOf(u, i === 0 ? "green" : "blue"), san: m.san });
  }
  return out;
}

let finds = [];
if (FROM) {
  finds = JSON.parse(readFileSync(FROM, "utf8"));
  engine.terminate?.();
} else {
  let done = 0;
  for (const g of games) {
    const moves = movesOf.all(g.id);
    // The last labeled move's idea: its engine line, from its ply. Moves that follow it are that
    // move's follow-ups, credited to it, not labeled again.
    let idea = null;
    // A labeled sacrifice whose material hasn't come back yet: the moves cashing it in are its follow-ups.
    let openSac = null;
    for (const [idx, m] of moves.entries()) {
      if (!m.by_student || m.label === "book") continue;
      const fen = m.fen_before;
      const chess = new Chess(fen);
      if (chess.moves().length < 2) continue;
      // Hidden value: how much better the move really is than the best of the engine's top moves that
      // look at least as good at a glance. A sacrifice instead looks worse and isn't: correct and at
      // least SAC down at a glance; won back within WON_BACK plies of the engine's line it's great,
      // otherwise brilliant.
      const top = await search(fen, DEEP, { multipv: TOP });
      const best = top[0];
      const played = top.find((l) => l.pv[0] === m.uci) ?? (await search(fen, DEEP, { moves: [m.uci] }))[0];
      const now = material(chess);
      const gP = glanceOf(fen, m.uci) - now;
      const others = top.filter((l) => l.pv[0] !== m.uci).map((l) => ({ l, g: glanceOf(fen, l.pv[0]) - now }));
      const ob = others.find((o) => o.g >= gP)?.l ?? null;
      const safest = others.reduce((a, o) => (!a || o.g > a.g ? o : a), null);
      const correct = W(best) - W(played) < CORRECT;
      const hidden = ob ? W(played) - W(ob) : 0;
      const gaveUp = safest ? safest.g - gP : 0;
      const sacrifice = correct && gaveUp >= SAC && !best.mate && best.cp < BRILLIANT_MAX_CP && W(played) >= 45;
      let wonBack = null;
      if (sacrifice) {
        const line = new Chess(fen);
        for (const [i, u] of [m.uci, ...played.pv.slice(1)].entries()) {
          try {
            uciMove(line, u);
          } catch {
            break;
          }
          const mine = (line.turn() === chess.turn() ? 1 : -1) * material(line);
          if (i > 0 && i <= WON_BACK && mine >= now - 1) {
            wonBack = i;
            break;
          }
        }
      }
      let verdict = sacrifice
        ? wonBack
          ? "great"
          : "brilliant"
        : correct && hidden >= GREAT
          ? "great"
          : correct && hidden >= NEAR
            ? "near"
            : null;
      if (openSac && (now >= openSac.material - 1 || m.ply - openSac.ply > 2 * WON_BACK)) openSac = null;
      const followUp = openSac || (idea && moves.slice(idea.ply - 1, m.ply).every((x, k) => x.uci === idea.line[k]));
      if (followUp && verdict) verdict = "followup";
      else if (verdict === "great" || verdict === "brilliant") {
        idea = { ply: m.ply, line: [m.uci, ...played.pv.slice(1)] };
        if (sacrifice) openSac = { ply: m.ply, material: now };
      }
      const control = g.id === 189 && m.ply === 48;
      done++;
      process.stdout.write(`\r${done} moves, ${finds.length} finds`);
      if (!verdict && !control) continue;

      const prev = moves[idx - 1];
      const rivalOf = ({ l, g }) => ({ san: sanOf(fen, l.pv[0]), cp: l.cp, looks: g, line: lineOf(fen, l.pv[0], l.pv.slice(1)) });
      finds.push({
        game: g.id,
        date: g.started_at.slice(0, 10),
        color: g.student_color,
        opponent: opponentName(g),
        move: moveNo(m.ply, m.san),
        today: m.label,
        verdict: control ? "control" : verdict,
        hidden: Math.round(hidden),
        before: { fen, arrow: prev ? arrowOf(prev.uci, "red") : null, last: prev ? moveNo(prev.ply, prev.san) : null },
        mine: { san: m.san, cp: played.cp, looks: gP, line: lineOf(fen, m.uci, played.pv.slice(1)) },
        rival: (sacrifice ? safest?.l : ob) ? rivalOf(sacrifice ? safest : { l: ob, g: others.find((o) => o.l === ob).g }) : null,
        sacrifice: sacrifice ? { gaveUp, wonBack } : null,
      });
      console.log(`\n  ${control ? "control" : verdict}: #${g.id} ${moveNo(m.ply, m.san)} · hidden ${Math.round(hidden)}`);
    }
  }
  engine.terminate?.();
  writeFileSync(OUT.replace(/\.html$/, ".json"), JSON.stringify(finds));
}
const ORDER = ["brilliant", "great", "followup", "near", "control"];
finds.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || b.hidden - a.hidden);

// ---- The page: each move next to the one that looked just as good, stepped through together ----

const css = readFileSync("node_modules/chessground/assets/chessground.cburnett.css", "utf8");
const pieces = {};
for (const [, type, color, url] of css.matchAll(/piece\.(\w+)\.(white|black) \{\s*background-image: url\('([^']+)'\)/g)) pieces[`${color}-${type}`] = url;

const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>New Great / Brilliant rule: your last ${GAMES} games</title>
<style>
:root { color-scheme: light; }
body { font: 14px system-ui, sans-serif; margin: 0; display: flex; height: 100vh; color: #222; background: #fff; }
#list { width: 300px; flex: none; overflow: auto; border-right: 1px solid #ccc; padding: 8px; box-sizing: border-box; }
#list h3 { margin: 14px 0 2px; font-size: 13px; }
#list .sub { color: #777; font-size: 12px; margin-bottom: 4px; }
#list button { display: flex; justify-content: space-between; width: 100%; text-align: left; border: 0; background: none; padding: 5px 6px; cursor: pointer; border-radius: 4px; font: inherit; }
#list button.on { background: #dde8ff; }
#list .vote { width: 1.2em; text-align: center; }
main { flex: 1; padding: 16px 20px; overflow: auto; }
.intro { background: #f4f6fa; border-radius: 6px; padding: 10px 14px; max-width: 900px; line-height: 1.45; }
.intro b { white-space: nowrap; }
h2 { margin: 18px 0 4px; font-size: 19px; }
.ctx { color: #666; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-weight: 600; font-size: 13px; }
.b-great { background: #5c8bb0; } .b-brilliant { background: #1baca6; } .b-best, .b-near { background: #8a9a5b; } .b-other { background: #999; }
.labels { margin: 8px 0; font-size: 15px; }
.why { max-width: 900px; font-size: 15px; line-height: 1.5; margin: 8px 0 14px; }
.boards { display: flex; gap: 24px; flex-wrap: wrap; }
.side h4 { margin: 0 0 6px; font-size: 15px; }
.side .ev { font-weight: 600; }
.good { color: #15781b; } .bad { color: #b33; }
.board { position: relative; width: min(380px, 42vw); aspect-ratio: 1; display: grid; grid-template: repeat(8, 1fr) / repeat(8, 1fr); }
@media (max-width: 860px) { body { flex-direction: column; height: auto; } #list { width: auto; max-height: 30vh; border-right: 0; border-bottom: 1px solid #ccc; } .board, .line { width: min(calc(100vw - 40px), 360px); max-width: none; } }
.sq { position: relative; background-size: 100%; }
.light { background-color: #f0d9b5; } .dark { background-color: #b58863; }
.sq.hl { box-shadow: inset 0 0 0 100px rgba(155,199,0,.41); }
.coord { position: absolute; font-size: 10px; left: 2px; bottom: 1px; opacity: .6; }
svg.arrows { position: absolute; inset: 0; pointer-events: none; }
.line { max-width: min(380px, 42vw); margin-top: 6px; line-height: 1.7; }
.line span { padding: 1px 3px; border-radius: 3px; }
.line span.cur { background: #ffe58a; }
#nav { margin: 14px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
#nav button, #verdict button { font: inherit; padding: 5px 12px; cursor: pointer; }
#verdict { margin: 8px 0 30px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
#verdict button.picked { outline: 3px solid #36c; }
</style></head><body>
<div id="list"></div>
<main>
<div class="intro">
This page tries a <b>new rule for Great and Brilliant</b> on your last ${GAMES} games, before anything changes in the app.
The rule: a move is <b>Great</b> when it's the engine's move <i>and</i> some other move looked just as good at a glance
(same material once the reply and the obvious captures are played out) but is clearly worse. That's the "hard to see" part.
A move that looks like it <b>gives up material</b> at a glance but doesn't lose is a sacrifice: <b>Great</b> if the material comes back within your next two moves, <b>Brilliant</b> if it doesn't.
Each move below sits next to the move that looked just as good, so you can compare. Step through both lines with ← →,
and use the buttons at the bottom to say whether you agree.
</div>
<h2 id="title"></h2><div class="ctx" id="ctx"></div>
<div class="labels" id="labels"></div>
<div class="why" id="why"></div>
<div id="nav"><button id="first">⏮ Start</button><button id="prev">◀ Back</button><button id="next">Next ▶</button><span id="stepText" class="ctx"></span></div>
<div class="boards">
  <div class="side"><h4 id="mineHead"></h4><div class="board" id="mineBoard"></div><div class="line" id="mineLine"></div></div>
  <div class="side" id="rivalSide"><h4 id="rivalHead"></h4><div class="board" id="rivalBoard"></div><div class="line" id="rivalLine"></div></div>
</div>
<div id="verdict"><span>Is the new label right?</span><button data-v="yes">👍 Yes</button><button data-v="no">👎 No</button><button id="copy">Copy my answers</button><span id="copied" class="ctx"></span></div>
</main>
<script>
const FINDS = ${JSON.stringify(finds)};
const PIECES = ${JSON.stringify(pieces)};
const NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const COLORS = { red: "#c33", green: "#15781b", blue: "#36c" };
const GROUPS = {
  brilliant: ["Would become Brilliant", "A sacrifice that holds, material not won back soon."],
  great: ["Would become Great", "A short sacrifice, or a rival looked as good but wasn't."],
  followup: ["Follow-ups, stay Best", "Part of an earlier labeled move's idea, so that move gets the credit."],
  near: ["Close, but stays Best", "A rival looked as good and was worse, but not by enough."],
  control: ["Check: your Rxh5", "Labeled Great today. The new rule should make it plain Best."],
};
const VOTES = JSON.parse(localStorage.getItem("labelVotes") || "{}");
const key = (f) => f.game + " " + f.move;
const newLabel = (f) => (["near", "control", "followup"].includes(f.verdict) ? "best" : f.verdict);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const evalText = (cp) => Math.abs(cp) >= 9000 ? (cp > 0 ? "you mate in " : "you get mated in ") + (10000 - Math.abs(cp)) : (cp >= 0 ? "+" : "−") + (Math.abs(cp) / 100).toFixed(1) + " for you";
const looksText = (n) => n === 0 ? "keeps material level" : n > 0 ? "wins " + n + " pawn" + (n > 1 ? "s" : "") + " of material" : "gives up " + -n + " pawn" + (n < -1 ? "s" : "") + " of material";
let d = 0, s = 0;

const list = document.getElementById("list");
let group = "";
FINDS.forEach((f, i) => {
  if (f.verdict !== group) {
    group = f.verdict;
    const h = document.createElement("h3"); h.textContent = GROUPS[group][0]; list.append(h);
    const sub = document.createElement("div"); sub.className = "sub"; sub.textContent = GROUPS[group][1]; list.append(sub);
  }
  const b = document.createElement("button");
  b.innerHTML = "<span>Game " + f.game + " · " + f.move + "</span><span class='vote'></span>";
  b.onclick = () => { d = i; s = 0; draw(); };
  list.append(b);
});

function squares(fen) {
  const rows = fen.split(" ")[0].split("/"), out = {};
  rows.forEach((row, r) => { let f = 0; for (const ch of row) { if (/\\d/.test(ch)) f += +ch; else { out["abcdefgh"[f] + (8 - r)] = (ch === ch.toUpperCase() ? "white-" : "black-") + NAMES[ch.toLowerCase()]; f++; } } });
  return out;
}
function drawBoard(el, fen, arrow, flip) {
  const pos = squares(fen);
  el.innerHTML = "";
  const xy = (sq) => { const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; return flip ? [7 - f + .5, r + .5] : [f + .5, 7 - r + .5]; };
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const f = flip ? 7 - col : col, r = flip ? row : 7 - row, sq = "abcdefgh"[f] + (r + 1);
    const e = document.createElement("div");
    e.className = "sq " + ((f + r) % 2 ? "light" : "dark") + (arrow && (arrow.from === sq || arrow.to === sq) ? " hl" : "");
    if (pos[sq]) e.style.backgroundImage = "url('" + PIECES[pos[sq]] + "')";
    if (col === 0 || row === 7) e.innerHTML = '<span class="coord">' + (row === 7 ? "abcdefgh"[f] : "") + (col === 0 ? r + 1 : "") + "</span>";
    el.append(e);
  }
  if (arrow) {
    const [x1, y1] = xy(arrow.from), [x2, y2] = xy(arrow.to), c = COLORS[arrow.color];
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    el.insertAdjacentHTML("beforeend", '<svg class="arrows" viewBox="0 0 8 8"><defs><marker id="h' + el.id + '" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4z" fill="' + c + '"/></marker></defs>' +
      '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + (x2 - ux * .35) + '" y2="' + (y2 - uy * .35) + '" stroke="' + c + '" stroke-width=".18" opacity=".85" marker-end="url(#h' + el.id + ')"/></svg>');
  }
}
/** The line as text, the current step marked. */
function lineText(el, side, step) {
  el.innerHTML = side.line.map((m, i) => "<span class='" + (i + 1 === step ? "cur" : "") + "'>" + (i === 0 ? "<b>" + m.san + "</b>" : m.san) + "</span>").join(" ");
}
function why(f) {
  const r = f.rival, me = f.mine;
  if (f.verdict === "control")
    return "Counting material already picks " + me.san + ": it " + looksText(me.looks) + ", and nothing else comes close. So nothing about it is hard to see, and the new rule calls it <b>Best</b>, not Great.";
  if (f.verdict === "followup")
    return "On its own this would be Great, but it's the next step of the engine's line from your earlier labeled move, so that move gets the credit and " + me.san + " stays <b>Best</b>.";
  if (f.sacrifice) {
    const sac = "At a glance <b>" + me.san + "</b> " + looksText(me.looks) + (r ? ", while " + r.san + " " + looksText(r.looks) : "") + ". But it doesn't lose: after " + me.san + " the engine has " + evalText(me.cp) + (r ? ", after " + r.san + " " + evalText(r.cp) : "") + ". ";
    return sac + (f.sacrifice.wonBack
      ? "The engine's line wins the material back within " + Math.ceil(f.sacrifice.wonBack / 2) + " of your moves, so it's a short sacrifice: <b>Great</b>."
      : "The material stays down through the engine's line, so it's a real sacrifice: <b>Brilliant</b>.");
  }
  if (!r)
    return "Several moves looked as good as " + me.san + " at a glance, but none of them is in the engine's top lines, so all of them are clearly worse.";
  const gap = "after " + me.san + " the engine has " + evalText(me.cp) + ", after " + r.san + " only " + evalText(r.cp) + ".";
  const looks = "At a glance <b>" + r.san + "</b> looks at least as good as <b>" + me.san + "</b>: " + (r.looks === me.looks ? "both " + looksText(me.looks).replace(/^keeps/, "keep").replace(/^wins/, "win").replace(/^gives/, "give") : me.san + " " + looksText(me.looks) + ", " + r.san + " " + looksText(r.looks)) + ". ";
  if (f.verdict === "near") return looks + "But it isn't really: " + gap + " The gap is " + f.hidden + " points of winning chance, under the 15 needed for Great.";
  return looks + "But it isn't: " + gap + " Seeing that takes looking past the captures (" + f.hidden + " points of winning chance), so the new rule calls " + me.san + " <b>" + cap(f.verdict) + "</b>.";
}
function draw() {
  const f = FINDS[d]; if (!f) return;
  const flip = f.color === "black";
  document.getElementById("title").textContent = "Game " + f.game + ", your move " + f.move;
  document.getElementById("ctx").textContent = f.date + " · you were " + f.color + " against " + f.opponent;
  const today = f.today || "?";
  document.getElementById("labels").innerHTML = "Labeled today: <span class='badge b-" + (["great", "brilliant", "best"].includes(today) ? today : "other") + "'>" + cap(today) + "</span> &nbsp;→&nbsp; New rule: <span class='badge b-" + newLabel(f) + "'>" + cap(newLabel(f)) + "</span>";
  document.getElementById("why").innerHTML = why(f);
  const sides = [["mine", f.mine], ["rival", f.rival]];
  const steps = Math.max(f.mine.line.length, f.rival?.line.length ?? 0);
  for (const [name, side] of sides) {
    const box = document.getElementById(name === "mine" ? "mineBoard" : "rivalBoard");
    if (name === "rival") document.getElementById("rivalSide").style.display = side ? "" : "none";
    if (!side) continue;
    const at = s === 0 ? null : side.line[Math.min(s, side.line.length) - 1];
    drawBoard(box, at ? at.fen : f.before.fen, at ? at.arrow : f.before.arrow, flip);
    document.getElementById(name + "Head").innerHTML = (name === "mine" ? "You played " : f.sacrifice ? "The safe move: " : "Looked as good: ") + side.san + " → <span class='ev " + (name === "mine" ? "good" : "bad") + "'>" + evalText(side.cp) + "</span>";
    lineText(document.getElementById(name + "Line"), side, s);
  }
  document.getElementById("stepText").textContent = s === 0
    ? "Start: the position before your move" + (f.before.last ? " (red arrow: " + f.before.last + ")" : "") + ". Press Next to play both moves."
    : s === 1 ? "Both moves played (green). Keep going to see the engine's line (blue) after each." : "Engine line, move " + s + " of " + steps;
  document.querySelectorAll("#verdict button[data-v]").forEach((b) => b.classList.toggle("picked", VOTES[key(f)] === b.dataset.v));
  list.querySelectorAll("button").forEach((b, i) => { b.classList.toggle("on", i === d); b.querySelector(".vote").textContent = { yes: "👍", no: "👎" }[VOTES[key(FINDS[i])]] || ""; });
}
const steps = () => { const f = FINDS[d]; return Math.max(f.mine.line.length, f.rival?.line.length ?? 0); };
const go = (ds, dd) => { if (dd) { d = Math.max(0, Math.min(FINDS.length - 1, d + dd)); s = 0; } else s = Math.max(0, Math.min(steps(), s + ds)); draw(); };
document.getElementById("first").onclick = () => { s = 0; draw(); };
document.getElementById("prev").onclick = () => go(-1, 0);
document.getElementById("next").onclick = () => go(1, 0);
document.querySelectorAll("#verdict button[data-v]").forEach((b) => b.onclick = () => { VOTES[key(FINDS[d])] = b.dataset.v; localStorage.setItem("labelVotes", JSON.stringify(VOTES)); draw(); });
document.getElementById("copy").onclick = () => {
  const text = FINDS.filter((f) => VOTES[key(f)]).map((f) => "Game " + f.game + " " + f.move + " (" + newLabel(f) + "): " + (VOTES[key(f)] === "yes" ? "agree" : "disagree")).join("\\n");
  navigator.clipboard.writeText(text || "(no answers yet)").then(() => document.getElementById("copied").textContent = "Copied, paste it in the chat.");
};
addEventListener("keydown", (e) => { const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (k) { e.preventDefault(); go(...k); } });
draw();
</script></body></html>`;
writeFileSync(OUT, page);
console.log(`\n${finds.length} moves written to ${OUT}`);
