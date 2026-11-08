// The Profile menu: what goes wrong in the student's real games (the weakness dashboard) and every
// rating they have, over time. "Real games" are rated games here and games imported from
// chess.com and Lichess; practice games had help on, so they don't count.
import { useMemo, useState } from "react";
import { startDrills } from "../analysis/drillSession";
import { useBacklog } from "../analysis/review";
import { go } from "../nav";
import { startPuzzles } from "../puzzles/session";
import { themeLabel, usePuzzleDb } from "../puzzles/puzzles";
import { fromLichess, signed } from "../rating";
import { useSettings } from "../settings";
import { SITE_NAME, type ImportSite } from "../store";
import { LineChart, Legend, type ChartSeries } from "./Chart";
import { BLOCKED, Tile, useRead, useSessionsBlocked } from "./Home";
import { ImportDialog } from "./ImportDialog";
import { GamesDialog } from "./GameDialogs";

const OFFLINE = "Your games are on the computer; open the app there or from the home server.";

// ---- The menu ----

export function ProfileMenu() {
  const [dialog, setDialog] = useState<"import" | "saved" | null>(null);
  const backlog = useBacklog();
  const accounts = useSettings((s) => [s.chesscomUser && "chess.com", s.lichessUser && "Lichess"].filter(Boolean).join(" and "));
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
                ? `Get your latest games from ${accounts}`
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
          <div className="stat-row">
            <div>
              <span className="stat-big">{s.games}</span>
              <span className="muted small">
                games · {s.wins}W {s.draws}D {s.losses}L
              </span>
            </div>
            <div>
              <span className="stat-big">{per(s.blunders)}</span>
              <span className="muted small">blunders a game</span>
            </div>
            <div>
              <span className="stat-big">{per(s.mistakes)}</span>
              <span className="muted small">mistakes a game</span>
            </div>
            <div>
              <span className="stat-big">{s.avgCpLoss ?? "–"}</span>
              <span className="muted small">avg centipawn loss</span>
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

          <h3 className="sub-title">By phase</h3>
          <table className="stat-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Moves</th>
                <th>Mistakes per 100 moves</th>
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
                    <td>{p?.blunders ?? 0}</td>
                    <td>{p?.avgCpLoss ?? "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {data.colors.length > 0 && (
            <>
              <h3 className="sub-title">By color</h3>
              <table className="stat-table">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Games</th>
                    <th>Score</th>
                    <th>Avg loss</th>
                  </tr>
                </thead>
                <tbody>
                  {data.colors.map((c) => (
                    <tr key={c.color}>
                      <td>{c.color === "white" ? "White" : "Black"}</td>
                      <td>{c.games}</td>
                      <td>{Math.round((100 * c.points) / c.games)}%</td>
                      <td>{c.avgCpLoss ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {data.openings.length > 0 && (
            <>
              <h3 className="sub-title">Openings</h3>
              <table className="stat-table">
                <thead>
                  <tr>
                    <th>Opening</th>
                    <th>Games</th>
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
                      <td>{Math.round((100 * o.points) / o.games)}%</td>
                      <td>{o.avgCpLoss ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {(data.puzzles?.themes.length ?? 0) > 0 && (
            <>
              <h3 className="sub-title">Weakest puzzle themes</h3>
              <div className="theme-picks">
                {data.puzzles!.themes.slice(0, 4).map((t) => (
                  <button key={t.theme} onClick={() => startPuzzles({ theme: t.theme, opening: null })} disabled={blocked}>
                    <strong>{themeLabel(t.theme)}</strong>
                    <span className="muted small">
                      {t.pct}% of {t.n}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

/** Mistakes and blunders a game, averaged over the last five games, oldest first. */
function Trend({ trend }: { trend: Weakness["trend"] }) {
  const window = 5;
  const points = trend.map((_, i) => {
    const slice = trend.slice(Math.max(0, i - window + 1), i + 1);
    return { x: i, y: slice.reduce((n, g) => n + g.blunders + g.mistakes, 0) / slice.length };
  });
  const series: ChartSeries[] = [{ key: "errors", label: "Mistakes and blunders a game", slot: 1, points }];
  return (
    <>
      <h3 className="sub-title">
        Mistakes a game <span className="muted small">· average of the last {window} games, oldest to newest</span>
      </h3>
      <LineChart
        series={series}
        xKind="index"
        yLabel="Mistakes and blunders a game"
        format={(y) => y.toFixed(1)}
        xFormat={(x) => trend[Math.round(x)]?.date ?? ""}
      />
    </>
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
