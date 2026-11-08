// The Profile menu: what goes wrong in the student's real games (the weakness dashboard) and every
// rating they have, over time. "Real games" are rated games here and games imported from
// chess.com and Lichess; practice games had help on, so they don't count.
import { useEffect, useMemo, useState } from "react";
import { loadAccounts, useAccounts } from "../games/import";
import { startDrills } from "../analysis/drillSession";
import { useBacklog } from "../analysis/review";
import { go } from "../nav";
import { startPuzzles } from "../puzzles/session";
import { themeLabel, usePuzzleDb } from "../puzzles/puzzles";
import { fromLichess, signed } from "../rating";
import { useSettings } from "../settings";
import { SITE_NAME, type ImportSite } from "../store";
import { BarRows, Meter, StackBar, scoreColor } from "./Bars";
import { LineChart, Legend, type ChartSeries } from "./Chart";
import { BLOCKED, Tile, useRead, useSessionsBlocked } from "./Home";
import { ImportDialog } from "./ImportDialog";
import { GamesDialog } from "./GameDialogs";

const OFFLINE = "Your games are on the computer; open the app there or from the home server.";

// ---- The menu ----

export function ProfileMenu() {
  const [dialog, setDialog] = useState<"import" | "saved" | null>(null);
  const backlog = useBacklog();
  const accounts = useAccounts((s) => s.list?.filter((a) => a.account).length ?? 0);
  useEffect(() => void loadAccounts().catch(() => undefined), []);
  const rating = useSettings((s) => s.playerRating);
  const pdb = usePuzzleDb();
  const { data } = useRead<Weakness>("db_weakness", { source: "all", last: 50 }, OFFLINE);
  const leaks = data ? findLeaks(data).slice(0, 2) : [];
  return (
    <>
      <h2 className="section-title">Profile</h2>
      <div className="stat-row">
        <div>
          <span className="stat-big">{rating ?? "–"}</span>
          <span className="muted small">game rating here</span>
        </div>
        {pdb.installed && (
          <div>
            <span className="stat-big">{fromLichess(pdb.rating)}</span>
            <span className="muted small">puzzle rating</span>
          </div>
        )}
        {data?.summary && (
          <div>
            <span className="stat-big">{data.summary.games}</span>
            <span className="muted small">real games reviewed</span>
          </div>
        )}
      </div>
      <div className="menu-grid">
        <Tile
          icon="⚠"
          title="Weaknesses"
          sub={leaks.length ? `Biggest: ${leaks.map((l) => l.title.toLowerCase()).join(", ")}` : "What keeps going wrong in your games"}
          onClick={() => go("weaknesses")}
        />
        <Tile icon="↗" title="Rating history" sub="Game, puzzle, chess.com and Lichess ratings over time" onClick={() => go("ratings")} />
        <Tile icon="☰" title="Saved games" sub="Every game: open, review or delete" onClick={() => setDialog("saved")} />
        <Tile
          icon="⇩"
          title="Import games"
          sub={
            backlog
              ? `Reviewing imported games: ${backlog.done} of ${backlog.total}`
              : accounts
                ? `${accounts} account${accounts > 1 ? "s" : ""}: get new games, add or remove`
                : "Your games from chess.com and Lichess"
          }
          onClick={() => setDialog("import")}
        />
      </div>
      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === "saved" && <GamesDialog onClose={() => setDialog(null)} />}
    </>
  );
}

// ---- Weaknesses ----

interface Phase {
  phase: "opening" | "middlegame" | "endgame" | null;
  moves: number;
  games: number;
  avgCpLoss: number | null;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
}

interface Weakness {
  summary: {
    games: number;
    wins: number;
    draws: number;
    losses: number;
    moves: number;
    avgCpLoss: number | null;
    blunders: number;
    mistakes: number;
    inaccuracies: number;
    waiting: number;
  } | null;
  phases: Phase[];
  tags: { tag: string; count: number; games: number; blunders: number }[];
  colors: { color: "white" | "black"; games: number; points: number; avgCpLoss: number | null }[];
  openings: { color: "white" | "black"; opening: string; games: number; points: number; avgCpLoss: number | null }[];
  trend: { id: number; date: string; source: string | null; avgCpLoss: number | null; blunders: number; mistakes: number }[];
  puzzles: { themes: { theme: string; n: number; pct: number }[] } | null;
}

interface Action {
  label: string;
  run: () => void;
  /** Starts a puzzle or drill session (not while a rated or timed game is on). */
  session?: boolean;
}

interface Leak {
  key: string;
  title: string;
  detail: string;
  stat: string;
  /** How much it costs: the share of games it turned up in, blunders counting double. */
  weight: number;
  actions: Action[];
}

/** What each review tag (analysis/review.ts tagsFor) means for the student, and what trains it. */
const TAGS: Record<string, { title: string; detail: string; theme?: string; themeName?: string }> = {
  "hung-piece": {
    title: "Leaving pieces hanging",
    detail: "Your move let the opponent win a piece. Before you move, ask what the move leaves undefended.",
    theme: "hangingPiece",
  },
  "missed-capture": {
    title: "Missing free material",
    detail: "Your opponent left something to take and you played something else. Look at every capture first.",
    theme: "hangingPiece",
  },
  "missed-mate": {
    title: "Missing checkmates",
    detail: "You had a forced mate and let it go. When the enemy king is short of squares, look for mate first.",
    theme: "mateIn2",
  },
  "allowed-mate": {
    title: "Walking into mate",
    detail: "Your move allowed a forced mate. Check every check your opponent has before you move.",
    theme: "defensiveMove",
  },
  "missed-check": {
    title: "Not looking at checks",
    detail: "A check was the strong move and you didn't play it. Checks, captures and threats, every move.",
    theme: "attraction",
  },
  "time-trouble": {
    title: "Blunders in time trouble",
    detail: "Mistakes made with little time left. Spend less time early on, or play with increment.",
  },
  rushed: {
    title: "Moving too fast",
    detail: "Mistakes played in under three seconds. Even with a quick move, take a look at what it allows.",
  },
};

const PHASE_NAME = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" } as const;

/** Errors (mistakes and blunders) per 100 moves of a phase. */
const errorRate = (p: Phase) => (p.moves ? (100 * (p.mistakes + p.blunders)) / p.moves : 0);

/** The weaknesses worth acting on, biggest first. */
function findLeaks(w: Weakness): Leak[] {
  const games = w.summary?.games ?? 0;
  if (!games) return [];
  const leaks: Leak[] = [];
  for (const t of w.tags) {
    const info = TAGS[t.tag];
    if (!info || t.games < 2) continue;
    const actions: Action[] = [{ label: "Drill these positions", run: () => startDrills(false, t.tag), session: true }];
    if (info.theme)
      actions.push({ label: `Puzzles: ${themeLabel(info.theme)}`, run: () => startPuzzles({ theme: info.theme, opening: null }), session: true });
    leaks.push({
      key: t.tag,
      title: info.title,
      detail: info.detail,
      stat: `${t.count}× in ${t.games} of ${games} games${t.blunders ? `, ${t.blunders} of them blunders` : ""}`,
      weight: (t.games + t.blunders) / games,
      actions,
    });
  }
  // The phase where the student goes wrong most often, when it stands out.
  const phases = w.phases.filter((p) => p.phase && p.moves >= 30);
  const total = phases.reduce((n, p) => n + p.moves, 0);
  const overall = total ? (100 * phases.reduce((n, p) => n + p.mistakes + p.blunders, 0)) / total : 0;
  const worst = [...phases].sort((a, b) => errorRate(b) - errorRate(a))[0];
  if (worst?.phase && phases.length > 1 && errorRate(worst) >= overall * 1.3) {
    const actions: Action[] =
      worst.phase === "endgame"
        ? [
            { label: "Endgame trainer", run: () => go("endgames") },
            { label: "Puzzles: Endgame", run: () => startPuzzles({ theme: "endgame", opening: null }), session: true },
          ]
        : worst.phase === "opening"
          ? [{ label: "Opening training", run: () => go("openings") }]
          : [{ label: "Puzzles: Middlegame", run: () => startPuzzles({ theme: "middlegame", opening: null }), session: true }];
    leaks.push({
      key: `phase-${worst.phase}`,
      title: `The ${worst.phase}`,
      detail: `You make ${errorRate(worst).toFixed(1)} mistakes per 100 moves in the ${worst.phase}, against ${overall.toFixed(1)} overall.`,
      stat: `${worst.mistakes + worst.blunders} mistakes and blunders in ${worst.moves} moves`,
      weight: errorRate(worst) / Math.max(1, overall) - 0.8,
      actions,
    });
  }
  // An opening that keeps going badly.
  for (const o of w.openings) {
    if (o.games < 3 || o.points / o.games >= 0.4) continue;
    leaks.push({
      key: `opening-${o.color}-${o.opening}`,
      title: `${o.opening} as ${o.color}`,
      detail: `You score ${Math.round((100 * o.points) / o.games)}% in it${o.avgCpLoss !== null ? `, losing ${o.avgCpLoss} centipawns a move in the first dozen moves` : ""}.`,
      stat: `${o.points} of ${o.games} points`,
      weight: (o.games / games) * (1 - o.points / o.games),
      actions: [{ label: "Opening training", run: () => go("openings") }],
    });
  }
  return leaks.sort((a, b) => b.weight - a.weight);
}

const SCOPES = [
  { id: "all", label: "All real games" },
  { id: "app", label: "Rated here" },
  { id: "imported", label: "chess.com & Lichess" },
] as const;
const LASTS = [20, 50, 1000];

export function Weaknesses() {
  const [source, setSource] = useState<(typeof SCOPES)[number]["id"]>("all");
  const [last, setLast] = useState(50);
  const [importing, setImporting] = useState(false);
  const blocked = useSessionsBlocked();
  const backlog = useBacklog();
  const { data, error } = useRead<Weakness>("db_weakness", { source, last }, OFFLINE);
  const leaks = useMemo(() => (data ? findLeaks(data) : []), [data]);
  const s = data?.summary;
  const per = (n: number) => (s && s.games ? (n / s.games).toFixed(1) : "–");

  return (
    <>
      <h2 className="section-title">Weaknesses</h2>
      <div className="filter-row">
        <div className="segmented">
          {SCOPES.map((o) => (
            <button key={o.id} className={o.id === source ? "on" : ""} onClick={() => setSource(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="segmented">
          {LASTS.map((n) => (
            <button key={n} className={n === last ? "on" : ""} onClick={() => setLast(n)}>
              {n >= 1000 ? "All" : `Last ${n}`}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="muted">{error}</p>}
      {(s?.waiting ?? 0) > 0 && (
        <p className="muted small">
          {s!.waiting} more game{s!.waiting > 1 ? "s are" : " is"} waiting for review
          {backlog ? ` (reviewing: ${backlog.done} of ${backlog.total})` : ""}; they'll count once reviewed.
        </p>
      )}
      {s && s.games === 0 && (
        <div className="empty-state">
          <p>No reviewed real games yet. Weaknesses come from rated games here and the games you import.</p>
          <div className="segmented">
            <button className="primary" onClick={() => setImporting(true)}>
              Import from chess.com or Lichess
            </button>
            <button onClick={() => go("games")}>Play a rated game</button>
          </div>
        </div>
      )}
      {s && s.games > 0 && (
        <>
          <div className="viz-cards">
            <div className="viz-card">
              <h4>
                Results <span className="muted small">· {s.games} games, {Math.round((100 * (s.wins + s.draws / 2)) / s.games)}% score</span>
              </h4>
              <StackBar
                parts={[
                  { key: "w", label: "Won", value: s.wins, color: "var(--accent)" },
                  { key: "d", label: "Drawn", value: s.draws, color: "var(--draw)" },
                  { key: "l", label: "Lost", value: s.losses, color: "var(--sev-3)" },
                ]}
              />
            </div>
            <div className="viz-card">
              <h4>
                Errors a game{" "}
                <span className="muted small">
                  · {per(s.inaccuracies + s.mistakes + s.blunders)} in all
                  {s.avgCpLoss !== null ? `, ${s.avgCpLoss} centipawns lost a move` : ""}
                </span>
              </h4>
              <StackBar
                format={(v) => v.toFixed(1)}
                parts={[
                  { key: "i", label: "Inaccuracies", value: s.inaccuracies / s.games, color: "var(--sev-1)" },
                  { key: "m", label: "Mistakes", value: s.mistakes / s.games, color: "var(--sev-2)" },
                  { key: "b", label: "Blunders", value: s.blunders / s.games, color: "var(--sev-3)" },
                ]}
              />
            </div>
          </div>

          <h3 className="sub-title">Your biggest leaks</h3>
          {leaks.length === 0 && <p className="muted">Nothing stands out yet. Patterns show once a few more games are reviewed.</p>}
          <div className="leak-list">
            {leaks.slice(0, 6).map((l, i) => (
              <div key={l.key} className="leak">
                <div className="leak-head">
                  <span className="leak-rank">{i + 1}</span>
                  <strong>{l.title}</strong>
                  <span className="muted small">{l.stat}</span>
                </div>
                <Meter value={l.weight / leaks[0].weight} label={`How much it costs, next to your biggest leak`} />
                <p className="muted small">{l.detail}</p>
                <div className="leak-actions">
                  {l.actions.map((a) => (
                    <button key={a.label} onClick={a.run} disabled={a.session && blocked} title={a.session && blocked ? BLOCKED : undefined}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {data.trend.length >= 3 && <Trend trend={data.trend} />}

          <Phases phases={data.phases} />

          {data.colors.length > 0 && (
            <>
              <h3 className="sub-title">
                By color <span className="muted small">· your score with each side</span>
              </h3>
              <BarRows
                max={100}
                reference={50}
                referenceLabel="50%: as many points won as lost"
                rows={data.colors.map((c) => {
                  const pct = Math.round((100 * c.points) / c.games);
                  return {
                    key: c.color,
                    label: c.color === "white" ? "♔ White" : "♚ Black",
                    sub: `${c.games} games${c.avgCpLoss !== null ? ` · ${c.avgCpLoss} cp a move` : ""}`,
                    parts: [{ value: pct, color: scoreColor(pct), label: "Score %" }],
                    value: `${pct}%`,
                  };
                })}
              />
            </>
          )}

          {data.openings.length > 0 && (
            <>
              <h3 className="sub-title">
                Openings <span className="muted small">· your score in each, most played first</span>
              </h3>
              <BarRows
                max={100}
                reference={50}
                referenceLabel="50%: even"
                rows={data.openings.map((o) => {
                  const pct = Math.round((100 * o.points) / o.games);
                  return {
                    key: `${o.color}-${o.opening}`,
                    label: o.opening,
                    sub: `as ${o.color} · ${o.games} games`,
                    parts: [{ value: pct, color: scoreColor(pct), label: "Score %" }],
                    value: `${pct}%`,
                  };
                })}
              />
            </>
          )}

          {(data.puzzles?.themes.length ?? 0) > 0 && (
            <>
              <h3 className="sub-title">
                Weakest puzzle themes <span className="muted small">· share solved; tap one to train it</span>
              </h3>
              <BarRows
                max={100}
                rows={data.puzzles!.themes.slice(0, 6).map((t) => ({
                  key: t.theme,
                  label: themeLabel(t.theme),
                  sub: `${t.n} tried`,
                  parts: [{ value: t.pct, color: scoreColor(t.pct), label: "Solved %" }],
                  value: `${t.pct}%`,
                  onClick: () => startPuzzles({ theme: t.theme, opening: null }),
                  disabled: blocked,
                  title: blocked ? BLOCKED : undefined,
                }))}
              />
            </>
          )}

          <NumbersTable data={data} />
        </>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

/** Mistakes and blunders a game, averaged over the last five games, oldest first, with a verdict. */
function Trend({ trend }: { trend: Weakness["trend"] }) {
  const window = 5;
  const errors = (g: Weakness["trend"][number]) => g.blunders + g.mistakes;
  const points = trend.map((_, i) => {
    const slice = trend.slice(Math.max(0, i - window + 1), i + 1);
    return { x: i, y: slice.reduce((n, g) => n + errors(g), 0) / slice.length };
  });
  const series: ChartSeries[] = [{ key: "errors", label: "Mistakes and blunders a game", slot: 1, points }];
  // Older half against newer half: the one sentence the line is there to show.
  const half = Math.floor(trend.length / 2);
  const avg = (list: typeof trend) => list.reduce((n, g) => n + errors(g), 0) / Math.max(1, list.length);
  const [before, after] = [avg(trend.slice(0, half)), avg(trend.slice(trend.length - half))];
  const change = before ? (after - before) / before : 0;
  const verdict =
    Math.abs(change) < 0.15
      ? { cls: "", text: "About the same lately" }
      : change < 0
        ? { cls: "good", text: "▼ Fewer mistakes lately" }
        : { cls: "bad", text: "▲ More mistakes lately" };
  return (
    <>
      <h3 className="sub-title">
        Mistakes a game <span className="muted small">· average of the last {window} games, oldest to newest</span>
      </h3>
      {trend.length >= 6 && (
        <p className={`trend-verdict ${verdict.cls}`}>
          <strong>{verdict.text}</strong>{" "}
          <span className="muted small">
            {before.toFixed(1)} a game in your older {half} games, {after.toFixed(1)} in your newer {half}
          </span>
        </p>
      )}
      <LineChart
        series={series}
        xKind="index"
        yLabel="Mistakes and blunders a game"
        format={(y) => y.toFixed(1)}
        xFormat={(x) => trend[Math.round(x)]?.date ?? ""}
        minPad={0.5}
      />
    </>
  );
}

/** Mistakes and blunders per 100 moves in each phase, against the student's overall rate. */
function Phases({ phases }: { phases: Phase[] }) {
  const list = (["opening", "middlegame", "endgame"] as const).map((ph) => ({ ph, p: phases.find((x) => x.phase === ph) }));
  const moves = list.reduce((n, { p }) => n + (p?.moves ?? 0), 0);
  if (!moves) return null;
  const overall = (100 * list.reduce((n, { p }) => n + (p ? p.mistakes + p.blunders : 0), 0)) / moves;
  const rates = list.map(({ p }) => (p ? errorRate(p) : 0));
  const worst = list[rates.indexOf(Math.max(...rates))];
  const per100 = (n: number, p?: Phase) => (p?.moves ? (100 * n) / p.moves : 0);
  const standsOut = !!worst.p && errorRate(worst.p) >= overall * 1.15;
  return (
    <>
      <h3 className="sub-title">
        By phase <span className="muted small">· mistakes and blunders per 100 of your moves</span>
      </h3>
      {standsOut && (
        <p className="trend-verdict bad">
          <strong>▲ Most errors in the {worst.ph}</strong>{" "}
          <span className="muted small">
            {errorRate(worst.p!).toFixed(1)} per 100 moves, against {overall.toFixed(1)} overall
          </span>
        </p>
      )}
      <BarRows
        max={Math.max(...rates, overall) * 1.15}
        reference={overall}
        referenceLabel={`Your average: ${overall.toFixed(1)} per 100 moves`}
        rows={list.map(({ ph, p }) => ({
          key: ph,
          label: PHASE_NAME[ph],
          sub: p ? `${p.moves} moves${p.avgCpLoss !== null ? ` · ${p.avgCpLoss} cp a move` : ""}` : "no moves yet",
          strong: standsOut && ph === worst.ph,
          parts: [
            { value: per100(p?.mistakes ?? 0, p), color: "var(--sev-2)", label: "Mistakes per 100 moves" },
            { value: per100(p?.blunders ?? 0, p), color: "var(--sev-3)", label: "Blunders per 100 moves" },
          ],
          value: p ? errorRate(p).toFixed(1) : "–",
        }))}
      />
      <div className="stackbar-legend">
        <span>
          <span className="chart-swatch" style={{ background: "var(--sev-2)" }} />
          Mistakes
        </span>
        <span>
          <span className="chart-swatch" style={{ background: "var(--sev-3)" }} />
          Blunders
        </span>
      </div>
    </>
  );
}

/** Every number behind the charts, for anyone who wants them exact. */
function NumbersTable({ data }: { data: Weakness }) {
  return (
    <details className="chart-table">
      <summary>Show the numbers</summary>
      <table className="stat-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Moves</th>
            <th>Errors per 100 moves</th>
            <th>Inaccuracies</th>
            <th>Mistakes</th>
            <th>Blunders</th>
            <th>Avg loss</th>
          </tr>
        </thead>
        <tbody>
          {(["opening", "middlegame", "endgame"] as const).map((ph) => {
            const p = data.phases.find((x) => x.phase === ph);
            return (
              <tr key={ph}>
                <td>{PHASE_NAME[ph]}</td>
                <td>{p?.moves ?? 0}</td>
                <td>{p ? errorRate(p).toFixed(1) : "–"}</td>
                <td>{p?.inaccuracies ?? 0}</td>
                <td>{p?.mistakes ?? 0}</td>
                <td>{p?.blunders ?? 0}</td>
                <td>{p?.avgCpLoss ?? "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.colors.length > 0 && (
        <table className="stat-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>Games</th>
              <th>Points</th>
              <th>Score</th>
              <th>Avg loss</th>
            </tr>
          </thead>
          <tbody>
            {data.colors.map((c) => (
              <tr key={c.color}>
                <td>{c.color === "white" ? "White" : "Black"}</td>
                <td>{c.games}</td>
                <td>{c.points}</td>
                <td>{Math.round((100 * c.points) / c.games)}%</td>
                <td>{c.avgCpLoss ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.openings.length > 0 && (
        <table className="stat-table">
          <thead>
            <tr>
              <th>Opening</th>
              <th>Games</th>
              <th>Points</th>
              <th>Score</th>
              <th>Avg loss, moves 1–12</th>
            </tr>
          </thead>
          <tbody>
            {data.openings.map((o) => (
              <tr key={`${o.color}-${o.opening}`}>
                <td>
                  {o.opening} <span className="muted small">as {o.color}</span>
                </td>
                <td>{o.games}</td>
                <td>{o.points}</td>
                <td>{Math.round((100 * o.points) / o.games)}%</td>
                <td>{o.avgCpLoss ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.tags.length > 0 && (
        <table className="stat-table">
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Times</th>
              <th>Games</th>
              <th>Blunders</th>
            </tr>
          </thead>
          <tbody>
            {data.tags.map((t) => (
              <tr key={t.tag}>
                <td>{TAGS[t.tag]?.title ?? t.tag}</td>
                <td>{t.count}</td>
                <td>{t.games}</td>
                <td>{t.blunders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

// ---- Rating history ----

interface RatingHistoryData {
  game: [string, number][];
  puzzles: [string, number][];
  imported: { source: ImportSite; speed: string; points: [string, number][] }[];
}

const SPEEDS = ["bullet", "blitz", "rapid", "classical", "other"];
const RANGES = [
  { id: "3m", label: "3 months", days: 92 },
  { id: "1y", label: "Year", days: 366 },
  { id: "all", label: "All", days: Infinity },
] as const;

const toMs = (sqlite: string) => new Date(sqlite.replace(" ", "T") + "Z").getTime();

export function RatingHistory() {
  const { data, error } = useRead<RatingHistoryData>("db_rating_history", {}, OFFLINE);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1y");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Every rating the student has, in a fixed order so each keeps its color whatever is shown.
  const all = useMemo<ChartSeries[]>(() => {
    if (!data) return [];
    const list: Omit<ChartSeries, "slot">[] = [
      { key: "game", label: "Rated games here", points: data.game.map(([t, r]) => ({ x: toMs(t), y: r })) },
      // Puzzle ratings are Lichess numbers: shown on the chess.com scale.
      { key: "puzzles", label: "Puzzles", points: data.puzzles.map(([t, r]) => ({ x: toMs(t), y: fromLichess(r) })) },
      ...[...data.imported]
        .sort((a, b) => a.source.localeCompare(b.source) || SPEEDS.indexOf(a.speed) - SPEEDS.indexOf(b.speed))
        .map((s) => ({
          key: `${s.source}-${s.speed}`,
          label: `${SITE_NAME[s.source]} ${s.speed}`,
          points: s.points.map(([t, r]) => ({ x: toMs(t), y: r })),
        })),
    ];
    // Eight colors at most; anything past that is left out rather than given a made-up color.
    return list
      .filter((s) => s.points.length > 0)
      .slice(0, 8)
      .map((s, i) => ({ ...s, slot: i + 1 }));
  }, [data]);

  const days = RANGES.find((r) => r.id === range)!.days;
  const since = Date.now() - days * 86400_000;
  const inRange = all.map((s) => ({ ...s, points: s.points.filter((p) => p.x >= since) }));
  const visible = inRange.filter((s) => !hidden.has(s.key));
  const toggle = (key: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const change = (s: ChartSeries) => {
    if (s.points.length < 2) return s.points.length ? String(s.points[0].y) : "–";
    const first = s.points[0].y;
    const lastY = s.points[s.points.length - 1].y;
    return `${lastY} (${signed(lastY - first)})`;
  };

  return (
    <>
      <h2 className="section-title">Rating history</h2>
      <p className="section-lede muted">
        Every rating on the chess.com scale. Lichess and puzzle ratings are converted; chess.com's bullet and blitz
        ratings are their own pools, so they don't line up with rapid.
      </p>
      {error && <p className="muted">{error}</p>}
      {data && all.length === 0 && (
        <div className="empty-state">
          <p>No ratings yet. Play rated games or puzzles, or import your games to see your chess.com and Lichess ratings.</p>
          <button className="primary" onClick={() => setImporting(true)}>
            Import games
          </button>
        </div>
      )}
      {all.length > 0 && (
        <>
          <div className="filter-row">
            <div className="segmented">
              {RANGES.map((r) => (
                <button key={r.id} className={r.id === range ? "on" : ""} onClick={() => setRange(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <Legend series={inRange} hidden={hidden} onToggle={toggle} value={change} />
          {visible.some((s) => s.points.length) ? (
            <LineChart series={visible} yLabel="Rating" />
          ) : (
            <p className="muted">Nothing in this range. Pick a longer one.</p>
          )}
          <details className="chart-table">
            <summary>Show as a table</summary>
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Rating</th>
                  <th>Points</th>
                  <th>Lowest</th>
                  <th>Highest</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                {inRange
                  .filter((s) => s.points.length)
                  .map((s) => (
                    <tr key={s.key}>
                      <td>{s.label}</td>
                      <td>{s.points.length}</td>
                      <td>{Math.min(...s.points.map((p) => p.y))}</td>
                      <td>{Math.max(...s.points.map((p) => p.y))}</td>
                      <td>{s.points[s.points.length - 1].y}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}
