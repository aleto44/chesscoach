import { useEffect, useState, type ReactNode } from "react";
import { parkedFor, startDrills, useParkedDrills } from "../analysis/drillSession";
import { useDrillCounts } from "../analysis/drills";
import { hasBackend, invoke, openUrl } from "../backend";
import { cachedRead, keepRead } from "../snapshot";
import { newGame } from "../game/session";
import { timeControlLabel } from "../game/clock";
import { go, useNav } from "../nav";
import { refreshPuzzleDb, themeLabel, usePuzzleDb, type ThemeMastery } from "../puzzles/puzzles";
import { rushBest as bestRush, startPuzzles, startRatedPuzzles, startRush, useParkedPuzzles } from "../puzzles/session";
import { commonness, familyOf, findSet, modesOf, pickLine, seenCounts, shortName, TRAINING_SETS, type Commonness, type TrainingLine } from "../openings/training";
import { startOpening, useOpening } from "../openings/session";
import { getRepertoire, repertoireSetId, useRepertoire } from "../openings/repertoire";
import { fromLichess, POOL_LABEL, RATING_POOLS, signed, type PlayerRating } from "../rating";
import { isLocked, opponentLabel, useStore } from "../store";
import { NewGameDialog, PlayRatedDialog, usePoolRating } from "./GameDialogs";
import { ModeBadge } from "./ModeBadge";
import { RepertoireDialog } from "./RepertoireDialog";
import { ProfileMenu, RatingHistory, Weaknesses } from "./Profile";
import { EndgameMenu } from "./Endgames";
import { GuessMenu } from "./Guess";
import { MasteryRule, StarBadge, XpBar } from "./Mastery";
import { TimerScreen } from "./Timer";
import { clockLabel, started as clockStarted, useTimer } from "../utility/timer";

/** Drills and puzzles would leave a rated game's clock (or position) sitting mid-game. */
export function useSessionsBlocked() {
  const meta = useStore((s) => s.meta);
  const started = useStore((s) => s.game.sans.length > 0);
  return !meta.result && (isLocked(meta) || (meta.timeControl !== null && started));
}

export const BLOCKED = "Finish your current game first";

/** The left column when no board is showing: the home menu and each section's menu. */
export function Home() {
  const view = useNav((n) => n.view);
  // The clock is a screen of its own: on a phone it covers everything, top bar included.
  if (view === "timer") return <TimerScreen />;
  return (
    <main className="home-panel">
      <div className="home-inner">
        {view === "home" && <MainMenu />}
        {view === "games" && <GamesMenu />}
        {view === "school" && <SchoolMenu />}
        {view === "drills" && <DrillsMenu />}
        {view === "drill-history" && <DrillHistory />}
        {view === "openings" && <OpeningTraining />}
        {view === "puzzles" && <PuzzlesMenu />}
        {view === "puzzle-history" && <PuzzleHistory />}
        {view === "profile" && <ProfileMenu />}
        {view === "weaknesses" && <Weaknesses />}
        {view === "ratings" && <RatingHistory />}
        {view === "endgames" && <EndgameMenu />}
        {view === "guess" && <GuessMenu />}
        {view === "utility" && <UtilityMenu />}
      </div>
    </main>
  );
}

export function Tile({
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
  /** Only for status worth showing (counts, a reason it's off); the title says what it does. */
  sub?: ReactNode;
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
        {(typeof disabled === "string" || sub) && (
          <span className="menu-sub">{typeof disabled === "string" ? disabled : sub}</span>
        )}
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
        <Tile big icon="♟" title="Games" sub="Play the computer, rated or practice" onClick={() => go("games")} />
        <Tile
          big
          icon="✎"
          title="School"
          sub={drills.due ? `${drills.due} drills due · opening training` : "Drills and opening training"}
          badge={drills.due ? <span className="count">{drills.due}</span> : null}
          onClick={() => go("school")}
        />
        <Tile
          big
          icon="✦"
          title="Puzzles"
          sub={pdb.installed ? `Rating ${fromLichess(pdb.rating)}` : "Tactics from real games"}
          onClick={() => go("puzzles")}
        />
        <Tile big icon="◔" title="Profile" sub="Your games, weaknesses and ratings" onClick={() => go("profile")} />
        <Tile big icon="⚒" title="Utility" sub="Analysis board and chess clock" onClick={() => go("utility")} />
      </div>
    </>
  );
}

/** Tools for chess away from the coach: a free board to analyse on, and a clock for over-the-board games. */
function UtilityMenu() {
  const clock = useTimer();
  const [a, b] = clock.setup.sides;
  const same = a.base === b.base && a.inc === b.inc;
  return (
    <>
      <h2 className="section-title">Utility</h2>
      <div className="menu-grid">
        <Tile
          icon="⊞"
          title="Analysis board"
          onClick={async () => {
            await newGame({
              mode: "practice",
              studentColor: "both",
              opponentElo: null,
            });
            go("board", "utility");
          }}
        />
        <Tile
          icon="⏱"
          title="Chess clock"
          sub={
            clockStarted(clock) && clock.flagged === null
              ? "Game in progress"
              : same
                ? clockLabel(a)
                : `${clockLabel(b)} against ${clockLabel(a)}`
          }
          onClick={() => go("timer")}
        />
      </div>
    </>
  );
}

function GamesMenu() {
  const [dialog, setDialog] = useState<"rated" | "play" | null>(null);
  const { data: rating } = useRead<PlayerRating>("db_player_rating", {}, "Your rating is kept on the computer.");
  const hasGame = useStore((s) => s.gameId !== null || s.game.sans.length > 0);
  const close = () => setDialog(null);
  return (
    <>
      <h2 className="section-title">Games</h2>
      <ResumeGame />
      {rating && <GameRating r={rating} />}
      <div className="menu-grid">
        <Tile icon="▶" title="Play rated" onClick={() => setDialog("rated")} />
        <Tile icon="⚙" title="Choose game" onClick={() => setDialog("play")} />
        {hasGame && <Tile icon="◻" title="Current board" onClick={() => go("board")} />}
      </div>
      {dialog === "rated" && <PlayRatedDialog onClose={close} />}
      {dialog === "play" && <NewGameDialog withOpponent onClose={close} />}
    </>
  );
}

interface DrillOverview {
  kinds: {
    kind: "mistake" | "opening" | "coach" | "puzzle";
    cards: number;
    due: number;
    pctCorrect: number | null;
  }[];
  recent: {
    id: number;
    at: string;
    correct: number;
    played: string;
    kind: string;
    title: string;
  }[];
}

const KIND_LABEL: Record<string, string> = {
  mistake: "From your games",
  opening: "Repertoire",
  coach: "From the coach",
  puzzle: "Missed puzzles",
};

function useDrillOverview(limit: number) {
  return useRead<DrillOverview>("db_drill_overview", { limit }, "Drills are saved on the computer; open the app there or from the home server.");
}

/**
 * A read-only query for a screen. On a phone the last answer shows at once (snapshot.ts) while
 * the computer is asked again; an error only shows when there's nothing to show instead.
 */
export function useRead<T>(cmd: string, args: Record<string, unknown>, offline: string) {
  const key = `${cmd}:${JSON.stringify(args)}`;
  const [data, setData] = useState<T | null>(() => cachedRead<T>(key));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!hasBackend()) return setError(offline);
    let live = true;
    invoke<T>(cmd, args).then(
      (d) => {
        keepRead(key, d);
        if (live) (setData(d), setError(null));
      },
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return { data, error: data ? null : error };
}

function SchoolMenu() {
  const drills = useDrillCounts();
  const seen = seenCounts();
  const lines = TRAINING_SETS.flatMap((s) => s.lines);
  const faced = lines.filter((l) => seen[l.moves.join(" ")]).length;
  return (
    <>
      <h2 className="section-title">School</h2>
      <div className="menu-grid">
        <Tile
          icon="↻"
          title="Drills"
          sub={drills.total ? `${drills.due} due of ${drills.total}` : "Practice positions from your games"}
          badge={drills.due ? <span className="count">{drills.due}</span> : null}
          onClick={() => go("drills")}
        />
        <Tile
          icon="♜"
          title="Opening training"
          sub={faced ? `Faced ${faced} of ${lines.length} lines · your repertoire` : "Your repertoire, and every reply to your opening"}
          onClick={() => go("openings")}
        />
        <Tile icon="♚" title="Endgame trainer" sub="Win the standard endings against Stockfish" onClick={() => go("endgames")} />
        <Tile icon="?" title="Guess the move" sub="Play through master games, move by move" onClick={() => go("guess")} />
      </div>
    </>
  );
}

const COMMONNESS_LABEL: Record<Commonness, string> = {
  common: "Common",
  occasional: "Occasional",
  rare: "Rare",
};

/** The opening picked last time, so coming back to the menu starts where the student was. */
const OPENING_KEY = "cc-opening-set";
function savedSetId(): string {
  try {
    const id = localStorage.getItem(OPENING_KEY);
    if (id && findSet(id)) return id;
  } catch {
    // Private mode: start at the first set.
  }
  return TRAINING_SETS[0].id;
}

/**
 * Practice against the replies to one opening: pick a side, then the opening, then a line on
 * purpose or a weighted-random one, so the common ones come up most and the rare ones still show.
 */
function OpeningTraining() {
  const [setId, setSetIdState] = useState(savedSetId);
  const setSetId = (id: string) => {
    setSetIdState(id);
    try {
      localStorage.setItem(OPENING_KEY, id);
    } catch {
      // Private mode: not kept.
    }
  };
  // Re-read the counts when a session ends and the list shows again.
  const training = useOpening((o) => o !== null);
  const [seen, setSeen] = useState(seenCounts);
  useEffect(() => setSeen(seenCounts()), [training]);
  const [repertoire, setRepertoire] = useState(false);
  // The student's own lines are a set too; re-read them so the list follows edits in the dialog.
  useRepertoire();
  useEffect(() => {
    getRepertoire().catch(() => undefined);
  }, []);
  const set = findSet(setId) ?? TRAINING_SETS[0];
  const mine = set.id === repertoireSetId(set.color);
  // Ways to train one opening (from the start, punishing White...) sit under it, not beside it.
  const family = familyOf(set);
  const modes = mine ? [] : modesOf(family);
  const faced = set.lines.filter((l) => seen[l.moves.join(" ")]).length;

  // A session of its own, not a game: it doesn't touch the game in progress or the saved games.
  const play = (line: TrainingLine) => startOpening(set.id, line);

  return (
    <>
      <h2 className="section-title">Opening training</h2>
      <div className="opening-pick">
        <div className="segmented">
          {(["white", "black"] as const).map((c) => (
            <button
              key={c}
              className={set.color === c ? "on" : ""}
              onClick={() => set.color !== c && setSetId(TRAINING_SETS.find((s) => s.color === c && !s.parent)!.id)}
            >
              {c === "white" ? "Openings as White" : "Defences as Black"}
            </button>
          ))}
        </div>
        <div className="segmented">
          <button className={mine ? "on" : ""} onClick={() => setSetId(repertoireSetId(set.color))}>
            ★ Your repertoire
          </button>
          {TRAINING_SETS.filter((s) => s.color === set.color && !s.parent).map((s) => (
            <button key={s.id} className={!mine && s.id === family.id ? "on" : ""} onClick={() => s.id !== family.id && setSetId(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
        {modes.length > 1 && (
          <div className="segmented opening-modes">
            <span className="muted small">{family.name}:</span>
            {modes.map((s) => (
              <button key={s.id} className={s.id === set.id ? "on" : ""} onClick={() => setSetId(s.id)}>
                {s.mode ?? s.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="section-lede muted">
        {mine ? (
          <>
            {set.blurb} Each line is also a drill under Drills, and new games can steer into it. Practice only: these don't go into your games.
          </>
        ) : (
          <>
            <strong>{set.name}</strong> as {set.color}. {set.blurb} Each time the computer picks a reply, the common ones most often, and plays it
            from the book until the line ends. Practice only: these don't go into your games.
          </>
        )}
      </p>
      <div className="menu-grid">
        {mine && (
          <Tile icon="♜" title="Edit repertoire" sub={`Add or remove your ${set.color} lines`} onClick={() => setRepertoire(true)} />
        )}
        <Tile
          icon="⚄"
          title="Surprise me"
          sub={mine ? "A random line from your repertoire" : `A random ${set.name} line, weighted by how often it's played`}
          disabled={!set.lines.length}
          onClick={() => play(pickLine(set))}
        />
      </div>
      <h3 className="sub-title">
        Lines{" "}
        <span className="muted small">
          · faced {faced} of {set.lines.length}
        </span>
      </h3>
      {mine && !set.lines.length && <p className="muted">No {set.color} lines yet. Add the openings you play with Edit repertoire.</p>}
      <div className="history-list">
        {/* Most played first; the repertoire keeps the student's own order. Ties keep the file's order. */}
        {(mine ? set.lines : [...set.lines].sort((a, b) => b.weight - a.weight)).map((l) => {
          const n = seen[l.moves.join(" ")] ?? 0;
          const c = commonness(l);
          return (
            <div key={l.moves.join(" ")} className="history-row">
              {!mine && <span className={`line-tag ${c}`}>{COMMONNESS_LABEL[c]}</span>}
              <span className="history-main">
                <span>{shortName(set, l)}</span>
                <span className="muted small">
                  {l.start ? `Starts at move ${Math.floor(l.start / 2) + 1} · ` : ""}
                  {numberedMoves(l.moves)}
                </span>
              </span>
              <span className="history-side">
                <button onClick={() => play(l)}>Play</button>
                <span className="muted small">{n ? `faced ${n}×` : "new"}</span>
              </span>
            </div>
          );
        })}
      </div>
      {repertoire && <RepertoireDialog initialColor={set.color} onClose={() => setRepertoire(false)} />}
    </>
  );
}

const numberedMoves = (moves: string[]) => moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");

function DrillsMenu() {
  const counts = useDrillCounts();
  const blocked = useSessionsBlocked();
  const [repertoire, setRepertoire] = useState(false);
  const { data } = useDrillOverview(0);
  const parked = useParkedDrills();
  const due = parkedFor(parked);
  const all = parkedFor(parked, true);
  const inProgress = (d: { index: number; queue: unknown[] }) => `Continue: drill ${Math.min(d.index + 1, d.queue.length)} of ${d.queue.length}`;
  return (
    <>
      <h2 className="section-title">Drills</h2>
      <p className="section-lede muted">
        Positions you got wrong come back on a schedule until they stick: mistakes from your analyzed games, missed puzzles, your repertoire, and
        positions the coach set.
      </p>
      <div className="menu-grid">
        <Tile
          icon="▶"
          title="Due drills"
          sub={due ? inProgress(due) : counts.due ? `${counts.due} waiting for review` : "Nothing due right now"}
          badge={counts.due ? <span className="count">{counts.due}</span> : null}
          disabled={blocked ? BLOCKED : !counts.due && !due}
          onClick={() => startDrills()}
        />
        <Tile
          icon="↻"
          title="Practice all"
          sub={all ? inProgress(all) : `Every drill, due or not (${counts.total})`}
          disabled={blocked ? BLOCKED : !counts.total && !all}
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
  /** Per theme, most tried first (puzzles.rs `mastery`); older servers leave it out. */
  mastery?: ThemeMastery[];
}

function usePuzzleHistory(limit: number) {
  return useRead<PuzzleHistoryData>("puzzle_history", { limit }, "Puzzles are saved on the computer; open the app there or from the home server.");
}

function PuzzlesMenu() {
  const pdb = usePuzzleDb();
  const blocked = useSessionsBlocked();
  const { data } = usePuzzleHistory(0);
  useEffect(() => {
    if (!pdb.loaded) refreshPuzzleDb().catch(() => undefined);
  }, [pdb.loaded]);
  const weakest = data?.stats?.themes.slice(0, 4) ?? [];
  const needSet = pdb.installed || !pdb.loaded ? null : "Download the Lichess puzzle set first";
  const rushBest = bestRush();
  const parked = useParkedPuzzles();
  const rush = parked.rush?.rush;
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
          sub={parked.rated ? "Continue your puzzle" : needSet}
          disabled={blocked ? BLOCKED : false}
          onClick={() => startRatedPuzzles()}
        />
        <Tile
          icon="⚙"
          title="Choose puzzles"
          sub={parked.custom ? "Continue your puzzle" : needSet}
          disabled={blocked ? BLOCKED : false}
          onClick={() => startPuzzles()}
        />
        <Tile
          icon="⚡"
          title="Puzzle rush"
          sub={
            rush
              ? `Continue: ${rush.score} solved, ${rush.lives} ${rush.lives === 1 ? "life" : "lives"} left`
              : (needSet ?? (rushBest ? `Best ${rushBest}` : undefined))
          }
          disabled={blocked ? BLOCKED : false}
          onClick={() => startRush()}
        />
        <Tile icon="☰" title="Puzzle history" onClick={() => go("puzzle-history")} />
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
      {data?.mastery && data.mastery.length > 0 && <MasteryList themes={data.mastery} blocked={blocked} />}
    </>
  );
}

const MASTERY_SHOWN = 10;

/** Every theme tried, with a bar that fills as it's solved; a click trains that theme. */
function MasteryList({ themes, blocked }: { themes: ThemeMastery[]; blocked: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? themes : themes.slice(0, MASTERY_SHOWN);
  const stars = themes.reduce((n, t) => n + t.stars, 0);
  return (
    <>
      <h3 className="sub-title">
        Theme mastery
        {stars > 0 && <span className="muted small"> · {stars} ★ earned</span>}
      </h3>
      <MasteryRule />
      <div className="mastery-list">
        {shown.map((t) => (
          <button key={t.theme} className="mastery-row" onClick={() => startPuzzles({ theme: t.theme })} disabled={blocked} title={`Train ${themeLabel(t.theme)}`}>
            <span className="mastery-name">{themeLabel(t.theme)}</span>
            <StarBadge stars={t.stars} />
            <XpBar level={t} />
            <span className="muted small mastery-total">{t.solved} solved</span>
          </button>
        ))}
      </div>
      {themes.length > MASTERY_SHOWN && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${themes.length} themes`}
        </button>
      )}
    </>
  );
}

function PuzzleHistory() {
  const { data, error } = usePuzzleHistory(200);
  const ratings = data
    ? data.attempts
        .filter((a) => a.rated)
        .map((a) => fromLichess(a.ratingAfter))
        .reverse()
    : [];
  return (
    <>
      <h2 className="section-title">Puzzle history</h2>
      {error && <p className="muted">{error}</p>}
      {ratings.length > 1 && <RatingSpark ratings={ratings} label={`Rating over your last ${ratings.length} rated puzzles`} />}
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
                  .filter(
                    (t) =>
                      t && !["short", "long", "veryLong", "oneMove", "crushing", "advantage", "middlegame", "endgame", "opening", "mate"].includes(t),
                  )
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

/**
 * The games menu's headline: the bullet, blitz and rapid ratings, the last rated game's change, and
 * the trend of the rating that game was in.
 */
function GameRating({ r: read }: { r: PlayerRating }) {
  const pools = {
    bullet: usePoolRating("bullet", read),
    blitz: usePoolRating("blitz", read),
    rapid: usePoolRating("rapid", read),
  };
  const recent = read.latest ?? "rapid";
  const r = pools[recent];
  const last = r.history[r.history.length - 1];
  const ratings = r.history.length ? [r.history[0][0], ...r.history.map((h) => h[1])] : [];
  return (
    <>
      <div className="stat-row">
        {RATING_POOLS.map((p) => (
          <div key={p} title={`${pools[p].games} rated ${p} game${pools[p].games === 1 ? "" : "s"} counted`}>
            <span className="stat-big">{pools[p].rating}</span>
            <span className="muted small">
              {p} · {pools[p].games} game{pools[p].games === 1 ? "" : "s"}
            </span>
          </div>
        ))}
        {last && (
          <div>
            <span className={`stat-big ${last[1] >= last[0] ? "up" : "down"}`}>{signed(last[1] - last[0])}</span>
            <span className="muted small">last game ({recent})</span>
          </div>
        )}
      </div>
      {ratings.length > 2 && (
        <RatingSpark ratings={ratings} label={`${POOL_LABEL[recent]} rating over your last ${r.history.length} rated ${recent} games`} />
      )}
    </>
  );
}

/** A rating over time, oldest first. */
export function RatingSpark({ ratings, label }: { ratings: number[]; label: string }) {
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
        {label}: {ratings[0]} → <strong>{ratings[ratings.length - 1]}</strong>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Rating over time">
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function formatDate(sqlite: string): string {
  return new Date(sqlite.replace(" ", "T") + "Z").toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
