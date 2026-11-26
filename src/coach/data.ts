// The coach's read-only tools on the student's data: query_data (SQL over the database, run read-only
// by src-tauri/src/coach_data.rs), opening_lines (the trainer's built-in lines, plans, move notes and
// traps, which live in code) and training_progress (results the School trainers keep on this device).
import { Chess } from "chess.js";
import { invoke } from "../backend";
import { TRAINING_SETS, commonness, familyOf, seenCounts, shortName, type TrainingLine, type TrainingSet } from "../openings/training";
import { planOf } from "../openings/plans";
import { GUIDES } from "../openings/guides";
import { ROUTES, TRAPS } from "../openings/traps";
import { positionKey } from "../openings/blunders";
import { numbered } from "../openings/leaks";
import { endgameRecords } from "../endgames/session";
import { ENDGAMES } from "../endgames/positions";
import { planRecords } from "../plans/positions";
import { bestScores } from "../guess/session";
import { MASTER_GAMES } from "../guess/games";
import { rushBest } from "../puzzles/session";
import type { ToolResult } from "./tools";

type Args = Record<string, unknown>;

export async function queryData(args: Args): Promise<ToolResult> {
  const sql = typeof args.sql === "string" ? args.sql : "";
  try {
    const result = await invoke<unknown>("db_coach_query", { sql: sql || null });
    return { text: JSON.stringify(result) };
  } catch (e) {
    return { text: `Query failed: ${String(e)}`, isError: true };
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const lineKey = (l: TrainingLine) => l.moves.join(" ");

function findSetArg(q: string): TrainingSet | null {
  const n = norm(q);
  return (
    TRAINING_SETS.find((s) => s.id === q) ??
    TRAINING_SETS.find((s) => norm(s.name) === n) ??
    TRAINING_SETS.find((s) => norm(s.name).includes(n) || norm(s.id).includes(n)) ??
    null
  );
}

const setLabel = (s: TrainingSet) => (s.parent ? `${familyOf(s).name} › ${s.mode ?? s.name}` : s.name);

export async function openingLines(args: Args): Promise<ToolResult> {
  const seen = seenCounts();
  const setArg = typeof args.set === "string" ? args.set.trim() : "";
  const lineArg = typeof args.line === "string" ? args.line.trim() : "";
  if (!setArg && !lineArg) {
    const rows = TRAINING_SETS.map((s) => {
      const times = s.lines.reduce((n, l) => n + (seen[lineKey(l)] ?? 0), 0);
      const tried = s.lines.filter((l) => seen[lineKey(l)]).length;
      return `- ${s.id}: ${setLabel(s)}, student plays ${s.color}, ${s.lines.length} lines (${tried} practised, ${times} times in all). ${s.blurb}`;
    });
    return { text: `Opening sets in the trainer:\n${rows.join("\n")}` };
  }

  // A line name alone: look through every set.
  const sets = setArg ? [findSetArg(setArg)].filter((s): s is TrainingSet => !!s) : TRAINING_SETS;
  if (!sets.length) return { text: `No opening set like "${setArg}". Call opening_lines with no arguments for the list.`, isError: true };

  if (!lineArg) {
    const s = sets[0];
    const rows = s.lines.map(
      (l) =>
        `- ${shortName(s, l)} (${l.eco}, ${commonness(l)}): ${numbered(l.moves)}; seen ${seen[lineKey(l)] ?? 0}×` +
        `${planOf(l) ? ", has a plan" : ""}${l.name in GUIDES ? ", has move notes" : ""}${l.start ? `, starts after ply ${l.start}` : ""}`,
    );
    return { text: `${setLabel(s)} (student plays ${s.color}): ${s.blurb}\n${rows.join("\n")}` };
  }

  const n = norm(lineArg);
  const hits = sets.flatMap((s) => s.lines.filter((l) => norm(l.name).includes(n) || norm(shortName(s, l)).includes(n)).map((l) => ({ s, l })));
  if (!hits.length) return { text: `No line like "${lineArg}"${setArg ? ` in ${setLabel(sets[0])}` : ""}.`, isError: true };
  if (hits.length > 3)
    return { text: `${hits.length} lines match "${lineArg}"; be more specific:\n${hits.map(({ s, l }) => `- ${setLabel(s)}: ${l.name}`).join("\n")}` };
  return { text: hits.map(({ s, l }) => lineDetail(s, l, seen[lineKey(l)] ?? 0)).join("\n\n") };
}

function lineDetail(set: TrainingSet, line: TrainingLine, seen: number): string {
  const out = [`${line.name} (${line.eco}), set ${setLabel(set)}, student plays ${set.color}; ${commonness(line)}, seen ${seen}× on this device.`];
  out.push(`Moves: ${numbered(line.moves)}${line.start ? ` (the trainer starts with the first ${line.start} plies on the board)` : ""}`);
  const plan = planOf(line);
  if (plan) out.push(`Plan shown at the end of the line:\n${plan.map((i) => `  - ${i.title}: ${i.text}`).join("\n")}`);
  const notes = GUIDES[line.name];
  if (notes) {
    out.push(
      `Move notes (shown with Hint before the student's move number):\n` +
        Object.entries(notes)
          .map(([move, note]) => `  - move ${move}: ${typeof note === "string" ? note : note[0]}`)
          .join("\n"),
    );
  }
  // The opponent's stored mistakes along the line, and the detours to them.
  const chess = new Chess();
  const traps: string[] = [];
  for (let ply = 0; ply <= line.moves.length; ply++) {
    const fen = chess.fen();
    const opponentToMove = (chess.turn() === "w" ? "white" : "black") !== set.color;
    const key = positionKey(fen);
    const last = ply - 1;
    const at = ply === 0 ? "at the start" : `after ${Math.floor(last / 2) + 1}${last % 2 ? "..." : "."}${line.moves[last]}`;
    if (opponentToMove) {
      for (const t of TRAPS[key] ?? []) traps.push(`  - ${at}: the opponent may play ${t.san}?; punish with ${t.best}${t.cont?.length ? ` (${t.cont.join(" ")})` : ""}`);
      for (const r of ROUTES[key] ?? []) {
        let then: string[] = [];
        try {
          const off = new Chess(fen);
          off.move(r.lead);
          off.move(r.reply);
          then = (TRAPS[positionKey(off.fen())] ?? []).map((t) => `${t.san}? (punished by ${t.best})`);
        } catch {
          // A route that no longer fits the line: just name it.
        }
        traps.push(`  - ${at}: a detour ${r.lead}, answered by ${r.reply}${then.length ? `, then the opponent may play ${then.join(" or ")}` : ""}`);
      }
    }
    if (ply === line.moves.length) break;
    try {
      chess.move(line.moves[ply]);
    } catch {
      break;
    }
  }
  if (traps.length) out.push(`Opponent mistakes the trainer may play:\n${traps.join("\n")}`);
  return out.join("\n");
}

export async function trainingProgress(): Promise<ToolResult> {
  const out: string[] = [];
  const seen = seenCounts();
  const lines = TRAINING_SETS.flatMap((s) => s.lines.filter((l) => seen[lineKey(l)]).map((l) => `${setLabel(s)}: ${shortName(s, l)} ×${seen[lineKey(l)]}`));
  out.push(lines.length ? `Opening lines practised:\n${lines.map((l) => `- ${l}`).join("\n")}` : "Opening lines practised: none yet.");

  const eg = endgameRecords();
  const egRows = ENDGAMES.filter((e) => eg[e.id]).map((e) => `- ${e.group}: ${e.name}: ${eg[e.id].wins}/${eg[e.id].tries} won, last ${eg[e.id].last ?? "-"}`);
  const fromGames = Object.keys(eg).filter((id) => !ENDGAMES.some((e) => e.id === id));
  if (fromGames.length) {
    const t = fromGames.reduce((a, id) => ({ tries: a.tries + eg[id].tries, wins: a.wins + eg[id].wins }), { tries: 0, wins: 0 });
    egRows.push(`- Win it again (positions from the student's games): ${t.wins}/${t.tries} won over ${fromGames.length} positions`);
  }
  out.push(egRows.length ? `Endgame trainer:\n${egRows.join("\n")}` : "Endgame trainer: not tried yet.");

  const plans = Object.values(planRecords());
  if (plans.length) {
    const tries = plans.reduce((n, r) => n + r.tries, 0);
    const right = plans.reduce((n, r) => n + r.right, 0);
    const last = plans.reduce((m, r) => ((m[r.last ?? "none"] = (m[r.last ?? "none"] ?? 0) + 1), m), {} as Record<string, number>);
    out.push(`Find the plan: ${right}/${tries} right over ${plans.length} positions; latest tries: ${Object.entries(last).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  } else out.push("Find the plan: not tried yet.");

  const best = bestScores();
  const guess = MASTER_GAMES.filter((g) => best[g.id] !== undefined).map((g) => `- ${g.white} vs ${g.black} (${g.year}): best ${best[g.id]}%`);
  out.push(guess.length ? `Guess the move:\n${guess.join("\n")}` : "Guess the move: not tried yet.");

  const rush = rushBest();
  out.push(`Puzzle rush best: ${rush || "none yet"}.`);
  return { text: out.join("\n\n") };
}
