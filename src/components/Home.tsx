import { useEffect, useState, type ReactNode } from "react";
import { startDrills } from "../analysis/drillSession";
import { useDrillCounts } from "../analysis/drills";
import { hasBackend, invoke, openUrl } from "../backend";
import { newGame } from "../game/session";
import { timeControlLabel } from "../game/clock";
import { go, useNav } from "../nav";
import { refreshPuzzleDb, themeLabel, usePuzzleDb } from "../puzzles/puzzles";
import { startPuzzles } from "../puzzles/session";
import { fromLichess } from "../rating";
import { isLocked, opponentLabel, useStore, type GameMode } from "../store";
import { GamesDialog, NewGameDialog } from "./GameDialogs";
import { ModeBadge } from "./ModeBadge";
import { RepertoireDialog } from "./RepertoireDialog";

/** Drills and puzzles would leave a rated game's clock (or position) sitting mid-game. */
export function useSessionsBlocked() {
  const meta = useStore((s) => s.meta);
  const started = useStore((s) => s.game.sans.length > 0);
  return !meta.result && (isLocked(meta) || (meta.timeControl !== null && started));
}

const BLOCKED = "Finish your current game first";

/** The left column when no board is showing: the home menu and each section's menu. */
export function Home() {
  const view = useNav((n) => n.view);
  return (
    <main className="home-panel">
      <div className="home-inner">
        {view === "home" && <MainMenu />}
        {view === "games" && <GamesMenu />}
        {view === "drills" && <DrillsMenu />}
        {view === "drill-history" && <DrillHistory />}
        {view === "puzzles" && <PuzzlesMenu />}
        {view === "puzzle-history" && <PuzzleHistory />}
      </div>
    </main>
  );
}

function Tile({
  icon,
  title,
  sub,
  onClick,
  disabled,
  badge,
  big,
}: {
  icon: string;
  title: string;
  sub: ReactNode;
  onClick: () => void;
  disabled?: boolean | string;
  badge?: ReactNode;
  big?: boolean;
}) {
  return (
    <button
      className={`menu-tile ${big ? "big" : ""}`}
      onClick={onClick}
      disabled={!!disabled}
      title={typeof disabled === "string" ? disabled : undefined}
    >
      <span className="menu-icon" aria-hidden>
        {icon}
      </span>
      <span className="menu-text">
        <span className="menu-title">
          {title}
          {badge}
        </span>
        <span className="menu-sub">{typeof disabled === "string" ? disabled : sub}</span>
      </span>
    </button>
  );
}

/** The open game, if it's still being played: a way back to it from any menu. */
function ResumeGame() {
  const meta = useStore((s) => s.meta);
  const moves = useStore((s) => s.game.sans.length);
  if (meta.result || moves === 0) return null;
  return (
    <button className="resume" onClick={() => go("board")}>
      <span className="resume-label">Game in progress</span>
      <span className="resume-what">
        {meta.studentColor !== "both" && <ModeBadge mode={meta.mode} />} {opponentLabel(meta)}
        {meta.timeControl && ` · ${timeControlLabel(meta.timeControl)}`} · move {Math.ceil(moves / 2)}
      </span>
      <span className="resume-go">Continue ›</span>
    </button>
  );
}

function MainMenu() {
  const drills = useDrillCounts();
  const pdb = usePuzzleDb();
  return (
    <>
      <h1 className="home-title">
        <span className="brand-mark" aria-hidden>
          ♞
        </span>{" "}
        Chess Coach
      </h1>
      <ResumeGame />
      <div className="menu-grid main">
        <Tile big icon="♟" title="Games" sub="Practice and rated games, your saved games" onClick={() => go("games")} />
        <Tile
          big
          icon="↻"
          title="Drills"
          sub={drills.total ? `${drills.due} due of ${drills.total}` : "Practice positions from your games"}
          badge={drills.due ? <span className="count">{drills.due}</span> : null}
          onClick={() => go("drills")}
        />
        <Tile
          big
          icon="✦"
          title="Puzzles"
          sub={pdb.installed ? `Rating ${fromLichess(pdb.rating)}` : "Tactics from real games"}
          onClick={() => go("puzzles")}
        />
      </div>
    </>
  );
}

function GamesMenu() {
  const [dialog, setDialog] = useState<GameMode | "saved" | "repertoire" | null>(null);
  const hasGame = useStore((s) => s.gameId !== null || s.game.sans.length > 0);
  const close = () => setDialog(null);
  return (
    <>
      <h2 className="section-title">Games</h2>
      <ResumeGame />
      <div className="menu-grid">
        <Tile icon="▶" title="Practice game" sub="Engine, coach and takebacks whenever you want" onClick={() => setDialog("practice")} />
        <Tile icon="★" title="Rated game" sub="No help. Shows how you really play" onClick={() => setDialog("rated")} />
        <Tile
          icon="⊞"
          title="Analysis board"
          sub="Move both sides freely and ask the coach"
          onClick={async () => {
            await newGame({ mode: "practice", studentColor: "both", opponentElo: null });
            go("board");
          }}
        />
        <Tile icon="☰" title="Saved games" sub="Open, review or delete past games" onClick={() => setDialog("saved")} />
        <Tile icon="♜" title="Opening repertoire" sub="The lines you want to play" onClick={() => setDialog("repertoire")} />
        {hasGame && <Tile icon="◻" title="Current board" sub="Back to the last game you opened" onClick={() => go("board")} />}
      </div>
      {(dialog === "practice" || dialog === "rated") && <NewGameDialog mode={dialog} onClose={close} />}
      {dialog === "saved" && <GamesDialog onClose={close} />}
      {dialog === "repertoire" && <RepertoireDialog onClose={close} />}
    </>
  );
}

interface DrillOverview {
  kinds: { kind: "mistake" | "opening" | "coach" | "puzzle"; cards: number; due: number; pctCorrect: number | null }[];
  recent: { id: number; at: string; correct: number; played: string; kind: string; title: string }[];
}

const KIND_LABEL: Record<string, string> = {
  mistake: "From your games",
  opening: "Repertoire",
  coach: "From the coach",
  puzzle: "Missed puzzles",
};

function useDrillOverview(limit: number) {
  const [data, setData] = useState<DrillOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!hasBackend()) return setError("Drills are saved on the computer; open the app there or from the home server.");
    invoke<DrillOverview>("db_drill_overview", { limit }).then(setData, (e) => setError(String(e)));
  }, [limit]);
  return { data, error };
}

function DrillsMenu() {
  const counts = useDrillCounts();
  const blocked = useSessionsBlocked();
  const [repertoire, setRepertoire] = useState(false);
  const { data } = useDrillOverview(0);
  return (
    <>
      <h2 className="section-title">Drills</h2>
      <p className="section-lede muted">
        Positions you got wrong come back on a schedule until they stick: mistakes from your analyzed games, missed
        puzzles, your repertoire, and positions the coach set.
      </p>
      <div className="menu-grid">
        <Tile
          icon="▶"
          title="Due drills"
          sub={counts.due ? `${counts.due} waiting for review` : "Nothing due right now"}
          badge={counts.due ? <span className="count">{counts.due}</span> : null}
          disabled={blocked ? BLOCKED : !counts.due}
          onClick={() => startDrills()}
        />
        <Tile
          icon="↻"
          title="Practice all"
          sub={`Every drill, due or not (${counts.total})`}
          disabled={blocked ? BLOCKED : !counts.total}
          onClick={() => startDrills(true)}
        />
        <Tile icon="☰" title="Drill history" sub="What you got right and wrong lately" onClick={() => go("drill-history")} />
        <Tile icon="♜" title="Opening repertoire" sub="Repertoire drills come from these lines" onClick={() => setRepertoire(true)} />
      </div>
      {data && data.kinds.length > 0 && (
        <table className="stat-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Cards</th>
              <th>Due</th>
              <th>Correct</th>
            </tr>
          </thead>
          <tbody>
            {data.kinds.map((k) => (
              <tr key={k.kind}>
                <td>{KIND_LABEL[k.kind] ?? k.kind}</td>
                <td>{k.cards}</td>
                <td>{k.due}</td>
                <td>{k.pctCorrect === null ? "–" : `${k.pctCorrect}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {repertoire && <RepertoireDialog onClose={() => setRepertoire(false)} />}
    </>
  );
}

function DrillHistory() {
  const { data, error } = useDrillOverview(100);
  return (
    <>
      <h2 className="section-title">Drill history</h2>
      {error && <p className="muted">{error}</p>}
      {data?.recent.length === 0 && <p className="muted">No drills tried yet.</p>}
      <div className="history-list">
        {data?.recent.map((a) => (
          <div key={a.id} className={`history-row ${a.correct ? "right" : "wrong"}`}>
            <span className="history-mark">{a.correct ? "✓" : "✗"}</span>
            <span className="history-main">
              <span>{a.title}</span>
              <span className="muted small">
                {KIND_LABEL[a.kind] ?? a.kind} · played {a.played}
              </span>
            </span>
            <span className="muted small">{formatDate(a.at)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

interface PuzzleStats {
  rating: number;
  attempts: number;
  recent: number;
  recentPct: number;
  themes: { theme: string; n: number; pct: number }[];
}

interface PuzzleHistoryData {
  attempts: {
    id: number;
    puzzleId: string;
    at: string;
    correct: number;
    ms: number | null;
    puzzleRating: number;
    rated: number;
    ratingAfter: number;
    themes: string;
  }[];
  stats: PuzzleStats | null;
}

function usePuzzleHistory(limit: number) {
  const [data, setData] = useState<PuzzleHistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!hasBackend()) return setError("Puzzles are saved on the computer; open the app there or from the home server.");
    invoke<PuzzleHistoryData>("puzzle_history", { limit }).then(setData, (e) => setError(String(e)));
  }, [limit]);
  return { data, error };
}

function PuzzlesMenu() {
  const pdb = usePuzzleDb();
  const blocked = useSessionsBlocked();
  const { data } = usePuzzleHistory(0);
  useEffect(() => {
    if (!pdb.loaded) refreshPuzzleDb().catch(() => undefined);
  }, [pdb.loaded]);
  const weakest = data?.stats?.themes.slice(0, 4) ?? [];
  return (
    <>
      <h2 className="section-title">Puzzles</h2>
      {pdb.installed && (
        <div className="stat-row">
          <div>
            <span className="stat-big">{fromLichess(pdb.rating)}</span>
            <span className="muted small">puzzle rating</span>
          </div>
          <div>
            <span className="stat-big">{pdb.attempts}</span>
            <span className="muted small">rated puzzles</span>
          </div>
          {data?.stats && (
            <div>
              <span className="stat-big">{data.stats.recentPct}%</span>
              <span className="muted small">solved, last {data.stats.recent}</span>
            </div>
          )}
        </div>
      )}
      <div className="menu-grid">
        <Tile
          icon="▶"
          title="Play puzzles"
          sub={pdb.installed || !pdb.loaded ? "Puzzles at your level, filter by theme or opening" : "Download the Lichess puzzle set first"}
          disabled={blocked ? BLOCKED : false}
          onClick={() => startPuzzles()}
        />
        <Tile icon="☰" title="Puzzle history" sub="Every puzzle you tried, and your rating over time" onClick={() => go("puzzle-history")} />
      </div>
      {weakest.length > 0 && (
        <>
          <h3 className="sub-title">Train your weakest themes</h3>
          <div className="theme-picks">
            {weakest.map((t) => (
              <button key={t.theme} onClick={() => startPuzzles({ theme: t.theme })} disabled={blocked}>
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
  );
}

function PuzzleHistory() {
  const { data, error } = usePuzzleHistory(200);
  const ratings = data ? data.attempts.filter((a) => a.rated).map((a) => fromLichess(a.ratingAfter)).reverse() : [];
  return (
    <>
      <h2 className="section-title">Puzzle history</h2>
      {error && <p className="muted">{error}</p>}
      {ratings.length > 1 && <RatingSpark ratings={ratings} />}
      {data?.attempts.length === 0 && <p className="muted">No puzzles tried yet.</p>}
      <div className="history-list">
        {data?.attempts.map((a) => (
          <div key={a.id} className={`history-row ${a.correct ? "right" : "wrong"}`}>
            <span className="history-mark">{a.correct ? "✓" : "✗"}</span>
            <span className="history-main">
              <span>
                Puzzle {fromLichess(a.puzzleRating)}
                {a.rated ? <span className="muted"> · rating {fromLichess(a.ratingAfter)}</span> : <span className="muted"> · retry, not rated</span>}
              </span>
              <span className="muted small">
                {a.themes
                  .split(" ")
                  .filter((t) => t && !["short", "long", "veryLong", "oneMove", "crushing", "advantage", "middlegame", "endgame", "opening", "mate"].includes(t))
                  .map(themeLabel)
                  .join(", ")}
              </span>
            </span>
            <span className="history-side">
              <span className="muted small">{formatDate(a.at)}</span>
              <button className="link" onClick={() => openUrl(`https://lichess.org/training/${a.puzzleId}`)}>
                lichess
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** The puzzle rating after each rated puzzle, oldest first. */
function RatingSpark({ ratings }: { ratings: number[] }) {
  const w = 600;
  const h = 90;
  const min = Math.min(...ratings) - 10;
  const max = Math.max(...ratings) + 10;
  const x = (i: number) => (i / (ratings.length - 1)) * w;
  const y = (r: number) => h - ((r - min) / (max - min)) * h;
  const d = ratings.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(" ");
  return (
    <div className="rating-spark">
      <div className="muted small">
        Rating over your last {ratings.length} rated puzzles: {ratings[0]} → <strong>{ratings[ratings.length - 1]}</strong>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Puzzle rating over time">
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function formatDate(sqlite: string): string {
  return new Date(sqlite.replace(" ", "T") + "Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
