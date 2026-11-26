// Works out, for every stored trap (src/openings/traps.ts), why the opponent's mistake loses and what
// to look for, and writes them to src/openings/trapNotes.ts: node scripts/explain-traps.mjs
//
// The trainer shows a trap's hint when the student asks (before the arrow) and its "why" once the
// punishment is played. Both are worked out from the board, not written by hand (there are over a
// thousand traps): what the mistake took away (a guard, a line it opened), what each natural way of
// taking back runs into (Stockfish), and what the punishing moves attack. A detour (ROUTES) gets a
// hint for the student's answer the same way. Run it again after find-traps.mjs.
//
// node scripts/explain-traps.mjs [--only <fen key substring>] [--limit n] [--print]
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Chess } from "chess.js";
import { ROUTES, TRAPS } from "../src/openings/traps.ts";
import { splitSquares } from "../src/chess/squareRefs.ts";

const DEPTH = 14;
const OUT = "src/openings/trapNotes.ts";
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ONLY = arg("--only");
const LIMIT = Number(arg("--limit") ?? Infinity);
const PRINT = process.argv.includes("--print");

// ---- Engine (as find-traps.mjs) ----

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

/** The best line from `fen` (UCI), empty when the game is over. */
function bestLine(fen, depth = DEPTH) {
  const chess = new Chess(fen);
  if (chess.isGameOver()) return Promise.resolve([]);
  return new Promise((resolve) => {
    last = null;
    pending = (info) => resolve(info?.match(/ pv (.+)$/)?.[1].split(" ") ?? []);
    engine.processCommand(`position fen ${fen}`);
    engine.processCommand(`go depth ${depth}`);
  });
}

// ---- Board facts ----

const NAMES = { q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn", k: "king" };
const VALUES = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 };
const SIDE = { w: "White", b: "Black" };
const other = (c) => (c === "w" ? "b" : "w");
const uciMove = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** Pieces of each type for each side. */
function counts(chess) {
  const out = { w: { q: 0, r: 0, b: 0, n: 0, p: 0 }, b: { q: 0, r: 0, b: 0, n: 0, p: 0 } };
  for (const sq of chess.board().flat()) if (sq && sq.type !== "k") out[sq.color][sq.type]++;
  return out;
}

/** Net pieces each side lost from `a` to `b`, trades taken out (bishops and knights count alike). */
function netLost(a, b) {
  const [ca, cb] = [counts(a), counts(b)];
  const lost = { w: [], b: [] };
  for (const t of ["q", "r", "b", "n", "p"]) {
    const w = ca.w[t] - cb.w[t];
    const k = ca.b[t] - cb.b[t];
    const traded = Math.min(Math.max(w, 0), Math.max(k, 0));
    for (let i = 0; i < w - traded; i++) lost.w.push(t);
    for (let i = 0; i < k - traded; i++) lost.b.push(t);
  }
  // A bishop for a knight is a trade too.
  for (;;) {
    const i = lost.w.findIndex((p) => p === "b" || p === "n");
    const j = lost.b.findIndex((p) => p === "b" || p === "n");
    if (i < 0 || j < 0) break;
    lost.w.splice(i, 1);
    lost.b.splice(j, 1);
  }
  return lost;
}

const worth = (ps) => ps.reduce((n, p) => n + VALUES[p], 0);

/** "a knight", "two pawns", "a rook and a pawn". */
function listPieces(ps) {
  const by = new Map();
  for (const p of [...ps].sort((a, b) => VALUES[b] - VALUES[a])) by.set(p, (by.get(p) ?? 0) + 1);
  const words = ["", "", "two", "three", "four"];
  const parts = [...by].map(([p, n]) => (n === 1 ? `a ${NAMES[p]}` : `${words[n] ?? n} ${NAMES[p]}s`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

/** What `side` comes out ahead by between two positions: "a pawn", "a knight for a pawn" (null if nothing). */
function gainFor(side, from, to) {
  const lost = netLost(from, to);
  const won = lost[other(side)];
  const gave = lost[side];
  if (!won.length || worth(won) <= worth(gave)) return null;
  return listPieces(won) + (gave.length ? ` for ${listPieces(gave)}` : "");
}
const gainValue = (side, from, to) => {
  const lost = netLost(from, to);
  return worth(lost[other(side)]) - worth(lost[side]);
};

const pieceAt = (chess, sq) => chess.get(sq);
const named = (chess, sq) => `the ${NAMES[pieceAt(chess, sq).type]} on ${sq}`;
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");

/** The opponent's pieces (pawns too) the piece on `sq` attacks that it could win: unguarded, or worth more. */
function targetsOf(chess, sq) {
  const me = pieceAt(chess, sq);
  if (!me) return [];
  const own = me.type === "k" ? 100 : VALUES[me.type];
  const out = [];
  for (const p of chess.board().flat()) {
    if (!p || p.color === me.color || p.type === "k") continue;
    if (!chess.attackers(p.square, me.color).includes(sq)) continue;
    if (!chess.attackers(p.square, p.color).length || VALUES[p.type] > own) out.push(p.square);
  }
  return out.sort((a, b) => VALUES[pieceAt(chess, b).type] - VALUES[pieceAt(chess, a).type]);
}

/** Squares strictly between two squares on a line (empty if they don't share one). */
function between(a, b) {
  const [fa, ra, fb, rb] = [a.charCodeAt(0), +a[1], b.charCodeAt(0), +b[1]];
  const df = Math.sign(fb - fa);
  const dr = Math.sign(rb - ra);
  if (!(fa === fb || ra === rb || Math.abs(fb - fa) === Math.abs(rb - ra))) return [];
  const out = [];
  for (let f = fa + df, r = ra + dr; f !== fb || r !== rb; f += df, r += dr) out.push(String.fromCharCode(f) + r);
  return out;
}

/** A line from `fen` (UCI), followed while it captures: where the material settles, up to `max` plies. */
function settle(fen, pv, max = 8) {
  const chess = new Chess(fen);
  const moves = [];
  for (let i = 0; i < Math.min(pv.length, max); i++) {
    let m;
    try {
      m = uciMove(chess, pv[i]);
    } catch {
      break;
    }
    moves.push(m);
    const next = pv[i + 1];
    // Stop once the moves are quiet: a capture or check keeps it going.
    if (i >= 1 && !m.captured && !(next && chess.get(next.slice(2, 4))) && !chess.inCheck()) break;
  }
  // End on the winning side's move: a quiet reply after it adds nothing.
  const tail = moves.at(-1);
  if (moves.length > 1 && tail.color !== moves[0].color && !tail.captured) {
    moves.pop();
    chess.undo();
  }
  return { moves, end: chess };
}

// ---- One trap ----

/**
 * The hint (before the student's first move), the why (once it's played) and a hint per later move
 * of the punishment. `key` is the position before the mistake (opponent to move).
 */
async function explainTrap(key, trap) {
  const P = new Chess(`${key} 0 1`);
  const opp = P.turn();
  const me = other(opp);
  const P1 = new Chess(P.fen());
  const m = P1.move(trap.san);
  const cont = trap.cont?.length ? trap.cont : [trap.best];

  // The punishment played out, with each position.
  const line = new Chess(P1.fen());
  const contMoves = [];
  const fens = [P1.fen()];
  for (const san of cont) {
    contMoves.push(line.move(san));
    fens.push(line.fen());
  }
  const s1 = contMoves[0];
  const P2 = new Chess(fens[1]);

  // Taking back after the first move, when the line doesn't: what each recapture runs into.
  const refutations = [];
  const lineRetakes = contMoves[1]?.to === s1.to;
  if (s1.captured && !lineRetakes) {
    const replies = P2.moves({ verbose: true }).filter((r) => r.to === s1.to);
    for (const r of replies) {
      const after = new Chess(P2.fen());
      after.move(r.san);
      const pv = await bestLine(after.fen());
      const { moves, end } = settle(after.fen(), pv);
      if (moves.length && gainValue(me, P, end) >= Math.max(1, gainValue(me, P, line))) {
        // Did the student's first move open the line the refutation's first move uses?
        const hit = moves[0];
        const opened = "bqr".includes(hit.piece) && between(hit.from, hit.to).includes(s1.from);
        refutations.push({ recapture: r, moves, gain: gainFor(me, P, end), opened, hit });
      }
    }
  }

  // What the first punishing move threatens, when it wins nothing at once: let the opponent pass.
  let threat = null;
  if (!P2.inCheck() && !P2.isGameOver() && !gainFor(me, P, P2)) {
    const f = P2.fen().split(" ");
    f[1] = me;
    f[3] = "-";
    try {
      const passed = new Chess(f.join(" "));
      const { moves, end } = settle(passed.fen(), await bestLine(passed.fen(), 12), 6);
      const gain = gainFor(me, P, end);
      if (moves.length && (gain || end.isCheckmate())) threat = { first: moves[0], gain, mate: end.isCheckmate(), from: passed };
    } catch {
      // Not a legal position to pass in.
    }
  }

  // The squares the punishment wins something on (the main line, refutations, the threat).
  const proof = new Set([
    ...contMoves.filter((x) => x.color === me && x.captured).map((x) => x.to),
    ...refutations.flatMap((r) => r.moves.filter((x) => x.color === me && x.captured).map((x) => x.to)),
    ...(threat ? [threat.first.to] : []),
  ]);
  // Only the main line counts here: a capture deep in a recapture line isn't what the mistake was about.
  const takenOn = new Set(contMoves.filter((x) => x.color === me && x.captured).map((x) => x.to));
  const landing = new Set([...contMoves.filter((x) => x.color === me).map((x) => x.to), ...(threat ? [threat.first.to] : [])]);

  // What the mistake took away: a guard of something the punishment wins, a square it stopped
  // covering, a line it opened.
  const facts = [];
  const draw = [];
  const mover = m.piece === "p" ? `the ${m.from[0]}-pawn` : `the ${NAMES[m.piece]}`;
  for (const sq of proof) {
    const p = pieceAt(P1, sq);
    if (!p || p.color !== opp || sq === m.to) continue;
    const guardsNow = P1.attackers(sq, opp);
    if (!P.attackers(sq, opp).includes(m.from) || guardsNow.includes(m.to)) continue;
    facts.push(
      guardsNow.length
        ? `${m.san} took ${mover} off the guard of ${named(P1, sq)}.`
        : `After ${m.san}, nothing guards ${named(P1, sq)} any more: ${mover} did.`,
    );
    draw.push(`r:${sq}`);
  }
  if (!facts.length)
    for (const sq of landing) {
      if (pieceAt(P1, sq) || !P.attackers(sq, opp).includes(m.from) || P1.attackers(sq, opp).includes(m.to)) continue;
      facts.push(`${m.san} took ${mover} away from ${sq}: it doesn't cover that square any more.`);
      draw.push(`y:${sq}`);
      break;
    }
  if (takenOn.has(m.to) && !m.captured) {
    facts.push(`${m.san} put the ${NAMES[m.piece]} on ${m.to}, where it can be lost.`);
    draw.push(`r:${m.to}`);
  }
  // A line of yours the mistake opened (the piece moved out of the way).
  for (const x of [...contMoves.filter((x) => x.color === me), ...(threat ? [threat.first] : [])])
    if ("bqr".includes(x.piece) && between(x.from, x.to).includes(m.from)) {
      facts.push(`${m.san} moved out of the way of your ${NAMES[x.piece]} on ${x.from}.`);
      draw.push(`y:${x.from}${x.to}`);
      break;
    }

  /** A threat in words, without naming the move: "to take the knight on f6, winning a knight". */
  const threatWords = (t) => {
    const after = new Chess(t.from.fen());
    after.move(t.first.san);
    const hits = targetsOf(after, t.first.to);
    const what = t.mate
      ? "mate"
      : t.first.captured
        ? `to take the ${NAMES[t.first.captured]} on ${t.first.to}`
        : hits.length
          ? `a ${NAMES[t.first.piece]} move to ${t.first.to} that attacks ${andList(hits.map((sq) => named(after, sq)))}`
          : `a ${NAMES[t.first.piece]} move to ${t.first.to}`;
    return t.mate || !t.gain ? what : `${what}, winning ${t.gain}`;
  };

  // When the stored line shows nothing concrete, the engine's line on from there, until material falls.
  let later = null;
  if (!gainFor(me, P, line) && !line.isCheckmate() && !(threat && cont.length === 1)) {
    const pv = await bestLine(line.fen(), 16);
    const c = new Chess(line.fen());
    const more = [];
    for (let i = 0; i < Math.min(pv.length, 12); i++) {
      let x;
      try {
        x = uciMove(c, pv[i]);
      } catch {
        break;
      }
      more.push(x.san);
      const next = pv[i + 1];
      if (x.color === me && (c.isCheckmate() || (gainFor(me, P, c) && !(next && c.get(next.slice(2, 4)))))) {
        later = { more, gain: gainFor(me, P, c), mate: c.isCheckmate() };
        break;
      }
    }
  }

  // What the line comes to: material, a mate, a threat, or (if nothing concrete) a positional edge.
  const gain = gainFor(me, P, line);
  const lastMine = [...contMoves].reverse().find((x) => x.color === me);
  const lastAfter = new Chess(fens[contMoves.lastIndexOf(lastMine) + 1]);
  const lastHits = targetsOf(lastAfter, lastMine.to);
  const positional = !line.isCheckmate() && !gain && !threat && !later && !lastHits.length && !refutations.length;

  // What the first punishing move does, without naming it.
  const t1 = targetsOf(P2, s1.to);
  let nudge;
  if (P2.isCheckmate()) nudge = "There's a mate: look at every check.";
  else if (positional) nudge = `${m.san} is a positional slip, not a tactic: nothing falls at once, so look for the move that makes it look worst.`;
  else if (s1.captured && refutations.length)
    nudge = `The ${NAMES[s1.captured]} on ${s1.to} looks guarded, but check what taking back on ${s1.to} would cost ${SIDE[opp]}.`;
  else if (s1.captured && !P1.attackers(s1.to, opp).length) nudge = `Something is loose: nothing guards the ${NAMES[s1.captured]} on ${s1.to}.`;
  else if (s1.captured) nudge = `Count the attackers and guards on ${s1.to}.`;
  else if (t1.length >= 2) nudge = "One move can attack two things at once.";
  else if (P2.inCheck()) nudge = "Look at the checks.";
  else if (threat) {
    // What the threat is against: the piece it takes, or what the threatening move would attack.
    const after = new Chess(threat.from.fen());
    after.move(threat.first.san);
    const against = threat.mate
      ? ["your opponent's king"]
      : threat.first.captured
        ? [named(threat.from, threat.first.to)]
        : targetsOf(after, threat.first.to).map((sq) => named(after, sq));
    nudge = against.length
      ? `There's a move that sets up a threat against ${andList(against)} that ${SIDE[opp]} can't meet.`
      : `There's a move that sets up a threat ${SIDE[opp]} can't meet.`;
  }
  else if (facts.length) nudge = "Find the move that makes use of it.";
  else nudge = "There's a forcing sequence that wins material: start with the move that gives your opponent the fewest choices.";
  if (s1.captured && !positional) draw.push(`r:${s1.to}`);

  const hint = [...facts.slice(0, 2), nudge].join(" ");

  // The why: the facts, the line and its gain, why taking back fails, what the moves attack or threaten.
  const lineText = [trap.san, ...cont].join(" ");
  const why = [...facts.slice(0, 2)];
  if (line.isCheckmate()) why.push(`${lineText} is mate.`);
  else if (gain) why.push(`${lineText} wins ${gain}.`);
  else if (threat && cont.length === 1) why.push(`After ${lineText}, ${SIDE[opp]} can't meet the threat: ${threatWords(threat)}.`);
  else if (lastHits.length) why.push(`${lineText}, and ${lastMine.san} attacks ${andList(lastHits.map((sq) => named(lastAfter, sq)))}.`);
  else if (later) why.push(`The point shows a few moves on: ${[lineText, ...later.more].join(" ")} ${later.mate ? "is mate" : `wins ${later.gain}`}.`);
  else why.push(`${lineText} leaves you clearly better, though nothing falls at once: it's a positional mistake more than a tactic.`);
  // The most natural way of taking back: with the cheapest piece.
  const ref = refutations.sort((a, b) => VALUES[a.recapture.piece] - VALUES[b.recapture.piece])[0];
  if (ref) {
    const refLine = [trap.san, cont[0], ref.recapture.san, ...ref.moves.map((x) => x.san)].join(" ");
    why.push(
      `Taking back is worse: ${refLine}${ref.gain ? ` wins ${ref.gain}` : ""}${ref.opened ? `, because ${cont[0]} opened the way for your ${NAMES[ref.hit.piece]}` : ""}.`,
    );
  }
  for (let i = 0; i < contMoves.length; i += 2) {
    const after = new Chess(fens[i + 1]);
    const t = targetsOf(after, contMoves[i].to);
    if (t.length >= 2) {
      why.push(`${contMoves[i].san} attacks ${andList(t.map((sq) => named(after, sq)))} at once.`);
      break;
    }
  }

  // Later moves of the punishment: a hint each, without naming the move.
  const steps = {};
  for (let i = 2; i < contMoves.length; i += 2) {
    const x = contMoves[i];
    const before = new Chess(fens[i]);
    const after = new Chess(fens[i + 1]);
    const t = targetsOf(after, x.to);
    let text;
    if (after.isCheckmate()) text = "Keep going: there's a mate.";
    else if (x.captured && !before.attackers(x.to, opp).length) text = `Keep going: nothing guards the ${NAMES[x.captured]} on ${x.to}.`;
    else if (x.captured) text = `Keep going: count the attackers and guards on ${x.to}.`;
    else if (t.length >= 2) text = "Keep going: one move attacks two things at once.";
    else if (after.inCheck()) text = "Keep going: look at the checks.";
    else text = `Keep going: what did ${SIDE[opp]}'s last move leave?`;
    steps[i] = [text, x.captured ? `r:${x.to}` : ""];
  }

  return { hint, draw: [...new Set(draw)].join(" "), why: why.join(" "), steps, ...(positional ? { positional: true } : {}) };
}

// ---- One detour ----

/** The hint for the student's answer to a detour: what the detour does, and what the answer is for. */
function explainDetour(key, route) {
  const Q = new Chess(`${key} 0 1`);
  const opp = Q.turn();
  const me = other(opp);
  const lead = Q.move(route.lead);
  const Q1 = new Chess(Q.fen());
  const parts = [];
  const draw = [];
  // What the detour threatens: things it attacks that it could win (unguarded, or worth more).
  const hits = targetsOf(Q1, lead.to);
  if (lead.captured) parts.push(`${lead.san} leaves the book and takes your ${NAMES[lead.captured]} on ${lead.to}.`);
  else if (Q1.inCheck()) parts.push(`${lead.san} leaves the book with a check.`);
  else if (hits.length) {
    parts.push(`${lead.san} leaves the book and attacks ${andList(hits.map((sq) => `your ${NAMES[pieceAt(Q1, sq).type]} on ${sq}`))}.`);
    for (const sq of hits) draw.push(`r:${sq}`);
  } else parts.push(`${lead.san} leaves the book.`);
  const after = new Chess(Q1.fen());
  const reply = after.move(route.reply);
  const attacked = after
    .board()
    .flat()
    .filter((p) => p && p.color === opp && p.type !== "k" && after.attackers(p.square, me).includes(reply.to))
    .map((p) => p.square);
  const threatened = targetsOf(after, reply.to);
  if (lead.captured && reply.to === lead.to) parts.push("Take back.");
  else if (reply.captured) {
    parts.push(`Trade on ${reply.to}.`);
    draw.push(`r:${reply.to}`);
  } else if (reply.san.startsWith("O-O")) parts.push("Get your king safe first.");
  else if (hits.includes(reply.from)) parts.push(`Your ${NAMES[reply.piece]} on ${reply.from} has to move: find it a good square.`);
  else if (hits.find((sq) => after.attackers(sq, me).length > Q1.attackers(sq, me).length)) {
    const sq = hits.find((x) => after.attackers(x, me).length > Q1.attackers(x, me).length);
    parts.push(`Guard your ${NAMES[pieceAt(after, sq).type]} on ${sq}.`);
  } else if (threatened.length || attacked.length) {
    const t = threatened.length ? threatened : attacked;
    parts.push(`Hit back: there's a move that attacks ${andList(t.map((sq) => named(after, sq)))}.`);
    for (const sq of t) draw.push(`r:${sq}`);
  } else parts.push("Carry on with your setup: the next developing move is fine.");
  return { hint: parts.join(" "), draw: [...new Set(draw)].join(" ") };
}

// ---- Checks and output ----

/** Every move the text names can be shown from the position before the mistake (or played along the line). */
function unplaced(text, at, now, played) {
  const bad = [];
  for (const part of splitSquares(text, { at, now, played }))
    if (typeof part !== "string" && /^[wb]:/.test(part.ref) && /^[KQRBN]|^[a-h]x|^O-/.test(part.text) && !part.place?.uci) bad.push(part.text);
  return bad;
}

const trapNotes = {};
const detourNotes = {};
let done = 0;
let problems = 0;
for (const [key, list] of Object.entries(TRAPS)) {
  if (ONLY && !key.includes(ONLY)) continue;
  for (const trap of list) {
    if (done >= LIMIT) break;
    const note = await explainTrap(key, trap);
    // Checked the way the trainer shows it: from the position before the mistake, the line played.
    const P = new Chess(`${key} 0 1`);
    const at = P.fen();
    const sans = [trap.san, ...(trap.cont?.length ? trap.cont : [trap.best])];
    const fens = [at];
    for (const s of sans) {
      P.move(s);
      fens.push(P.fen());
    }
    const bad = [...unplaced(note.hint, at, fens[1], { fens: fens.slice(0, 2), sans: sans.slice(0, 1) }), ...unplaced(note.why, at, fens[1], { fens, sans })];
    if (bad.length) {
      problems++;
      console.error(`\n${key} ${trap.san}: can't place ${bad.join(", ")}`);
    }
    (trapNotes[key] ??= {})[trap.san] = note;
    done++;
    if (PRINT) console.log(`\n${key}  ${trap.san}? ${sans.slice(1).join(" ")}\n  HINT ${note.hint}  {${note.draw}}\n  WHY  ${note.why}${Object.values(note.steps).map((s) => `\n  STEP ${s[0]}`).join("")}`);
    else process.stdout.write(`\r${done} traps`);
  }
}
for (const [key, list] of Object.entries(ROUTES)) {
  if (ONLY && !key.includes(ONLY)) continue;
  for (const route of list) {
    const note = explainDetour(key, route);
    (detourNotes[key] ??= {})[route.lead] = note;
    if (PRINT) console.log(`\nDETOUR ${route.lead} → ${route.reply}: ${note.hint}  {${note.draw}}`);
  }
}
engine.terminate?.();

if (!ONLY && LIMIT === Infinity)
  writeFileSync(
    OUT,
    `// Generated by scripts/explain-traps.mjs: don't edit by hand, run it again after find-traps.mjs.
// Why each stored trap (traps.ts) loses and what to look for, worked out from the board and Stockfish:
// keyed like TRAPS (the position before the mistake), then by the mistake. Moves in the text are
// written as lines from the position before the mistake ("b4 exf4 Bxf4 Bxc3"), so they can be shown.
// DETOUR_NOTES: a hint for the student's answer to each detour (ROUTES), keyed the same way by its lead.
import type { DetourNote, TrapNote } from "./blunders";

export const TRAP_NOTES: Record<string, Record<string, TrapNote>> = ${JSON.stringify(trapNotes, null, 1)};

export const DETOUR_NOTES: Record<string, Record<string, DetourNote>> = ${JSON.stringify(detourNotes, null, 1)};
`,
  );
console.log(`\n${done} traps, ${problems} with moves that can't be shown`);
// A move the board can't show only loses its hover there: worth a look, not a failed run.
process.exit(0);
