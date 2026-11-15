// Profile › Saved games: every game, filtered by where it was played (chess.com, Lichess, rated or
// practice here), clock, color, result and date, with games and results over time drawn from the
// same filtered list.
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { db, type GameSummary } from "../db";
import { parseTimeControl } from "../game/session";
import { ratingPool } from "../rating";
import { StackBar } from "./Bars";
import { GameRow, outcome } from "./GameDialogs";
import { ImportDialog } from "./ImportDialog";

type Source = "chesscom" | "lichess" | "rated" | "practice";
const SOURCES: { id: Source; label: string }[] = [
  { id: "chesscom", label: "chess.com" },
  { id: "lichess", label: "Lichess" },
  { id: "rated", label: "Rated here" },
  { id: "practice", label: "Practice here" },
];

type Speed = "bullet" | "blitz" | "rapid" | "classical";
const SPEEDS: { id: Speed | "all"; label: string }[] = [
  { id: "all", label: "Any clock" },
  { id: "bullet", label: "Bullet" },
  { id: "blitz", label: "Blitz" },
  { id: "rapid", label: "Rapid" },
  { id: "classical", label: "Classical & daily" },
];

type ColorFilter = "all" | "white" | "black";
const COLORS: { id: ColorFilter; label: string }[] = [
  { id: "all", label: "Either side" },
  { id: "white", label: "♔ White" },
  { id: "black", label: "♚ Black" },
];

type ResultFilter = "all" | "win" | "draw" | "loss";
const RESULTS: { id: ResultFilter; label: string }[] = [
  { id: "all", label: "Any result" },
  { id: "win", label: "Won" },
  { id: "draw", label: "Drawn" },
  { id: "loss", label: "Lost" },
];

const RANGES = [
  { id: "1m", label: "Month", days: 31 },
  { id: "3m", label: "3 months", days: 92 },
  { id: "1y", label: "Year", days: 366 },
  { id: "all", label: "All", days: Infinity },
] as const;
type Range = (typeof RANGES)[number]["id"];

interface Filters {
  sources: Source[];
  speed: Speed | "all";
  color: ColorFilter;
  result: ResultFilter;
  range: Range;
  search: string;
}
const DEFAULT: Filters = { sources: SOURCES.map((s) => s.id), speed: "all", color: "all", result: "all", range: "all", search: "" };

/** The filters survive opening a game and coming back, and a reload. */
const KEY = "cc-saved-games-filters";
function savedFilters(): Filters {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object") return { ...DEFAULT, ...v, search: "" };
  } catch {
    // Private mode or a bad value: the defaults.
  }
  return DEFAULT;
}
const useFilters = create<Filters>(savedFilters);
useFilters.subscribe(({ search: _, ...f }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    // Private mode: nothing to keep.
  }
});
const setFilter = (f: Partial<Filters>) => useFilters.setState(f);

/** Where a game was played, as the source filter names it. */
const sourceOf = (g: GameSummary): Source => g.source ?? (g.mode === "rated" ? "rated" : "practice");

/** The game's clock family. Games here split like chess.com (no clock is rapid); imports use the site's own. */
function speedOf(g: GameSummary): Speed {
  if (g.source && g.speed) {
    if (g.speed === "ultraBullet" || g.speed === "bullet") return "bullet";
    if (g.speed === "blitz") return "blitz";
    if (g.speed === "rapid") return "rapid";
    return "classical";
  }
  return g.ratingPool ?? ratingPool(parseTimeControl(g.timeControl));
}

/** SQLite datetime('now') is UTC without a zone marker. */
const playedAt = (g: GameSummary) => new Date(g.startedAt.replace(" ", "T") + "Z").getTime();

function matches(g: GameSummary, f: Filters, since: number): boolean {
  if (!f.sources.includes(sourceOf(g))) return false;
  if (f.speed !== "all" && speedOf(g) !== f.speed) return false;
  if (f.color !== "all" && g.studentColor !== f.color) return false;
  if (f.result !== "all" && outcome(g) !== f.result) return false;
  if (playedAt(g) < since) return false;
  const q = f.search.trim().toLowerCase();
  if (q && !`${g.opponentName ?? ""} ${g.openingName ?? ""}`.toLowerCase().includes(q)) return false;
  return true;
}

export function SavedGames() {
  const f = useFilters();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  /** A column picked in the chart narrows the list to that stretch of time. */
  const [picked, setPicked] = useState<Bucket | null>(null);
  const [shown, setShown] = useState(50);

  useEffect(() => {
    db.listGames(100_000).then(
      (list) => setGames([...list].sort((a, b) => playedAt(b) - playedAt(a) || b.id - a.id)),
      (e) => setError(String(e)),
    );
  }, []);

  const since = useMemo(() => Date.now() - RANGES.find((r) => r.id === f.range)!.days * 86400_000, [f.range]);
  const filtered = useMemo(() => games?.filter((g) => matches(g, f, since)) ?? [], [games, f, since]);
  // Counts on the source chips: what each would add with every other filter as it is.
  const perSource = useMemo(() => {
    const all = { ...f, sources: SOURCES.map((s) => s.id) };
    const n: Record<Source, number> = { chesscom: 0, lichess: 0, rated: 0, practice: 0 };
    for (const g of games ?? []) if (matches(g, all, since)) n[sourceOf(g)]++;
    return n;
  }, [games, f, since]);
  const buckets = useMemo(() => bucketize(filtered), [filtered]);
  useEffect(() => {
    setPicked(null);
    setShown(50);
  }, [f]);

  const list = picked ? filtered.filter((g) => playedAt(g) >= picked.start && playedAt(g) < picked.end) : filtered;
  const tally = count(filtered);
  const decided = tally.win + tally.draw + tally.loss;

  const toggleSource = (s: Source) => {
    const has = f.sources.includes(s);
    // Never all off: that's an empty screen nobody asked for. Tapping the last one on shows everything.
    const next = has ? f.sources.filter((x) => x !== s) : [...f.sources, s];
    setFilter({ sources: next.length ? next : SOURCES.map((x) => x.id) });
  };
  const onDeleted = (id: number) => setGames((l) => l?.filter((g) => g.id !== id) ?? null);
  const isDefault = JSON.stringify(f) === JSON.stringify(DEFAULT);

  return (
    <>
      <h2 className="section-title">Saved games</h2>
      {error && <p className="error">{error}</p>}
      {games?.length === 0 && (
        <div className="empty-state">
          <p>No games yet. Play one, or bring in your games from chess.com and Lichess.</p>
          <button className="primary" onClick={() => setImporting(true)}>
            Import games
          </button>
        </div>
      )}
      {games && games.length > 0 && (
        <>
          <div className="saved-filters">
            <div className="source-chips" role="group" aria-label="Where the games were played">
              {SOURCES.map((s) => (
                <button key={s.id} className={f.sources.includes(s.id) ? "on" : "off"} aria-pressed={f.sources.includes(s.id)} onClick={() => toggleSource(s.id)}>
                  <span className="chip-check" aria-hidden>
                    {f.sources.includes(s.id) ? "✓" : ""}
                  </span>
                  {s.label} <span className="muted small">{perSource[s.id]}</span>
                </button>
              ))}
            </div>
            <div className="filter-row">
              <Segmented options={RANGES} value={f.range} onChange={(range) => setFilter({ range })} />
              <Segmented options={SPEEDS} value={f.speed} onChange={(speed) => setFilter({ speed })} />
            </div>
            <div className="filter-row">
              <Segmented options={COLORS} value={f.color} onChange={(color) => setFilter({ color })} />
              <Segmented options={RESULTS} value={f.result} onChange={(result) => setFilter({ result })} />
            </div>
            <div className="filter-row">
              <input
                className="saved-search"
                type="search"
                placeholder="Opponent or opening"
                value={f.search}
                onChange={(e) => setFilter({ search: e.target.value })}
              />
              {!isDefault && (
                <button className="link-button" onClick={() => useFilters.setState(DEFAULT)}>
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="muted">No games match these filters.</p>
          ) : (
            <>
              <div className="stat-row">
                <div>
                  <span className="stat-big">{filtered.length}</span>
                  <span className="muted small">games</span>
                </div>
                {decided > 0 && (
                  <div>
                    <span className="stat-big">{Math.round((100 * (tally.win + tally.draw / 2)) / decided)}%</span>
                    <span className="muted small">score</span>
                  </div>
                )}
                <div>
                  <span className="stat-big">
                    {tally.win}–{tally.draw}–{tally.loss}
                  </span>
                  <span className="muted small">won, drawn, lost</span>
                </div>
              </div>
              {decided > 0 && (
                <StackBar
                  parts={[
                    { key: "w", label: "Won", value: tally.win, color: "var(--accent)" },
                    { key: "d", label: "Drawn", value: tally.draw, color: "var(--draw)" },
                    { key: "l", label: "Lost", value: tally.loss, color: "var(--sev-3)" },
                    { key: "n", label: "No result", value: tally.none, color: "var(--border)" },
                  ]}
                />
              )}
              <h3 className="sub-title">
                Games over time <span className="muted small">· a {buckets.unit} a column; tap one to list just those games</span>
              </h3>
              <Columns buckets={buckets.list} picked={picked} onPick={(b) => setPicked((p) => (p?.start === b.start ? null : b))} />
            </>
          )}

          {list.length > 0 && (
            <>
              <h3 className="sub-title">
                {picked ? (
                  <>
                    {picked.label} <span className="muted small">· {list.length} games</span>{" "}
                    <button className="link-button" onClick={() => setPicked(null)}>
                      Show every period
                    </button>
                  </>
                ) : (
                  <>
                    Games <span className="muted small">· newest first</span>
                  </>
                )}
              </h3>
              <div className="game-list saved-list">
                {list.slice(0, shown).map((g) => (
                  <GameRow key={g.id} g={g} onDeleted={onDeleted} />
                ))}
              </div>
              {list.length > shown && (
                <button onClick={() => setShown((n) => n + 100)}>Show more ({list.length - shown} left)</button>
              )}
            </>
          )}
        </>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function Segmented<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.id} className={o.id === value ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Games and results over time ----

interface Tally {
  win: number;
  draw: number;
  loss: number;
  /** Unfinished, or both sides played by the student. */
  none: number;
}

interface Bucket extends Tally {
  start: number;
  end: number;
  label: string;
}

function count(games: GameSummary[]): Tally {
  const t: Tally = { win: 0, draw: 0, loss: 0, none: 0 };
  for (const g of games) t[outcome(g) || "none"]++;
  return t;
}

type Unit = "day" | "week" | "month";

function floorTo(ms: number, unit: Unit): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  if (unit === "month") d.setDate(1);
  return d;
}

function step(d: Date, unit: Unit): Date {
  const n = new Date(d);
  if (unit === "day") n.setDate(n.getDate() + 1);
  else if (unit === "week") n.setDate(n.getDate() + 7);
  else n.setMonth(n.getMonth() + 1);
  return n;
}

function bucketLabel(d: Date, unit: Unit): string {
  if (unit === "month") return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (unit === "week") return `Week of ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Columns from the first game to today, empty stretches included so gaps show as gaps. The unit
 * grows with the span so there are never too many columns to read.
 */
function bucketize(games: GameSummary[]): { unit: Unit; list: Bucket[] } {
  if (!games.length) return { unit: "month", list: [] };
  const times = games.map(playedAt);
  const first = Math.min(...times);
  const span = Date.now() - first;
  const unit: Unit = span <= 31 * 86400_000 ? "day" : span <= 200 * 86400_000 ? "week" : "month";
  const list: Bucket[] = [];
  for (let d = floorTo(first, unit); d.getTime() <= Date.now(); d = step(d, unit)) {
    list.push({ start: d.getTime(), end: step(d, unit).getTime(), label: bucketLabel(d, unit), win: 0, draw: 0, loss: 0, none: 0 });
  }
  for (const g of games) {
    const t = playedAt(g);
    const b = list.find((b) => t >= b.start && t < b.end);
    if (b) b[outcome(g) || "none"]++;
  }
  return { unit, list };
}

const PARTS = [
  { key: "win", label: "Won", color: "var(--accent)" },
  { key: "draw", label: "Drawn", color: "var(--draw)" },
  { key: "loss", label: "Lost", color: "var(--sev-3)" },
  { key: "none", label: "No result", color: "var(--border)" },
] as const;

/** Stacked columns: height is games played, the stack splits it into wins, draws and losses. */
function Columns({ buckets, picked, onPick }: { buckets: Bucket[]; picked: Bucket | null; onPick: (b: Bucket) => void }) {
  const total = (b: Bucket) => b.win + b.draw + b.loss + b.none;
  const max = Math.max(1, ...buckets.map(total));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  // Axis labels at the ends and, on longer charts, a few between.
  const every = Math.max(1, Math.ceil(buckets.length / 6));
  return (
    <div className="columns-chart">
      <div className="columns-plot">
        {ticks.map((t) => (
          <div key={t} className="columns-grid" style={{ bottom: `${(100 * t) / top}%` }}>
            <span>{t}</span>
          </div>
        ))}
        <div className="columns-bars">
          {buckets.map((b) => {
            const n = total(b);
            const decided = b.win + b.draw + b.loss;
            return (
              <button
                key={b.start}
                className={`columns-bar ${picked?.start === b.start ? "picked" : ""} ${picked && picked.start !== b.start ? "dim" : ""}`}
                onClick={() => n && onPick(b)}
                disabled={!n}
                aria-label={`${b.label}: ${n} games, ${b.win} won, ${b.draw} drawn, ${b.loss} lost`}
              >
                <div className="columns-stack" style={{ height: `${(100 * n) / top}%` }}>
                  {PARTS.filter((p) => b[p.key] > 0).map((p) => (
                    <div key={p.key} style={{ flexGrow: b[p.key], background: p.color }} />
                  ))}
                </div>
                {n > 0 && (
                  <span className="bar-tip">
                    <strong>{b.label}</strong>
                    <br />
                    {n} game{n > 1 ? "s" : ""}: {b.win} won, {b.draw} drawn, {b.loss} lost
                    {b.none ? `, ${b.none} no result` : ""}
                    {decided ? ` · ${Math.round((100 * (b.win + b.draw / 2)) / decided)}% score` : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="columns-axis">
        {buckets.map((b, i) => (
          <span key={b.start}>{i % every === 0 || i === buckets.length - 1 ? shortLabel(b) : ""}</span>
        ))}
      </div>
      <div className="stackbar-legend">
        {PARTS.map((p) => (
          <span key={p.key}>
            <span className="chart-swatch" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function shortLabel(b: Bucket): string {
  const d = new Date(b.start);
  const days = (b.end - b.start) / 86400_000;
  return days > 20 ? d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whole-number gridlines up to just above `max`, about four of them. */
function niceTicks(max: number): number[] {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const s = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? mag * 10);
  const out: number[] = [];
  for (let v = s; v < max + s; v += s) out.push(v);
  return out;
}
