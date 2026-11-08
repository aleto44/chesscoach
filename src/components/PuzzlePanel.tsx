import type { DrawShape } from "chessground/draw";
import { useEffect, useMemo, useState } from "react";
import { hasBackend, isRemote, openUrl } from "../backend";
import { useAuth } from "../coach/auth";
import { sendToCoach } from "../coach/bridge";
import { getRepertoire } from "../openings/repertoire";
import {
  cancelImport,
  META_THEMES,
  openingLabel,
  openingTag,
  refreshPuzzleDb,
  startImport,
  themeLabel,
  usePuzzleDb,
} from "../puzzles/puzzles";
import {
  nextPuzzle,
  puzzleMove,
  puzzleQuestion,
  setChoice,
  setSummary,
  showSolution,
  startPuzzles,
  stopPuzzles,
  usePuzzle,
  viewStep,
  type Difficulty,
} from "../puzzles/session";
import { useStore } from "../store";
import { moveLabel, START_FEN } from "../chess/line";
import { Board } from "./Board";
import { BoardSteps, StepButtons } from "./StepButtons";
import { viewedPly } from "../chess/view";
import { fromLichess } from "../rating";

const MB = (bytes: number) => Math.round(bytes / 1e6);

/** Replaces the game board while the puzzle trainer is open. */
export function PuzzlePanel() {
  const s = usePuzzle()!;
  const pdb = usePuzzleDb();
  const busy = useStore((st) => st.busy);
  const signedIn = useAuth((a) => a.status === "signed-in") || !hasBackend();
  const puzzle = s.queue[s.index];
  const line = s.line;
  const over = s.status === "solved" || s.status === "failed";
  const ply = line ? viewedPly(line.sans.length, s.view) : 0;
  const past = line !== null && ply < line.sans.length;
  const shapes = useMemo(() => s.shapes as DrawShape[], [s.shapes]);
  const opponent = s.color === "white" ? "Black" : "White";
  // The opponent's move that sets the puzzle up ("23...Nxe4"), once it's played.
  const leadIn = line && line.sans.length > 0 ? moveLabel(line.fens[0], line.sans[0]) : null;

  useEffect(() => {
    if (!pdb.loaded) refreshPuzzleDb();
  }, [pdb.loaded]);
  // The first time the set appears (just downloaded), load puzzles.
  useEffect(() => {
    if (pdb.installed && s.status === "error") startPuzzles();
  }, [pdb.installed]);

  if (pdb.loaded && !pdb.installed) return <InstallPanel />;

  const change = s.change ? fromLichess(s.change.after) - fromLichess(s.change.before) : null;
  return (
    <main className="board-panel play puzzles">
      <nav className="crumbs">
        <span className="crumb current">{s.set.title}</span>
        {puzzle && (
          <span className="muted">
            {" "}
            · {s.index + 1}
            {s.set.fromCoach ? ` of ${s.queue.length}` : ""}
          </span>
        )}
        <button className="return" onClick={stopPuzzles}>
          ‹ Puzzles menu
        </button>
      </nav>

      <div className="board-frame puzzle">
        <Board
          fen={line ? line.fens[ply] : START_FEN}
          lastMove={line && ply > 0 ? line.lastMoves[ply - 1] : undefined}
          orientation={s.color}
          onMove={puzzleMove}
          canMove={s.status === "solving" && s.view === null}
          // Not while a wrong move is on the board: that position is about to be taken back.
          premoveColor={(s.status === "intro" || s.status === "solving") && s.view === null && !s.message ? s.color : undefined}
          shapes={past ? undefined : shapes}
        />
        {line && <BoardSteps onStep={viewStep} disabled={line.sans.length === 0} />}
      </div>

      <aside className="game-side">
        <div className="game-head">
          <strong>Puzzles</strong>
          <span className="spacer" />
          <span className="puzzle-rating" title={`${pdb.attempts} rated puzzles`}>
            Rating {fromLichess(pdb.rating)}
            {change !== null && <span className={change >= 0 ? "up" : "down"}>{change >= 0 ? ` +${change}` : ` ${change}`}</span>}
          </span>
        </div>

        {!s.set.fromCoach && <Filters />}

        <div className="side-body puzzle-body">
          <div className={`puzzle-status ${s.status}`}>
            {s.status === "loading" && "Finding puzzles…"}
            {s.status === "intro" && `Watch ${opponent}'s move…`}
            {s.status === "solving" && (
              <>
                {leadIn && (
                  <div className="muted">
                    {opponent} played {leadIn}.
                  </div>
                )}
                {past ? (
                  <>
                    <strong>Looking back.</strong> Step forward (▶ or ⏭) to play on.
                  </>
                ) : (
                  <>
                    <strong>Your turn.</strong> Find the best move for {s.color === "white" ? "White" : "Black"}.
                    {s.message && <div className="puzzle-msg">{s.message}</div>}
                  </>
                )}
              </>
            )}
            {s.status === "solved" && (
              <>
                <strong>✓ Solved.</strong>
              </>
            )}
            {s.status === "failed" && (
              <>
                <strong>✗ Missed.</strong> {s.message} <span className="muted">Saved as a drill.</span>
              </>
            )}
            {s.status === "empty" &&
              (s.set.fromCoach ? (
                <>
                  <strong>Set done.</strong> Solved {s.results.filter((r) => r.correct).length} of {s.results.length}.
                </>
              ) : (
                "No puzzles match these filters. Try another theme or difficulty."
              ))}
            {s.status === "error" && "Couldn't load puzzles."}
          </div>

          {puzzle && over && (
            <div className="puzzle-info">
              <div>
                Puzzle rating <strong>{fromLichess(puzzle.rating)}</strong> · played {puzzle.plays.toLocaleString()} times
              </div>
              <div className="puzzle-tags">
                {puzzle.themes
                  .filter((t) => !META_THEMES.has(t))
                  .map((t) => (
                    <span key={t} className="chip">
                      {themeLabel(t)}
                    </span>
                  ))}
              </div>
              {puzzle.openings[0] && <div className="muted">{openingLabel(puzzle.openings[puzzle.openings.length - 1])}</div>}
              <button className="link" onClick={() => openUrl(`https://lichess.org/training/${puzzle.id}`)}>
                Open on lichess.org
              </button>
            </div>
          )}
          <div className="puzzle-credit muted">Puzzles from the Lichess open database (CC0).</div>
        </div>

        {line && <StepButtons onStep={viewStep} disabled={line.sans.length === 0} />}

        <div className="side-actions">
          {(s.status === "solving" || s.status === "intro") && <button onClick={showSolution}>View solution</button>}
          {over && (
            <>
              {signedIn && (
                <button onClick={() => sendToCoach(puzzleQuestion())} disabled={busy} title="One message to the coach">
                  Ask the coach
                </button>
              )}
              <button className="primary" onClick={nextPuzzle}>
                Next
              </button>
            </>
          )}
          {s.status === "empty" && s.set.fromCoach && (
            <>
              {signedIn && s.results.length > 0 && (
                <button onClick={() => sendToCoach(setSummary())} disabled={busy}>
                  Tell the coach
                </button>
              )}
              <button className="primary" onClick={() => startPuzzles()}>
                More puzzles
              </button>
            </>
          )}
        </div>
      </aside>
    </main>
  );
}

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "easier", label: "Easier" },
  { value: "normal", label: "Normal" },
  { value: "harder", label: "Harder" },
];

function Filters() {
  const choice = usePuzzle((s) => s!.choice);
  const tags = usePuzzleDb((s) => s.tags);
  const [repertoire, setRepertoire] = useState<string[]>([]);
  useEffect(() => {
    getRepertoire()
      .then((lines) => setRepertoire([...new Set(lines.map((l) => openingTag(l.name, tags)).filter((t): t is string => !!t))]))
      .catch(() => undefined);
  }, [tags]);
  const themes = tags.filter((t) => t.kind === "theme" && !META_THEMES.has(t.tag)).sort((a, b) => themeLabel(a.tag).localeCompare(themeLabel(b.tag)));
  const families = tags.filter((t) => t.kind === "family").slice(0, 60).sort((a, b) => a.tag.localeCompare(b.tag));
  const extra = choice.opening && !families.some((f) => f.tag === choice.opening) && !repertoire.includes(choice.opening) ? [choice.opening] : [];

  return (
    <div className="puzzle-filters">
      <select value={choice.theme ?? ""} onChange={(e) => setChoice({ theme: e.target.value || null })} aria-label="Theme">
        <option value="">Any theme</option>
        {themes.map((t) => (
          <option key={t.tag} value={t.tag}>
            {themeLabel(t.tag)}
          </option>
        ))}
      </select>
      <select value={choice.opening ?? ""} onChange={(e) => setChoice({ opening: e.target.value || null })} aria-label="Opening">
        <option value="">Any position</option>
        {repertoire.length > 0 && (
          <optgroup label="Your repertoire">
            {repertoire.map((t) => (
              <option key={t} value={t}>
                {openingLabel(t)}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Openings">
          {[...extra, ...families.map((f) => f.tag).filter((t) => !repertoire.includes(t))].map((t) => (
            <option key={t} value={t}>
              {openingLabel(t)}
            </option>
          ))}
        </optgroup>
      </select>
      <div className="segmented">
        {DIFFICULTIES.map((d) => (
          <button key={d.value} className={choice.difficulty === d.value ? "on" : ""} onClick={() => setChoice({ difficulty: d.value })}>
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function InstallPanel() {
  const p = usePuzzleDb((s) => s.importing);
  const running = p && (p.phase === "download" || p.phase === "index");
  const pct = p && p.total ? Math.min(100, Math.round((100 * p.done) / p.total)) : 0;
  return (
    <main className="board-panel">
      <div className="crumbs">
        <span className="crumb current">Puzzles</span>
        <button className="return" onClick={stopPuzzles}>
          ‹ Puzzles menu
        </button>
      </div>
      <div className="puzzle-install">
        <h2>Lichess puzzles</h2>
        <p>
          About 1.4 million tactics puzzles from real games, rated by Lichess players and tagged by theme (forks, pins, mates
          in 2, rook endgames…). They come from the Lichess open database, which is free to use (CC0).
        </p>
        <p className="muted">
          A one-time download of about {MB(310e6)} MB. The app keeps the best-rated puzzles in a file of about 400 MB on
          {isRemote ? " your computer (not this phone), so it's shared with the desktop app" : " this computer"}.
        </p>
        {running ? (
          <>
            <div className="review-progress">
              <span style={{ width: `${p.phase === "index" ? 100 : pct}%` }} />
            </div>
            <p className="muted">
              {p.phase === "index"
                ? `Building the index for ${p.kept.toLocaleString()} puzzles…`
                : p.total
                  ? `${MB(p.done)} of ${MB(p.total)} MB · ${p.kept.toLocaleString()} puzzles kept`
                  : "Starting the download…"}
            </p>
            <div className="controls">
              <button onClick={cancelImport}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            {p?.phase === "error" && <p className="error">Download failed: {p.error}</p>}
            {p?.phase === "cancelled" && <p className="muted">Download cancelled.</p>}
            <div className="controls">
              <button className="primary" onClick={startImport} disabled={!hasBackend()}>
                Download puzzles
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
