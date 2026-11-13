import { useEffect, useState, type ReactNode } from "react";
import { db, hasBackend, importedFrom, opponentElo, type GameSummary } from "../db";
import { OPPONENT_RATING } from "../game/opponent";
import { deleteGame, loadGame, newGame } from "../game/session";
import { TIME_CONTROLS, timeControlLabel } from "../game/clock";
import { FREE_PLAY, opponentLabel, opponentName, useStore, type Color, type GameMode, type TimeControl } from "../store";
import { go } from "../nav";
import { invoke } from "../backend";
import { eloChange, POOL_LABEL, ratingPool, signed, START_RATING, type PlayerRating, type PoolRating, type RatingPool } from "../rating";
import { matchOpponent, savedRatedClock, saveRatedClock } from "../game/matchmaking";
import { settingRating, useSettings } from "../settings";
import { play } from "../sound";
import { askConfirm } from "./Confirm";
import { ModeBadge, SiteBadge } from "./ModeBadge";
import { OpeningSelect, RepertoireDialog } from "./RepertoireDialog";

export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${className}`} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <span className="spacer" />
          <button onClick={onClose}>✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * `mode`: the game type to start with; defaults to the last game's. `withOpponent`: from the games
 * menu a game means a computer opponent (free play is Utility's "Analysis board").
 */
export function NewGameDialog({ onClose, mode: initialMode, withOpponent }: { onClose: () => void; mode?: GameMode; withOpponent?: boolean }) {
  const last = useStore((s) => s.meta);
  const [mode, setMode] = useState<GameMode>(initialMode ?? last.mode);
  const [hasOpponent, setHasOpponent] = useState(!!withOpponent || !!initialMode || last.studentColor !== "both" || last.opponentElo !== null);
  const [rating, setRating] = useState(last.opponentElo ?? 1500);
  // A rated game is always against an opponent.
  const elo = hasOpponent || mode === "rated" ? rating : null;
  const [color, setColor] = useState<Color | "random">(last.studentColor === "black" ? "black" : "white");
  const [timeControl, setTimeControl] = useState<TimeControl | null>(last.timeControl);
  const [focus, setFocus] = useState<string[] | null>(last.openingFocus);
  const [editingRepertoire, setEditingRepertoire] = useState(false);
  const [player, setPlayer] = useState<PlayerRating | null>(null);
  useEffect(() => {
    if (hasBackend()) invoke<PlayerRating>("db_player_rating").then(setPlayer, () => setPlayer(null));
  }, []);

  const pool = ratingPool(timeControl);
  const mine = usePoolRating(pool, player);

  const start = async () => {
    const studentColor: Color | "both" =
      elo === null ? "both" : color === "random" ? (Math.random() < 0.5 ? "white" : "black") : color;
    await newGame({ mode, studentColor, opponentElo: elo, timeControl, openingFocus: focus });
    onClose();
    go("board");
  };

  return (
    <Modal title="New game" onClose={onClose}>
      <div className="field">
        <span>Game type</span>
        <div className="mode-choice">
          <button className={mode === "rated" ? "on" : ""} onClick={() => setMode("rated")}>
            <ModeBadge mode="rated" />
            <span>No engine, no coach, no takebacks. Shows how you really play, and counts toward your profile.</span>
          </button>
          <button className={mode === "practice" ? "on" : ""} onClick={() => setMode("practice")}>
            <ModeBadge mode="practice" />
            <span>Engine, coach and takebacks whenever you want. Doesn't count toward your profile.</span>
          </button>
        </div>
      </div>
      {mode === "practice" && !withOpponent && (
        <div className="field">
          <span>Opponent</span>
          <div className="segmented">
            <button className={hasOpponent ? "on" : ""} onClick={() => setHasOpponent(true)}>
              Computer
            </button>
            <button className={hasOpponent ? "" : "on"} onClick={() => setHasOpponent(false)}>
              None (free play)
            </button>
          </div>
        </div>
      )}
      {elo !== null && (
        <label className="field">
          <span>
            Strength: <strong>{rating}</strong>{" "}
            <span className="muted">
              {opponentName(rating) === "Maia" ? "· Maia, plays like a person at this rating" : "· Stockfish"}
            </span>
          </span>
          <input
            type="range"
            className="elo-slider"
            min={OPPONENT_RATING.min}
            max={OPPONENT_RATING.max}
            step={50}
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
          />
          <span className="elo-scale muted small">
            <span>{OPPONENT_RATING.min}</span>
            <span>about chess.com rapid</span>
            <span>{OPPONENT_RATING.max}</span>
          </span>
          {player && mode === "rated" && (
            <span className="muted small">
              Your {POOL_LABEL[pool].toLowerCase()} rating {mine.rating}. This game: win {signed(eloChange(mine.rating, rating, 1, mine.games))}, draw{" "}
              {signed(eloChange(mine.rating, rating, 0.5, mine.games))}, loss{" "}
              {signed(eloChange(mine.rating, rating, 0, mine.games))}.
            </span>
          )}
        </label>
      )}
      {elo !== null && (
        <div className="field">
          <span>You play</span>
          <div className="segmented">
            {(["white", "black", "random"] as const).map((c) => (
              <button key={c} className={color === c ? "on" : ""} onClick={() => setColor(c)}>
                {c[0].toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}
      {elo !== null && (
        <div className="field">
          <span>Time control</span>
          <TimePicker value={timeControl} onChange={setTimeControl} />
        </div>
      )}
      {elo !== null && (
        <div className="field">
          <span>
            Opening{" "}
            <button className="link" onClick={() => setEditingRepertoire(true)}>
              Edit repertoire…
            </button>
          </span>
          <OpeningSelect color={color === "random" ? null : color} value={focus} onChange={setFocus} />
          <span className="muted small">
            {focus
              ? "The computer follows this line as long as you do, then plays on its own."
              : "The computer picks its own moves from the start."}
          </span>
        </div>
      )}
      {editingRepertoire && <RepertoireDialog onClose={() => setEditingRepertoire(false)} />}
      <footer>
        <button className="primary" onClick={start}>
          Start game
        </button>
      </footer>
    </Modal>
  );
}

/** Bullet, blitz and rapid clocks in a grid, plus no clock at all. */
function TimePicker({ value, onChange }: { value: TimeControl | null; onChange: (tc: TimeControl | null) => void }) {
  return (
    <div className="time-controls">
      {TIME_CONTROLS.map(({ group, controls }) => (
        <div key={group} className="time-group">
          <span className="time-group-name">
            <TimeIcon group={group} />
            {group}
          </span>
          <div className="time-grid">
            {controls.map((tc) => (
              <button key={timeControlLabel(tc)} className={sameTime(tc, value) ? "on" : ""} onClick={() => onChange(tc)}>
                {timeControlLabel(tc)}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button className={`no-clock ${value ? "" : "on"}`} onClick={() => onChange(null)}>
        No clock
      </button>
    </div>
  );
}

/** How long the pretend queue looks for someone, then how long the pairing shows before the game. */
const SEARCH_MS = { min: 1200, max: 2600 };
const FOUND_MS = 1600;

/**
 * Play Rated: pick a clock, and the "lobby" pairs the student with a Maia near their rating
 * (matchmaking.ts). Colour is random, the opponent picks its own opening, like a real pairing.
 */
export function PlayRatedDialog({ onClose }: { onClose: () => void }) {
  const [timeControl, setTimeControl] = useState<TimeControl | null>(savedRatedClock);
  const [player, setPlayer] = useState<PlayerRating | null>(null);
  const [phase, setPhase] = useState<"pick" | "search" | { opponent: number; color: Color }>("pick");
  useEffect(() => {
    if (hasBackend()) invoke<PlayerRating>("db_player_rating").then(setPlayer, () => setPlayer(null));
  }, []);
  const pool = ratingPool(timeControl);
  const { rating: mine, games } = usePoolRating(pool, player);

  // Searching, then the pairing, then the board; closing the dialog calls it all off.
  useEffect(() => {
    if (phase === "pick") return;
    if (phase === "search") {
      const t = window.setTimeout(
        () => setPhase({ opponent: matchOpponent(mine), color: Math.random() < 0.5 ? "white" : "black" }),
        SEARCH_MS.min + Math.random() * (SEARCH_MS.max - SEARCH_MS.min),
      );
      return () => clearTimeout(t);
    }
    play("puzzle-correct");
    const { opponent, color } = phase;
    const t = window.setTimeout(async () => {
      await newGame({ mode: "rated", studentColor: color, opponentElo: opponent, timeControl, openingFocus: null });
      onClose();
      go("board");
    }, FOUND_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const find = () => {
    saveRatedClock(timeControl);
    setPhase("search");
  };

  return (
    <Modal title="Play rated" onClose={onClose} className="play-rated">
      {phase === "pick" && (
        <>
          <div className="field">
            <span>Time control</span>
            <TimePicker value={timeControl} onChange={setTimeControl} />
          </div>
          <p className="muted small">
            Your {POOL_LABEL[pool].toLowerCase()} rating {mine}. You'll be paired with Maia, a bot that plays like a person, near your rating: beating a stronger opponent gains more,
            losing to a weaker one costs more. No engine, no coach, no takebacks.
          </p>
          <footer>
            <button className="primary" onClick={find}>
              Find opponent
            </button>
          </footer>
        </>
      )}
      {phase === "search" && (
        <div className="matchmaking">
          <div className="matchmaking-spinner" aria-hidden />
          <strong>Looking for an opponent…</strong>
          <span className="muted small">
            {timeControl ? timeControlLabel(timeControl) : "No clock"} · {POOL_LABEL[pool].toLowerCase()} · around {mine}
          </span>
          <footer>
            <button onClick={() => setPhase("pick")}>Cancel</button>
          </footer>
        </div>
      )}
      {typeof phase === "object" && (
        <div className="matchmaking found">
          <span className="muted small">Opponent found</span>
          <div className="matchup">
            <span>
              <strong>You</strong>
              <span className="muted">{mine}</span>
            </span>
            <span className="muted">vs</span>
            <span>
              <strong>Maia</strong>
              <span className="muted">{phase.opponent}</span>
            </span>
          </div>
          <span className="muted small">
            You play {phase.color} · {timeControl ? timeControlLabel(timeControl) : "no clock"}
          </span>
          <span className="small matchup-stakes">
            Win <span className="up">{signed(eloChange(mine, phase.opponent, 1, games))}</span> · draw{" "}
            {signed(eloChange(mine, phase.opponent, 0.5, games))} · loss{" "}
            <span className="down">{signed(eloChange(mine, phase.opponent, 0, games))}</span>
          </span>
        </div>
      )}
    </Modal>
  );
}

export function GamesDialog({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.gameId);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.listGames(200).then(setGames, (e) => setError(String(e)));
  }, []);

  const open = async (id: number) => {
    await loadGame(id);
    onClose();
    go("board", "profile");
  };

  const remove = async (g: GameSummary) => {
    const sure = await askConfirm({
      title: "Delete this game?",
      body: (
        <>
          <p>
            <strong>{describeSides(g)}</strong> · {formatDate(g.updatedAt)}
          </p>
          <p className="muted">The game and its coach chat are deleted for good.</p>
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!sure) return;
    await deleteGame(g.id);
    setGames((list) => list?.filter((x) => x.id !== g.id) ?? null);
  };

  return (
    <Modal title="Games" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {games?.length === 0 && <p className="muted">No games yet.</p>}
      <div className="game-list">
        {games?.map((g) => (
          <div key={g.id} className={`game-row ${g.id === current ? "current" : ""}`}>
            <button className="game-row-open" onClick={() => open(g.id)}>
            <div className="game-row-top">
              {g.source ? <SiteBadge site={g.source} /> : <ModeBadge mode={g.mode} />}
              <strong>{describeSides(g)}</strong>
              <span className={`result ${outcome(g)}`}>{g.result ?? "in progress"}</span>
              {g.ratingBefore !== null && g.ratingAfter !== null && <RatingChange before={g.ratingBefore} after={g.ratingAfter} pool={g.ratingPool} />}
            </div>
            <div className="game-row-sub">
              {formatDate(g.updatedAt)} · {Math.ceil(g.plies / 2)} moves
              {g.source && !g.analyzed ? " · review pending" : ""}
              {g.takebacks ? ` · ${g.takebacks} takeback${g.takebacks > 1 ? "s" : ""}` : ""}
              {g.termination ? ` · ${g.termination}` : ""}
            </div>
            {g.opening && <div className="game-row-moves">{numbered(g.opening)}…</div>}
            </button>
            <button className="game-row-delete" onClick={() => remove(g)} title="Delete game" aria-label="Delete game">
              🗑
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * The student's rating for one clock: the live setting (Settings, or the game that just ended) can
 * be newer than the read, which still has the games count.
 */
export function usePoolRating(pool: RatingPool, read: PlayerRating | null): PoolRating {
  const live = useSettings((s) => settingRating(s, pool));
  // `pools?.`: a phone may still hold a rating read from before ratings were split by clock.
  const r = read?.pools?.[pool] ?? { rating: START_RATING, games: 0, set: false, history: [] };
  return live === null ? r : { ...r, rating: live };
}

/** "1212 (+12)" after a rated game. */
export function RatingChange({ before, after, pool }: { before: number; after: number; pool?: RatingPool | null }) {
  const d = after - before;
  const which = pool ? `${POOL_LABEL[pool].toLowerCase()} rating` : "rating";
  return (
    <span className={`rating-change ${d > 0 ? "up" : d < 0 ? "down" : ""}`} title={`Your ${which} went from ${before} to ${after}`}>
      {after} ({signed(d)})
    </span>
  );
}

const ICON_PATHS = {
  // A bullet in flight, a lightning bolt, a stopwatch.
  Bullet: "M3 13l5-5 3 3-5 5H3v-3zm6-6l3-3c1.5-1.5 4-1.5 4-1.5s0 2.5-1.5 4l-3 3-2.5-2.5z",
  Blitz: "M9.5 1L3 9.5h4.5L6 15l7-8.5H8.5L9.5 1z",
  Rapid: "M7 1h2v1.5A6 6 0 1 1 7 2.5V1zm1 3a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm-.75 1.5h1.5v3.2l2 1.2-.75 1.3-2.75-1.6V5.5z",
};

function TimeIcon({ group }: { group: keyof typeof ICON_PATHS }) {
  return (
    <svg className={`time-icon ${group.toLowerCase()}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path d={ICON_PATHS[group]} fill="currentColor" />
    </svg>
  );
}

const sameTime = (a: TimeControl | null, b: TimeControl | null) =>
  a?.initial === b?.initial && a?.increment === b?.increment;

function describeSides(g: GameSummary): string {
  const opp = opponentLabel({ ...FREE_PLAY, studentColor: g.studentColor, opponentElo: opponentElo(g.opponent), imported: importedFrom(g) });
  if (g.studentColor === "both") return opp;
  return g.studentColor === "white" ? `You vs ${opp}` : `${opp} vs You`;
}

function outcome(g: GameSummary): string {
  if (!g.result || g.studentColor === "both") return "";
  if (g.result === "1/2-1/2") return "draw";
  return (g.result === "1-0") === (g.studentColor === "white") ? "win" : "loss";
}

function numbered(sans: string): string {
  return sans
    .split(" ")
    .map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s))
    .join(" ");
}

/** SQLite datetime('now') is UTC without a zone marker. */
function formatDate(sqlite: string): string {
  return new Date(sqlite.replace(" ", "T") + "Z").toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
