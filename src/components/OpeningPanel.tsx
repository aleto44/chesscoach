import { useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { sendToCoach } from "../coach/bridge";
import { useAuth } from "../coach/auth";
import { viewedPly } from "../chess/view";
import { lastMoveContext } from "../chess/line";
import { hasBackend } from "../db";
import {
  explainOpening,
  openingHint,
  openingMove,
  openingPlan,
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
import { SquareText } from "./SquareText";
import { planShapes, type PlanIdea } from "../openings/plans";
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
  // At the end of the line: the plan for the student's side, one idea at a time with its drawings.
  const plan = openingPlan(s);
  const [ideaIndex, setIdeaIndex] = useState(0);
  useEffect(() => setIdeaIndex(0), [s.line, s.target]);
  const idea = plan?.[Math.min(ideaIndex, plan.length - 1)] ?? null;
  const ideaShapes = useMemo(() => (idea ? planShapes(idea) : null), [idea]);
  // Messages speak about the latest moves; a move they name is placed on the position it's played from.
  const said = lastMoveContext(s.line);

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
          shapes={past ? undefined : (ideaShapes ?? shapes)}
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
            <SquareText text={s.message} {...said} />
            {s.status === "off" && s.why?.evals && <WhyEvals why={s.why} at={said.at} />}
          </>
        ) : (
          <>
            You play {set.color}. Move {Math.min(s.line.sans.length, s.target.moves.length)} of {s.target.moves.length} in the line.
            {s.message && (
              <span className="muted">
                {" "}
                <SquareText text={s.message} {...said} />
              </span>
            )}
          </>
        )}
      </div>
      {plan && idea && !past && (
        <PlanCard plan={plan} index={plan.indexOf(idea)} onIndex={setIdeaIndex} at={s.line.fens[s.line.sans.length]} />
      )}
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

/** The plan at the end of a line: one idea at a time; the board shows that idea's drawings. */
function PlanCard({ plan, index, onIndex, at }: { plan: PlanIdea[]; index: number; onIndex: (i: number) => void; at: string }) {
  const idea = plan[index];
  return (
    <section className="opening-plan" aria-label="What you're playing for">
      <div className="opening-plan-head">
        <strong>What you're playing for</strong>
        <span className="spacer" />
        {plan.length > 1 && (
          <span className="opening-plan-nav">
            <button onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous idea">
              ‹
            </button>
            <span className="muted small">
              {index + 1} of {plan.length}
            </span>
            <button onClick={() => onIndex(index + 1)} disabled={index === plan.length - 1} aria-label="Next idea">
              ›
            </button>
          </span>
        )}
      </div>
      <div className="opening-plan-title">{idea.title}</div>
      <p>
        <SquareText text={idea.text} at={at} />
      </p>
    </section>
  );
}

/** Under "leaves the line": the engine on both moves. The coach explains in the chat column. */
function WhyEvals({ why, at }: { why: OffLineWhy; at?: string }) {
  if (!why.evals) return null;
  return (
    <span className="status-extra opening-why-evals">
      <span className="good">
        Book{" "}
        <strong>
          <SquareText text={why.book} at={at} />
        </strong>{" "}
        {evalText(why.evals.book)}
      </span>
      <span className="muted"> · </span>
      <span className="bad">
        Yours{" "}
        <strong>
          <SquareText text={why.played} at={at} />
        </strong>{" "}
        {evalText(why.evals.played)}
      </span>
      <span className="muted small"> (engine, for you)</span>
    </span>
  );
}
