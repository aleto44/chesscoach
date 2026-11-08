// Compact text for the profile and game-history tools. Kept terse on purpose: every character
// here is a token the coach reads.
import { invoke } from "../backend";
import { Chess } from "chess.js";
import { opponentElo } from "../db";
import { opponentName } from "../store";
import { fromLichess } from "../rating";

type Row = Record<string, any>;

const pct = (points: number, games: number) => `${Math.round((100 * points) / games)}%`;
const pawns = (cp: number | null) => (cp === null ? "?" : (cp / 100 >= 0 ? "+" : "") + (cp / 100).toFixed(1));
const opp = (key: string | null) => {
  const r = opponentElo(key);
  return r ? `${opponentName(r)} ${r}` : "no opponent";
};
const tc = (t: string | null) => {
  const m = t?.match(/^(\d+)\+(\d+)$/);
  return m ? `${Number(m[1]) / 60}+${m[2]}` : "no clock";
};

export async function profileText(): Promise<string> {
  const p = await invoke<Row>("db_profile");
  const c = p.counts ?? {};
  const out: string[] = [
    `Rated games (unaided): ${c.rated_finished ?? 0} finished, ${c.rated_analyzed ?? 0} analyzed. ` +
      `Practice games: ${c.practice_games ?? 0} (help was available; not evidence of strength).`,
  ];
  const gr = p.gameRating;
  if (gr) {
    out.push(
      `Game rating (chess.com scale, Elo from rated games vs the bots' ratings): ${gr.rating}, ` +
        (gr.games ? `moved by ${gr.games} rated games.` : "set by the student or the default; no rated games have moved it yet."),
    );
  }
  if (!c.rated_finished) {
    out.push("No rated games yet, so there's no reliable picture of the student's level. Suggest playing a few.");
  }
  if (p.record.length) {
    out.push(
      "Record: " +
        p.record
          .map((r: Row) => `${r.color} ${r.wins}W ${r.draws}D ${r.losses}L (avg opponent ${Math.round(r.avg_opponent ?? 0)})`)
          .join(" · "),
    );
  }
  if (p.phases.length) {
    out.push(
      "By phase (student moves, avg loss in centipawns; inaccuracies/mistakes/blunders):\n" +
        p.phases
          .map(
            (r: Row) =>
              `  ${r.phase}: ${r.avg_cp_loss}cp over ${r.moves} moves; ${r.inaccuracies}/${r.mistakes}/${r.blunders}`,
          )
          .join("\n"),
    );
  }
  if (p.mistakeTags.length) {
    out.push("Patterns in mistakes/blunders: " + p.mistakeTags.map((t: Row) => `${t.tag} ${t.count}`).join(", "));
  }
  if (p.openings.length) {
    out.push(
      "Openings (rated): " +
        p.openings.map((o: Row) => `${o.color} ${o.opening}: ${o.games} games, ${pct(o.points, o.games)}`).join("; "),
    );
  }
  if (p.recentRated.length) {
    out.push(
      "Recent rated games:\n" +
        p.recentRated
          .map(
            (g: Row) =>
              `  #${g.id} ${g.date} ${g.color} vs ${opp(g.opponent)}, ${g.result} ${g.termination}, ${tc(g.time_control)}` +
              `${g.opening_name ? `, ${g.opening_name}` : ""}` +
              `${g.rating_after !== null && g.rating_after !== undefined ? `, rating ${g.rating_before}→${g.rating_after}` : ""}, avg loss ${g.avg_cp_loss ?? "?"}cp, ${g.blunders} blunders`,
          )
          .join("\n"),
    );
  }
  if (p.observations.length) {
    out.push("Your earlier observations:\n" + p.observations.map((o: Row) => `  ${o.date} [${o.tag}] ${o.note}`).join("\n"));
  }
  if (p.drills.length) {
    out.push(
      "Drills: " +
        p.drills.map((d: Row) => `${d.kind} ${d.cards} cards (${d.due} due, ${d.pct_correct ?? "–"}% correct)`).join("; "),
    );
  }
  const pz = p.puzzles;
  if (pz) {
    out.push(
      `Lichess puzzles: rating ${fromLichess(pz.rating)} (converted to the chess.com scale) after ${pz.attempts} rated puzzles; ` +
        `last ${pz.recent}: ${pz.recentPct}% solved.` +
        (pz.themes.length ? " By theme, weakest first: " + pz.themes.map((t: Row) => `${t.theme} ${t.pct}% of ${t.n}`).join(", ") : ""),
    );
  }
  return out.join("\n");
}

function uciToSan(fen: string, uci: string | null): string {
  if (!uci) return "?";
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

export async function gamesText(mode: string, limit: number, gameId: number | null): Promise<string> {
  const games = await invoke<Row[]>("db_query_games", { mode, limit, gameId });
  if (games.length === 0) return `No ${mode === "all" ? "" : mode + " "}games found.`;
  const withFen = gameId !== null || limit <= 2;
  return games
    .map((g) => {
      const head =
        `#${g.id} ${g.date} ${g.mode}, student ${g.color} vs ${opp(g.opponent)}, ${g.result ?? "unfinished"}` +
        `${g.termination ? ` ${g.termination}` : ""}, ${tc(g.time_control)}${g.opening_name ? `, ${g.opening_name}` : ""}` +
        `, ${Math.ceil(g.plies / 2)} moves${g.takebacks ? `, ${g.takebacks} takebacks` : ""}`;
      if (!g.analyzed) return `${head}\n  (not analyzed yet)`;
      const sign = g.color === "black" ? -1 : 1;
      const lines = (g.mistakes as Row[]).map((m) => {
        const [, turn, , , , full] = String(m.fen_before).split(" ");
        const num = `${full}${turn === "w" ? "." : "..."}`;
        const mark = m.class === "blunder" ? "??" : "?";
        const swing = `${pawns(m.eval_before * sign)} → ${pawns(m.eval_after * sign)}`;
        const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
        const clock = m.clock_ms !== null ? `, ${Math.round(m.clock_ms / 1000)}s left` : "";
        return `  ${num}${m.san}${mark} ${swing} (student's view), best ${uciToSan(m.fen_before, m.best_uci)}${tags}${clock}` +
          (withFen ? `\n    fen: ${m.fen_before}` : "");
      });
      return `${head}, avg loss ${g.avg_cp_loss ?? "?"}cp\n${lines.join("\n") || "  no mistakes or blunders"}`;
    })
    .join("\n");
}
