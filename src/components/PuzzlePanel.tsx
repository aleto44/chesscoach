import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hasBackend, isRemote } from "../backend";
import { useAuth } from "../coach/auth";
import { sendToCoach } from "../coach/bridge";
import {
  cancelImport,
  META_THEMES,
  openingLabel,
  refreshPuzzleDb,
  startImport,
  themeLabel,
  usePuzzleDb,
} from "../puzzles/puzzles";
import { usePuzzleFx } from "../puzzles/fx";
import { play } from "../sound";
import { saveSetting, useSettings } from "../settings";
import {
  AUTO_NEXT_MS,
  backToCurrent,
  endRush,
  reviewMove,
  reviewResult,
  shownPuzzle,
  holdPuzzle,
  nextPuzzle,
  puzzleMove,
  setChoice,
  setSummary,
  puzzleHint,
  showSolution,
  undoMiss,
  RUSH_LIVES,
  startPuzzles,
  startRatedPuzzles,
  startRush,
  stopPuzzles,
  usePuzzle,
  viewStep,
  type Difficulty,
  type PuzzleSession,
  BANDS,
} from "../puzzles/session";
import { useStore } from "../store";
import { moveLabel, START_FEN } from "../chess/line";
import { Board } from "./Board";
import { MasteryGains } from "./Mastery";
import { BoardSteps, StepButtons } from "./StepButtons";
import { askConfirm } from "./Confirm";
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
  /** Holding ◀ for three seconds, after a wrong move: voids it as a misclick (no button for it, on purpose). */
  const recall =
    s.voidable && s.status === "solving" && !s.rush
      ? async () => {
          const ok = await askConfirm({
            title: "Fat-finger recall",
            body: "Void your wrong move? For a misclick only: the puzzle goes back to a clean, rated try, with no rating loss and no drill.",
            confirmLabel: "Void it",
          });
          if (ok) undoMiss();
        }
      : undefined;

  useEffect(() => {
    if (!pdb.loaded) refreshPuzzleDb();
  }, [pdb.loaded]);
  // The first time the set appears (just downloaded), load puzzles.
  useEffect(() => {
    if (pdb.installed && s.status === "error") (s.rush ? startRush : s.set.mode === "rated" ? startRatedPuzzles : startPuzzles)();
  }, [pdb.installed]);

  if (pdb.loaded && !pdb.installed) return <InstallPanel />;

  const change = s.change ? fromLichess(s.change.after) - fromLichess(s.change.before) : null;
  // Filters only for the student's own pick: rated puzzles and the rush choose for themselves.
  const filters = !s.set.fromCoach && (s.set.mode ?? "custom") === "custom";
  const rushOver = !!s.rush && s.rush.lives <= 0 && over;
  const fen = line ? line.fens[ply] : START_FEN;
  // A finished puzzle of the run opened from the history, shown instead of the current one.
  const rv = s.review;
  const shown = shownPuzzle(s);
  const rvColor = shown.result?.color ?? s.color;
  const rvFen = rv ? rv.x.line.fens[rv.x.ply] : fen;
  const info = rv ? shown.puzzle : puzzle;
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

      <CueFrame
        status={rv ? (shown.result?.correct ? "solved" : "failed") : s.status}
        orientation={rv ? rvColor : s.color}
        fen={rvFen}
        rating={!rv && s.change ? { before: fromLichess(s.change.before), after: fromLichess(s.change.after) } : null}
        // Always there (disabled until a puzzle is up), so nothing shifts when it loads.
        after={<BoardSteps onStep={viewStep} disabled={!rv && (!line || line.sans.length === 0)} onHoldBack={rv ? undefined : recall} />}
      >
        {rv ? (
          <Board
            key="review"
            fen={rvFen}
            lastMove={rv.x.ply > 0 ? rv.x.line.lastMoves[rv.x.ply - 1] : undefined}
            orientation={rvColor}
            onMove={reviewMove}
          />
        ) : (
          <Board
          fen={fen}
          lastMove={line && ply > 0 ? line.lastMoves[ply - 1] : undefined}
          orientation={s.color}
          onMove={puzzleMove}
          canMove={s.status === "solving" && s.view === null}
          // Not while a wrong move is on the board: that position is about to be taken back.
          premoveColor={(s.status === "intro" || s.status === "solving") && s.view === null && !s.message ? s.color : undefined}
          shapes={past ? undefined : shapes}
        />
        )}
      </CueFrame>

      <aside className="game-side">
        <div className="game-head">
          <strong>{s.rush ? "Puzzle rush" : "Puzzles"}</strong>
          {/* Phones drop the crumbs row: where you are in the set, and the filters, go here. */}
          {puzzle && (
            <span className="muted head-count">
              {s.index + 1}
              {s.set.fromCoach ? ` of ${s.queue.length}` : ""}
            </span>
          )}
          {filters && <ChoiceSummary className="head-choice" />}
          <span className="spacer" />
          {s.rush ? (
            <RushStatus lives={s.rush.lives} score={s.rush.score} />
          ) : (
            <RatingTicker rating={fromLichess(pdb.rating)} change={change} attempts={pdb.attempts} puzzleId={puzzle?.id ?? ""} />
          )}
          {!s.rush && <PuzzleSettings filters={filters} />}
        </div>

        {filters && <ChoiceSummary />}

        <div className="side-body puzzle-body">
          {/* First, so opening an old one (more text below) never moves the tiles. */}
          {s.rush && <RushHistory s={s} />}
          {rv && shown.result && (
            <div className={`puzzle-status ${shown.result.correct ? "solved" : "failed"}`}>
              <div className="muted">Puzzle {(shown.result.at ?? 0) + 1} of this run</div>
              {shown.result.correct ? <strong className="solved-line">✓ Solved</strong> : <strong>✗ Missed</strong>}
              <div className="muted small">
                Step through it, try other moves on the board, or open the analysis board.
                {rv.x.forkAt !== null && " Step back to where you left the line to bring it back."}
              </div>
            </div>
          )}
          {!rv && (
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
            {rushOver && (
              <div className="rush-over">
                <strong>{s.rush!.ended ? "Run ended." : "Rush over."}</strong> You solved {s.rush!.score} {s.rush!.score === 1 ? "puzzle" : "puzzles"}
                {s.rush!.score > s.rush!.best ? (s.rush!.best > 0 ? `, a new best (was ${s.rush!.best}).` : ".") : `. Your best is ${s.rush!.best}.`}
              </div>
            )}
            {s.status === "solved" && (
              <>
                <strong className="solved-line">✓ Solved!</strong>
                {change !== null && change !== 0 && (
                  <span className={`solved-gain ${change > 0 ? "up" : "down"}`}>{change > 0 ? `+${change}` : change}</span>
                )}
              </>
            )}
            {s.status === "failed" && !s.rush?.ended && (
              <>
                <strong>✗ Missed.</strong> {s.message} <span className="muted">Saved as a drill.</span>
              </>
            )}
            {s.status === "empty" &&
              (s.set.fromCoach ? (
                <>
                  <strong>Set done.</strong> Solved {s.results.filter((r) => r.correct).length} of {s.results.length}.
                </>
              ) : s.rush ? (
                "No more puzzles at this level."
              ) : (
                "No puzzles match these filters. Try another theme or difficulty."
              ))}
            {s.status === "error" && "Couldn't load puzzles."}
          </div>
          )}

          {info && (rv || over) && (
            <div className="puzzle-info">
              <div>
                Puzzle rating <strong>{fromLichess(info.rating)}</strong> · played {info.plays.toLocaleString()} times
              </div>
              {!rv && s.mastery ? (
                <MasteryGains gains={s.mastery} />
              ) : (
                <>
                  <div className="puzzle-tags">
                    {info.themes
                      .filter((t) => !META_THEMES.has(t))
                      .map((t) => (
                        <span key={t} className="chip">
                          {themeLabel(t)}
                        </span>
                      ))}
                  </div>
                  {/* Rated, but none of its tags earns XP (only length tags, say): no theme to give it to. */}
                  {!rv && s.change && <div className="muted small">None of this puzzle's tags earn theme XP.</div>}
                </>
              )}
              {info.openings[0] && <div className="muted">{openingLabel(info.openings[info.openings.length - 1])}</div>}
            </div>
          )}
          <div className="puzzle-credit muted">Puzzles from the Lichess open database (CC0).</div>
        </div>

        {(rv || line) && <StepButtons onStep={viewStep} disabled={!rv && line!.sans.length === 0} onHoldBack={rv ? undefined : recall} />}

        {rv ? (
          <div className="side-actions">
            <button className="primary" onClick={backToCurrent}>
              Back to puzzle {s.index + 1}
            </button>
          </div>
        ) : (
        <div className="side-actions">
          {!s.rush && (s.status === "solving" || s.status === "intro" || s.status === "loading") && (
            <button onClick={puzzleHint} disabled={s.status !== "solving"} title="Shows which piece to move. The puzzle counts as missed.">
              Hint
            </button>
          )}
          {(s.status === "solving" || s.status === "intro" || s.status === "loading") && (
            <button onClick={showSolution} disabled={s.status === "loading"}>
              View solution
            </button>
          )}
          {s.rush && !rushOver && s.status !== "error" && s.status !== "empty" && (
            <button onClick={endRush} title="Finish this run now; otherwise it waits for you until the lives run out">
              End run
            </button>
          )}
          {over && (
            <>
              {rushOver ? (
                <button className="primary" onClick={() => startRush()}>
                  Play again
                </button>
              ) : (
                <NextButton autoNextAt={s.autoNextAt} />
              )}
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
        )}
      </aside>
    </main>
  );
}

/**
 * The run so far, one tile per puzzle (a check or a cross with its rating), then the one on the
 * board. A finished one opens again for a look; the current one (or "Back to puzzle") returns to it.
 */
function RushHistory({ s }: { s: PuzzleSession }) {
  const box = useRef<HTMLDivElement>(null);
  const count = s.results.length;
  // New tiles come in at the end: keep the latest in view.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  const currentDone = s.results.some((r) => r.at === s.index);
  const puzzle = s.queue[s.index];
  if (!count && !puzzle) return null;
  return (
    <div ref={box} className="rush-history" aria-label="This run's puzzles">
      {s.results.map((r, i) => {
        const current = r.at === s.index;
        const on = s.review ? s.review.result === i : current;
        return (
          <button
            key={i}
            className={`rush-tile ${r.correct ? "good" : "bad"}${on ? " on" : ""}`}
            onClick={() => (current ? backToCurrent() : reviewResult(i))}
            disabled={!r.line}
            title={`Puzzle ${(r.at ?? i) + 1}: ${r.correct ? "solved" : "missed"}${current ? " (on the board)" : r.line ? ". Click to look at it again." : ""}`}
          >
            <span className="rush-mark">{r.correct ? "✓" : "✗"}</span>
            <span className="rush-rating">{fromLichess(r.rating)}</span>
          </button>
        );
      })}
      {puzzle && !currentDone && s.status !== "empty" && (!s.rush || s.rush.lives > 0) && (
        <button className={`rush-tile now${s.review ? "" : " on"}`} onClick={backToCurrent} title={`Puzzle ${s.index + 1}: the one on the board`}>
          <span className="rush-mark">{s.index + 1}</span>
          <span className="rush-rating">{fromLichess(puzzle.rating)}</span>
        </button>
      )}
    </div>
  );
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The board frame with the puzzle's feedback on top: a ✓ or ✗ badge on the square just played (until
 * the position moves on), the puzzle rating counting up over the board on a solve, a shake on a
 * wrong move, and the frame itself turning green or red once the puzzle is over.
 */
export function CueFrame({
  status,
  orientation,
  fen,
  rating,
  after,
  frameClass = "puzzle",
  burst = true,
  children,
}: {
  /** The big ✓ over the board on a solve; the course leaves it out (the badge on the square is enough). */
  burst?: boolean;
  status: string;
  /** The frame's look: the puzzle's, or a trainer's own ("drill"). */
  frameClass?: string;
  orientation: "white" | "black";
  fen: string;
  /** The student's puzzle rating before and after this puzzle (chess.com scale), once it's saved. */
  rating: { before: number; after: number } | null;
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  const fx = usePuzzleFx();
  const frame = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const shown = fx && fx.fen === fen ? fx : null;
  // The rating comes back a moment after the solve; a puzzle that wasn't rated (a retry, or
  // offline) gets the plain ✓ once it's clear none is coming.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (fx?.kind !== "solved") return;
    const id = window.setTimeout(() => setWaited(true), 700);
    return () => window.clearTimeout(id);
  }, [fx?.id]);

  // Motion through the Web Animations API, so the board itself is never remounted.
  useEffect(() => {
    if (!fx || reducedMotion()) return;
    if (fx.kind === "wrong")
      board.current?.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-7px)" },
          { transform: "translateX(6px)" },
          { transform: "translateX(-4px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 320, easing: "ease-out" },
      );
    if (fx.kind === "solved")
      frame.current?.animate(
        [
          { boxShadow: "0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent)" },
          { boxShadow: "0 0 0 16px color-mix(in srgb, var(--accent) 0%, transparent)" },
        ],
        { duration: 750, easing: "ease-out" },
      );
  }, [fx?.id]);

  const over = status === "solved" ? " solved" : status === "failed" ? " failed" : "";
  // No puzzle on the board yet: an empty board, not the starting position flashing up first.
  const waiting = status === "loading" || status === "error" || status === "empty" ? " waiting" : "";
  return (
    <div ref={frame} className={`board-frame ${frameClass}${over}${waiting}`}>
      <div ref={board} className="cue-board">
        {children}
        {shown && (
          <div className="cue-layer" aria-hidden>
            {shown.square && <SquareCue key={shown.id} kind={shown.kind} square={shown.square} orientation={orientation} />}
            {shown.kind === "solved" &&
              burst &&
              (rating ? (
                <RatingBurst key={`r${shown.id}`} before={rating.before} after={rating.after} />
              ) : (
                waited && (
                  <div key={`b${shown.id}`} className="cue-burst">
                    ✓
                  </div>
                )
              ))}
          </div>
        )}
      </div>
      {after}
    </div>
  );
}

/**
 * Over the board after a solve: the puzzle rating with the gain beside it, counting up to the new
 * rating fast, a rising tick per step. At most ~24 steps, so a big early gain still takes under a second.
 */
function RatingBurst({ before, after }: { before: number; after: number }) {
  const [shown, setShown] = useState(before);
  const d = after - before;
  useEffect(() => {
    if (d === 0) return;
    if (reducedMotion()) return setShown(after);
    const steps = Math.min(Math.abs(d), 24);
    let i = 0;
    let id = 0;
    // A beat to see the gain first, then the climb.
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        i += 1;
        setShown(Math.round(before + (d * i) / steps));
        play("rating-tick", 1 + (0.25 * i) / steps);
        if (i >= steps) window.clearInterval(id);
      }, 38);
    }, 350);
    return () => (window.clearTimeout(start), window.clearInterval(id));
  }, [before, after]);
  return (
    <div className={`rating-burst${shown === after && d !== 0 ? " done" : ""}`}>
      <span className="rating-burst-num">{shown}</span>
      <span className={`rating-burst-gain ${d >= 0 ? "up" : "down"}`}>{d >= 0 ? `+${d}` : d}</span>
    </div>
  );
}

function SquareCue({ kind, square, orientation }: { kind: string; square: Key; orientation: "white" | "black" }) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  const good = kind !== "wrong";
  return (
    <div className={`square-cue ${good ? "good" : "bad"}`} style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}>
      <span className="square-badge">{good ? "✓" : "✗"}</span>
    </div>
  );
}

/** The rush's lives left (hearts) and puzzles solved. */
function RushStatus({ lives, score }: { lives: number; score: number }) {
  return (
    <span className="rush-status" title={`${lives} of ${RUSH_LIVES} lives left`}>
      <span className="rush-lives" aria-label={`${lives} lives left`}>
        {Array.from({ length: RUSH_LIVES }, (_, i) => (
          <span key={i} className={i < lives ? "life" : "life lost"}>
            ♥
          </span>
        ))}
      </span>
      <span className="rush-score">
        Score <strong>{score}</strong>
      </span>
    </span>
  );
}

/** The puzzle rating, counting up (or down) to its new value, with the change floating off it. */
function RatingTicker({ rating, change, attempts, puzzleId }: { rating: number; change: number | null; attempts: number; puzzleId: string }) {
  const [shown, setShown] = useState(rating);
  const from = useRef(rating);
  useEffect(() => {
    const start = from.current;
    from.current = rating;
    if (start === rating) return;
    if (reducedMotion()) return setShown(rating);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (rating - start) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rating]);
  const dir = change === null ? "" : change >= 0 ? "up" : "down";
  return (
    <span className={`puzzle-rating${shown !== rating ? ` ticking ${dir}` : ""}`} title={`${attempts} rated puzzles`}>
      Rating <span className="rating-num">{shown}</span>
      {change !== null && (
        <span className={`rating-delta ${dir}`}>
          {change >= 0 ? ` +${change}` : ` ${change}`}
          {change !== 0 && (
            <span key={puzzleId} className={`rating-float ${dir}`}>
              {change > 0 ? `+${change}` : change}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** Next, filling up while a solved puzzle waits to move on by itself; a click goes right away. */
function NextButton({ autoNextAt }: { autoNextAt: number | null }) {
  // Started late (a re-render mid-wait): the fill picks up where the wait is.
  const elapsed = autoNextAt ? Math.min(AUTO_NEXT_MS, AUTO_NEXT_MS - (autoNextAt - Date.now())) : 0;
  return (
    <button className="primary next-btn" onClick={nextPuzzle}>
      {autoNextAt && (
        <span key={autoNextAt} className="next-fill" style={{ animationDuration: `${AUTO_NEXT_MS}ms`, animationDelay: `${-elapsed}ms` }} />
      )}
      <span className="next-label">Next</span>
    </button>
  );
}

function AutoNextToggle() {
  const on = useSettings((st) => st.puzzleAutoNext);
  return (
    <label className="toggle auto-next">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          saveSetting("puzzleAutoNext", e.target.checked);
          if (!e.target.checked) holdPuzzle();
        }}
      />
      <span>Next puzzle automatically after a solve</span>
    </label>
  );
}

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "easiest", label: "Easiest" },
  { value: "easier", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "harder", label: "Hard" },
  { value: "hardest", label: "Harder" },
];

/** "Puzzles rated 600–1000": the fixed band behind a difficulty, for the button's tooltip. */
function bandLabel(d: Difficulty): string {
  const [lo, hi] = BANDS[d];
  return lo <= 0 ? `Puzzles rated under ${hi}` : hi >= 4000 ? `Puzzles rated ${lo}+` : `Puzzles rated ${lo}–${hi}`;
}

/** The ⚙ in the puzzle column: theme, position and difficulty (not for a coach's set), and auto-next. */
function PuzzleSettings({ filters }: { filters: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Phones: a sheet over the page instead, since a popover under the board runs off the screen.
  const sheet = matchMedia("(max-width: 760px)").matches;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="puzzle-settings" ref={root}>
      <button className="icon" onClick={() => setOpen((o) => !o)} title="Puzzle settings" aria-label="Puzzle settings" aria-expanded={open}>
        ⚙
      </button>
      {open &&
        (sheet ? (
          createPortal(
            <div className="sheet-backdrop">
              <div ref={pop} className="puzzle-settings-pop sheet" role="dialog" aria-label="Puzzle settings">
                <div className="sheet-head">
                  <strong>Puzzle settings</strong>
                  <button className="icon" onClick={() => setOpen(false)} aria-label="Close">
                    ✕
                  </button>
                </div>
                {filters && <Filters />}
                <AutoNextToggle />
              </div>
            </div>,
            document.body,
          )
        ) : (
          <div ref={pop} className="puzzle-settings-pop" role="dialog" aria-label="Puzzle settings">
            {filters && <Filters />}
            <AutoNextToggle />
          </div>
        ))}
    </div>
  );
}

/** What the filters are set to, so the choice shows with the settings closed. Nothing when all are "any". */
function ChoiceSummary({ className = "puzzle-choice" }: { className?: string }) {
  const choice = usePuzzle((s) => s!.choice);
  const parts = [
    choice.theme && themeLabel(choice.theme),
    choice.opening && openingLabel(choice.opening),
    choice.difficulty !== "normal" && DIFFICULTIES.find((d) => d.value === choice.difficulty)?.label,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <div className={`${className} muted`}>{parts.join(" · ")}</div>;
}

function Filters() {
  const choice = usePuzzle((s) => s!.choice);
  const tags = usePuzzleDb((s) => s.tags);
  const themes = tags.filter((t) => t.kind === "theme" && !META_THEMES.has(t.tag)).sort((a, b) => themeLabel(a.tag).localeCompare(themeLabel(b.tag)));
  const families = tags.filter((t) => t.kind === "family").slice(0, 60).sort((a, b) => a.tag.localeCompare(b.tag));
  const extra = choice.opening && !families.some((f) => f.tag === choice.opening) ? [choice.opening] : [];

  return (
    <div className="puzzle-filters">
      <span className="field-label">Theme</span>
      <select value={choice.theme ?? ""} onChange={(e) => setChoice({ theme: e.target.value || null })} aria-label="Theme">
        <option value="">Any theme</option>
        {themes.map((t) => (
          <option key={t.tag} value={t.tag}>
            {themeLabel(t.tag)}
          </option>
        ))}
      </select>
      <span className="field-label">Position</span>
      <select value={choice.opening ?? ""} onChange={(e) => setChoice({ opening: e.target.value || null })} aria-label="Opening">
        <option value="">Any position</option>
        <optgroup label="Openings">
          {[...extra, ...families.map((f) => f.tag)].map((t) => (
            <option key={t} value={t}>
              {openingLabel(t)}
            </option>
          ))}
        </optgroup>
      </select>
      <span className="field-label">Difficulty</span>
      <div className="segmented">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.value}
            className={choice.difficulty === d.value ? "on" : ""}
            title={bandLabel(d.value)}
            onClick={() => setChoice({ difficulty: d.value })}
          >
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
