import { useEffect, useMemo, useRef } from "react";
import { resign, switchToPractice, takeBack, takebackPly } from "../game/session";
import { timeControlLabel } from "../game/clock";
import {
  useStore,
  boardMove,
  goto,
  step,
  openTangent,
  tangentPath,
  flip,
  canStudentMove,
  isLocked,
  opponentLabel,
  scenarioOf,
  boardOrientation,
  type GameMeta,
} from "../store";
import { Board } from "./Board";
import { sessionName, useNav } from "../nav";
import { BoardSteps } from "./StepButtons";
import { askConfirm } from "./Confirm";
import { EvalBar, EvalLine } from "./EvalBar";
import { MaterialStrip } from "./Material";
import { ModeBadge } from "./ModeBadge";
import { PlayerCard } from "./Clock";
import { GameReportPanel, LabelIcon, listLabel, ReviewBar, useGameReport, useMoment, useVerdict, VerdictLine } from "./Review";
import { WhyButton } from "./Why";
import { SquareText } from "./SquareText";
import { RatingResult } from "./RatingResult";
import type { MoveLabel } from "../analysis/review";
import { bestShape, useNudge } from "../coach/nudge";
import { saveSetting, useSettings } from "../settings";
import { signed } from "../rating";

/**
 * The board, with a side column like lichess's: the player at the top of the board, the moves and
 * controls, then the player at the bottom.
 */
export function BoardPanel() {
  const { game, gamePly, tangents, active, meta, opponentThinking, annotations, arrows, reportOpen, gameFork } = useStore();
  const moment = useMoment();
  const verdict = useVerdict();
  const report = useGameReport();
  const nudge = useNudge();
  const nudgeShapes = useMemo(() => (nudge ? bestShape(nudge) : []), [nudge]);
  const locked = isLocked(meta);
  const showEval = useSettings((s) => s.showEval) && !locked;
  const canTakeBack = takebackPly(game, meta) !== null;
  const tangent = active ? tangents[active] : null;
  // A coach scenario keeps the side it was made for (e.g. Black for a position the student had as Black).
  const orientation = useStore((s) => boardOrientation(s));
  // What-if moves on a finished game (store.gameFork): the game up to gamePly, then the student's.
  const fork = tangent ? null : gameFork;
  const line = tangent ? tangent.line : fork ? fork.line : game;
  const ply = tangent ? tangent.ply : fork ? fork.ply : gamePly;
  const path = tangentPath(active);
  // A scenario opened over a puzzle, drill or trainer goes back to that, not to the game.
  const peek = useNav((n) => n.peek) && !!tangent;
  const under = peek ? sessionName() : null;
  const note = ply > 0 ? line.notes[ply - 1] : "";
  const vsOpponent = meta.studentColor !== "both";
  const inProgress = vsOpponent && !meta.result;
  const top = orientation === "white" ? "black" : "white";
  // The coach's drawings for this step of its scenario (show_line / setup_position).
  const scenario = useStore((s) => scenarioOf(s.chat, active));
  const shapes = useMemo(() => {
    const coach = [...(scenario?.shapes?.[ply] ?? []), ...(arrows?.fen === line.fens[ply] ? arrows.shapes : [])];
    const drawn =
      moment?.shapes ??
      (nudge?.showBest && !tangent && line.fens[ply] === nudge.fenBefore ? nudgeShapes : undefined) ??
      (coach.length ? coach : undefined);
    // The review's badge on the square the last move went to.
    return verdict ? [...(drawn ?? []), verdict.badge] : drawn;
  }, [moment, nudge, nudgeShapes, tangent, line, ply, arrows, verdict, scenario]);

  const confirmResign = async () => {
    if (await askConfirm({ title: "Resign this game?", body: `${opponentLabel(meta)} wins.`, confirmLabel: "Resign", danger: true }))
      resign();
  };
  const confirmHelp = async () => {
    const ok = await askConfirm({
      title: "Switch to practice?",
      body: "The engine, coach and takebacks turn on, and this game stops counting as rated. This can't be undone.",
      confirmLabel: "Switch to practice",
    });
    if (ok) switchToPractice();
  };

  // `live`: a game being played, which phones show as just the board, the clocks and the game's
  // buttons (see styles.css).
  return (
    <main className={`board-panel play ${inProgress && !tangent ? "live" : ""} ${locked ? "locked" : ""}`}>
      <nav className="crumbs">
        <button className={`crumb ${active ? "" : "current"}`} onClick={() => openTangent(null)}>
          {under ? under[0].toUpperCase() + under.slice(1) : "Game"}
        </button>
        {path.map((t) => (
          <span key={t.id}>
            <span className="sep">›</span>
            <button className={`crumb ${t.id === active ? "current" : ""}`} onClick={() => openTangent(t.id)}>
              {t.title}
            </button>
          </span>
        ))}
        {tangent && (
          <button className="return" onClick={() => openTangent(null)}>
            {under ? `Back to the ${under}` : "Return to game"}
          </button>
        )}
      </nav>

      <div className={`board-frame ${tangent ? "tangent" : ""} ${showEval ? "with-eval" : ""}`}>
        {!locked && (
          <button
            className={`eval-toggle ${showEval ? "on" : ""}`}
            onClick={() => saveSetting("showEval", !showEval)}
            title={showEval ? "Hide engine evaluation" : "Show engine evaluation"}
            aria-pressed={showEval}
          >
            <span className="eval-toggle-icon" />
          </button>
        )}
        {showEval && <EvalBar orientation={orientation} />}
        {!tangent && <RatingResult />}
        <MaterialStrip fen={line.fens[ply]} side={top} />
        <Board
          fen={line.fens[ply]}
          lastMove={ply > 0 ? line.lastMoves[ply - 1] : undefined}
          orientation={orientation}
          onMove={boardMove}
          canMove={canStudentMove()}
          shapes={shapes}
          premoveColor={
            !tangent && !meta.result && meta.studentColor !== "both" && gamePly === game.sans.length
              ? meta.studentColor
              : undefined
          }
        />
        <MaterialStrip fen={line.fens[ply]} side={orientation} />
        <BoardSteps onStep={(s) => (s === "start" ? goto(0) : s === "end" ? goto(line.sans.length) : step(s))}>
          <button className="icon" onClick={flip} title="Flip board" aria-label="Flip board">⇅</button>
        </BoardSteps>
      </div>

      <aside className="game-side">
        <div className="game-head">
          {vsOpponent ? <ModeBadge mode={meta.mode} /> : <strong>Free play</strong>}
          {meta.timeControl && <span className="muted">{timeControlLabel(meta.timeControl)}</span>}
          <span className="spacer" />
          <span className={`game-state ${meta.result ? "over" : ""}`}>
            {gameStatus(meta, opponentThinking, game.fens[game.sans.length])}
          </span>
        </div>

        <PlayerCard side={top} place="top" />

        <div className="side-body">
          {reportOpen && report && !tangent ? (
            <GameReportPanel report={report} />
          ) : (
            <>
              <MoveList
                sans={line.sans}
                fens={line.fens}
                ply={ply}
                marks={tangent ? undefined : annotations.slice(0, fork ? gamePly : undefined).map(listLabel)}
                forkAt={fork ? gamePly : null}
              />
              {fork && (
                <div className="note fork-note">
                  <span>
                    <strong>What if…</strong> Your own moves from move {game.fens[gamePly].split(" ")[5]}. Step back past them to return to
                    the game.
                  </span>
                  <button onClick={() => goto(gamePly)}>Back to the game</button>
                </div>
              )}
              {showEval && <EvalLine />}
              {verdict && <VerdictLine v={verdict} />}
              {fork ? null : moment ? (
                <div className="note moment">
                  <SquareText text={moment.text} />
                  {moment.reason && (
                    <p className="moment-reason">
                      <SquareText text={moment.reason} />
                    </p>
                  )}
                  <WhyButton i={gamePly} />
                </div>
              ) : verdict?.explain || verdict?.reason ? (
                <div className="note moment">
                  {verdict.reason && (
                    <p className="moment-reason">
                      <SquareText text={verdict.reason} />
                    </p>
                  )}
                  <WhyButton i={gamePly - 1} />
                </div>
              ) : (
                note && <div className="note">{note}</div>
              )}
            </>
          )}
          <ReviewBar />
        </div>

        <div className="side-controls">
          <div className="nav-buttons">
            <button onClick={() => goto(0)} title="Start (Home)" aria-label="Start">⏮</button>
            <button onClick={() => step(-1)} title="Back (←)" aria-label="Back">◀</button>
            <button onClick={() => step(1)} title="Forward (→)" aria-label="Forward">▶</button>
            <button onClick={() => goto(line.sans.length)} title="End (End)" aria-label="End">⏭</button>
          </div>
          <button className="icon" onClick={flip} title="Flip board" aria-label="Flip board">⇅</button>
        </div>

        {inProgress && !tangent && (
          <div className="side-actions">
            {meta.mode === "practice" && (
              <button onClick={takeBack} disabled={!canTakeBack} title="Take back your last move">
                ↶ Take back
              </button>
            )}
            {locked && (
              <button onClick={confirmHelp} title="Turn on the engine, coach and takebacks for this game">
                Get help
              </button>
            )}
            <button className="resign" onClick={confirmResign} disabled={game.sans.length === 0}>
              ⚑ Resign
            </button>
          </div>
        )}

        <PlayerCard side={orientation} place="bottom" />
      </aside>
    </main>
  );
}

function gameStatus(meta: GameMeta, thinking: boolean, endFen: string): string {
  if (meta.result) {
    const mine =
      meta.studentColor === "both"
        ? ""
        : meta.result === "1/2-1/2"
          ? "Draw"
          : (meta.result === "1-0") === (meta.studentColor === "white")
            ? "You won"
            : "You lost";
    const rating = meta.rating ? ` · ${meta.rating.after} (${signed(meta.rating.after - meta.rating.before)})` : "";
    return `${mine ? `${mine} · ` : ""}${meta.termination ?? meta.result}${rating}`;
  }
  if (meta.studentColor === "both") return "Move both sides";
  if (thinking) return "Thinking…";
  const turn = endFen.split(" ")[1] === "w" ? "white" : "black";
  return turn === meta.studentColor ? "Your move" : "Their move";
}

/** Moves in rows, one per move number, scrolled to keep the current move in view. */
export function MoveList({
  sans,
  fens,
  ply,
  marks,
  forkAt = null,
  onGoto = goto,
}: {
  sans: string[];
  fens: string[];
  ply: number;
  marks?: (MoveLabel | null)[];
  /** Moves from this index on are the student's what-if moves. */
  forkAt?: number | null;
  /** Clicking a move: the main board's by default. */
  onGoto?: (ply: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    const current = el?.querySelector<HTMLElement>(".mv.current");
    if (!el) return;
    if (current) current.scrollIntoView({ block: "nearest" });
    else if (ply === 0) el.scrollTop = 0;
  }, [ply, sans.length]);

  if (sans.length === 0) return <div className="moves empty">No moves yet. Drag a piece to play.</div>;

  const rows: { num: string; cells: (number | null)[] }[] = [];
  sans.forEach((_, i) => {
    const [, turn, , , , full] = fens[i].split(" ");
    if (turn === "w" || i === 0) rows.push({ num: full, cells: turn === "w" ? [i] : [null, i] });
    else rows[rows.length - 1].cells.push(i);
  });

  return (
    <div className="moves" ref={list}>
      {rows.map((r) => (
        <div className="move-row" key={r.num}>
          <span className="num">{r.num}.</span>
          {[0, 1].map((c) => {
            const i = r.cells[c];
            if (i === undefined) return <span key={c} />;
            if (i === null) return <span key={c} className="mv muted">…</span>;
            return (
              <button
                key={c}
                className={`mv ${i + 1 === ply ? "current" : ""} ${forkAt !== null && i >= forkAt ? "fork" : ""}`}
                onClick={() => onGoto(i + 1)}
              >
                {sans[i]}
                {marks?.[i] && <LabelIcon label={marks[i]} size={14} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
