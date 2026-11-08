import { useMemo } from "react";
import type { DrawShape } from "chessground/draw";
import { sendToCoach } from "../coach/bridge";
import { useAuth } from "../coach/auth";
import { viewedPly } from "../chess/view";
import { hasBackend } from "../db";
import {
  explainOpening,
  openingHint,
  openingMove,
  openingQuestion,
  openingSetOf,
  openingStep,
  openingTakeBack,
  retryOpening,
  startOpening,
  stopOpening,
  useOpening,
} from "../openings/session";
import { pickLine, shortName } from "../openings/training";
import { canExplain, evalText } from "../openings/explain";
import { useTrainerChat } from "../coach/trainerChat";
import type { OffLineWhy } from "../openings/session";
import { isLocked, useStore } from "../store";
import { Board } from "./Board";
import { BoardSteps, StepButtons } from "./StepButtons";

/** Replaces the game board while an opening line is being trained. */
export function OpeningPanel() {
  const s = useOpening()!;
  const busy = useStore((st) => st.busy);
  // A rated game in progress keeps the coach off, wherever the student is.
  const locked = useStore((st) => isLocked(st.meta));
  const signedIn = useAuth((a) => a.status === "signed-in") || !hasBackend();
  const set = openingSetOf(s);
  const ply = viewedPly(s.line.sans.length, s.view);
  const past = ply < s.line.sans.length;
  const shapes = useMemo(() => s.shapes as DrawShape[], [s.shapes]);
  const over = s.status === "done" || s.status === "off";
  // Off the line with a move that's about as good: not a mistake, so no ✗ and no explanation unless asked.
  const close = s.status === "off" && !!s.why?.close;
  const explaining = useTrainerChat((t) => t.thinkingSince !== null);

  return (
    <main className="board-panel drills tall-status">
      <div className="game-bar">
        <span className="game-status">
          <strong>Opening trainer</strong>
          <span className="muted"> · {set.name}</span>
        </span>
        <span className="spacer" />
        <button onClick={stopOpening}>‹ Lines</button>
      </div>
      <div className="crumbs">
        <span className="crumb current">{shortName(set, s.target)}</span>
      </div>
      <div className="board-frame drill">
        <Board
          fen={s.line.fens[ply]}
          lastMove={ply > 0 ? s.line.lastMoves[ply - 1] : undefined}
          orientation={set.color}
          onMove={openingMove}
          canMove={s.status === "playing" && !past}
          premoveColor={!over && !past ? set.color : undefined}
          shapes={past ? undefined : shapes}
        />
        <BoardSteps onStep={openingStep} disabled={s.line.sans.length === 0} />
      </div>
      <StepButtons onStep={openingStep} disabled={s.line.sans.length === 0} />
      <div className={`drill-status ${close ? "solving" : s.status === "off" ? "wrong" : s.status === "done" ? "right" : "solving"}`}>
        {past && !over ? (
          <>
            <strong>Looking back.</strong> Step forward (▶ or ⏭) to play on.
          </>
        ) : over ? (
          <>
            <strong>{close ? "≈ " : s.status === "off" ? "✗ " : "✓ "}</strong>
            {s.message}
            {s.status === "off" && s.why?.evals && <WhyEvals why={s.why} />}
          </>
        ) : (
          <>
            You play {set.color}. Move {Math.min(s.line.sans.length, s.target.moves.length)} of {s.target.moves.length} in the line.
            {s.message && <span className="muted"> {s.message}</span>}
          </>
        )}
      </div>
      <div className="controls">
        {s.status === "off" ? (
          <>
            <button className="primary" onClick={openingTakeBack}>
              Take back
            </button>
            <button onClick={retryOpening}>Start over</button>
            {close && canExplain() && (
              <button onClick={explainOpening} disabled={explaining} title="The coach explains in the chat">
                Why the book move?
              </button>
            )}
          </>
        ) : s.status === "done" ? (
          <>
            <button className="primary" onClick={() => startOpening(set.id, pickLine(set))}>
              Another line
            </button>
            <button onClick={retryOpening}>Again</button>
          </>
        ) : (
          <button onClick={openingHint} disabled={s.status !== "playing" || past}>
            Hint
          </button>
        )}
        {signedIn && !locked && (
          <button onClick={() => sendToCoach(openingQuestion())} disabled={busy} title="One message to the coach">
            Ask the coach
          </button>
        )}
      </div>
    </main>
  );
}

/** Under "leaves the line": the engine on both moves. The coach explains in the chat column. */
function WhyEvals({ why }: { why: OffLineWhy }) {
  if (!why.evals) return null;
  return (
    <span className="status-extra opening-why-evals">
      <span className="good">
        Book <strong>{why.book}</strong> {evalText(why.evals.book)}
      </span>
      <span className="muted"> · </span>
      <span className="bad">
        Yours <strong>{why.played}</strong> {evalText(why.evals.played)}
      </span>
      <span className="muted small"> (engine, for you)</span>
    </span>
  );
}
