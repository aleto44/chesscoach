import { useMemo } from "react";
import type { DrawShape } from "chessground/draw";
import { sendToCoach } from "../coach/bridge";
import { useAuth } from "../coach/auth";
import { viewedPly } from "../chess/view";
import { hasBackend } from "../db";
import { planShapes } from "../openings/plans";
import { planPositions, planQueue, planRecords } from "../plans/positions";
import { moveText } from "../plans/describe";
import {
  answered,
  explainPlan,
  nextPlan,
  planHint,
  planMove,
  planOf,
  planQuestion,
  planStep,
  retryPlan,
  setPlanIdea,
  startPlans,
  stopPlans,
  usePlan,
} from "../plans/session";
import { isLocked, useStore } from "../store";
import { useFromGames } from "../training/games";
import { Board } from "./Board";
import { PlanCard } from "./OpeningPanel";
import { SquareText } from "./SquareText";
import { BoardSteps, StepButtons } from "./StepButtons";

/** School › Find the plan: quiet positions from the student's games, and how they've done. */
export function PlansMenu() {
  const { data, error } = useFromGames({ realOnly: false, maxPly: null, limit: 200 }, planPositions);
  const records = planRecords();
  const queue = data ? planQueue(data) : [];
  const tried = queue.filter((p) => records[p.id]).length;
  const found = queue.filter((p) => records[p.id]?.right).length;
  return (
    <>
      <h2 className="section-title">Find the plan</h2>
      <p className="section-lede muted">
        Quiet positions from your own games, where nothing is hanging and the right move is about the position: a piece
        to reroute, a pawn break, a file to take. Play the move you'd make. The engine grades it and shows its plan, and
        the coach can explain the idea.
      </p>
      {error && <p className="muted">Couldn't load your games: {error}</p>}
      {!data && !error && <p className="muted">Looking through your games…</p>}
      {data && queue.length === 0 && (
        <p className="muted">
          No positions yet. They come from analyzed games where you made a quiet, non-tactical mistake in the middlegame.
          Play or import a few more games and let them be analyzed.
        </p>
      )}
      {queue.length > 0 && (
        <>
          <p>
            {queue.length} positions · tried {tried} · found the plan in {found}
          </p>
          <div className="controls">
            <button className="primary" onClick={() => startPlans(queue)}>
              {tried ? "Continue" : "Start"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** Replaces the game board while a plan session runs. */
export function PlanPanel() {
  const s = usePlan()!;
  const busy = useStore((st) => st.busy);
  const locked = useStore((st) => isLocked(st.meta));
  const signedIn = useAuth((a) => a.status === "signed-in") || !hasBackend();
  const p = planOf(s);
  const ply = viewedPly(s.line.sans.length, s.view);
  const done = answered(s);
  const idea = s.ideas?.[s.ideaIndex];
  // Before the move: the coach's idea when one is open, else the engine's plan (after answering) or the hint.
  const shapes = useMemo(
    () => (idea ? planShapes(idea) : ply === 0 ? (s.shapes as DrawShape[]) : undefined),
    [idea, ply, s.shapes],
  );
  if (!p) return null;
  const start = s.line.fens[0];
  const statusClass = s.status === "wrong" ? "wrong" : done ? "right" : "solving";

  return (
    <main className="board-panel drills tall-status">
      <div className="game-bar">
        <span className="game-status">
          <strong>Find the plan</strong>
          <span className="muted">
            {" "}
            · {s.index + 1} of {s.queue.length}
            {s.answered ? ` · found ${s.found} of ${s.answered}` : ""}
          </span>
        </span>
        <span className="spacer" />
        <button onClick={stopPlans}>‹ Positions</button>
      </div>
      <div className="crumbs">
        <span className="crumb current">{p.note}</span>
      </div>
      <div className="board-frame drill">
        <Board
          fen={s.line.fens[ply]}
          lastMove={ply > 0 ? s.line.lastMoves[ply - 1] : undefined}
          orientation={p.color}
          onMove={planMove}
          canMove={s.status === "solving" && ply === s.line.sans.length}
          shapes={shapes}
        />
        <BoardSteps onStep={planStep} disabled={s.line.sans.length === 0} />
      </div>
      <StepButtons onStep={planStep} disabled={s.line.sans.length === 0} />
      <div className={`drill-status ${statusClass}`}>
        {s.status === "loading" ? (
          <span className="muted">Setting up the position…</span>
        ) : s.status === "solving" ? (
          <>
            You play {p.color}. Nothing is hanging: what's the plan? Play the move that starts it.
            {s.hint && s.plan && <span className="status-extra muted">The circled piece starts it. Idea: {s.plan.title.toLowerCase()}.</span>}
          </>
        ) : s.status === "checking" ? (
          <span className="muted">{s.message}</span>
        ) : s.status === "done" ? (
          <strong>{s.message}</strong>
        ) : (
          <>
            <strong>{s.status === "wrong" ? "✗ " : s.status === "close" ? "≈ " : "✓ "}</strong>
            <SquareText text={s.message} at={start} />
            {s.facts.length > 0 && (
              <span className="status-extra">
                <SquareText text={`And it costs something: ${s.facts.join("; ")}.`} at={start} />
              </span>
            )}
            {p.gameMove !== s.played?.san && (
              <span className="status-extra muted">
                <SquareText text={`In the game you played ${moveText(p.gameMove, p.color)}.`} at={start} />
              </span>
            )}
          </>
        )}
      </div>
      {done && s.plan && !s.ideas && (
        <section className="opening-plan" aria-label="The plan">
          <div className="opening-plan-head">
            <strong>The engine's plan</strong>
          </div>
          <div className="opening-plan-title">{s.plan.title}</div>
          <p>
            <SquareText text={s.plan.text} at={start} />
          </p>
          {s.mine && s.status === "wrong" && (
            <p className="muted small">
              <SquareText text={`Yours: ${s.mine.title.toLowerCase()}. ${s.mine.text}`} at={start} />
            </p>
          )}
        </section>
      )}
      {s.ideas && <PlanCard plan={s.ideas} index={s.ideaIndex} onIndex={setPlanIdea} at={start} heading="The coach on the plan" />}
      <div className="controls">
        {s.status === "solving" && (
          <button onClick={planHint} disabled={s.hint || !s.best}>
            Hint
          </button>
        )}
        {done && (
          <>
            <button className="primary" onClick={() => nextPlan()}>
              Next position
            </button>
            <button onClick={retryPlan}>Try again</button>
            {!s.ideas && (
              <button onClick={explainPlan} disabled={s.explaining} title="One question to the coach">
                {s.explaining ? "The coach is thinking…" : "Explain the plan"}
              </button>
            )}
          </>
        )}
        {s.status === "done" && <button onClick={stopPlans}>Back to the list</button>}
        {signedIn && !locked && s.status !== "done" && (
          <button onClick={() => sendToCoach(planQuestion())} disabled={busy} title="One message to the coach">
            Ask the coach
          </button>
        )}
      </div>
    </main>
  );
}
