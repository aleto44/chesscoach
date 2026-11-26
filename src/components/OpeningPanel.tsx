import { useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { viewedPly } from "../chess/view";
import { lastMoveContext } from "../chess/line";
import {
  explainOpening,
  openingHint,
  openingMove,
  openingPlan,
  openingSetOf,
  openingStep,
  openingTakeBack,
  closeStructure,
  openStructure,
  retryOpening,
  shownNote,
  startOpening,
  stopOpening,
  useOpening,
} from "../openings/session";
import { pickLine, shortName } from "../openings/training";
import { canExplain, evalText } from "../openings/explain";
import { useTrainerChat } from "../coach/trainerChat";
import type { OffLineWhy } from "../openings/session";
import { Board } from "./Board";
import { SquareText } from "./SquareText";
import { planShapes, type PlanIdea } from "../openings/plans";
import { BoardSteps, StepButtons } from "./StepButtons";
import { patternAt, structureById, structuresAt } from "../openings/structures";

/** Replaces the game board while an opening line is being trained. */
export function OpeningPanel() {
  const s = useOpening()!;
  // A rated game in progress keeps the coach off, wherever the student is.
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
  // Off the line, once asked: the coach's "why" in the same shape, drawn on the position before the move.
  const whyIdeas = !past && s.status === "off" ? (s.why?.ideas ?? null) : null;
  const len = s.line.sans.length;
  // Off the line after missing a tactic the position had (the fork trick): that's the lesson, before any "why".
  const missed =
    !past && s.status === "off" && s.why && !whyIdeas
      ? patternAt(s.line.fens[len - 1], set.color)
      : null;
  // The structure the board turned into (a Pirc, Bc4 in the Pirc...), while playing on.
  const structure =
    !past && !plan && !whyIdeas && !missed && s.structure
      ? structureById(s.structure)
      : null;
  const cards = plan ?? whyIdeas ?? missed?.ideas ?? structure?.ideas ?? null;
  // The structures here whose card isn't open: a button each, to read them again.
  const others = past
    ? []
    : structuresAt(s.line.fens[len], set.color).filter(
        (x) => x.id !== structure?.id,
      );
  const [ideaIndex, setIdeaIndex] = useState(0);
  useEffect(
    () => setIdeaIndex(0),
    [s.line, s.target, whyIdeas, s.structure, missed?.id],
  );
  const idea = cards?.[Math.min(ideaIndex, cards.length - 1)] ?? null;
  const ideaShapes = useMemo(() => (idea ? planShapes(idea) : null), [idea]);
  // Messages speak about the latest moves; a move they name is placed on the position it's played from.
  const said = lastMoveContext(s.line);
  // Deeper lines have a note on what to think about before each of the student's moves (guides.ts),
  // shown when asked for (Hint) or after a wrong move, never up front: finding the idea is the exercise.
  // While the opponent's mistake or detour is on the board, Hint shows what it's about instead.
  const note = past || whyIdeas || missed ? null : shownNote(s);
  // Once a mistake is punished (or missed): why it lost, its moves read from the position before it.
  const trap = s.blunder;
  const trapWhy = !past && over && trap?.note ? trap.note.why : null;
  const trapPlayed = useMemo(() => ({ fens: s.line.fens, sans: s.line.sans }), [s.line]);
  const noteShapes = useMemo(
    () =>
      note ? planShapes({ title: "", text: note.text, draw: note.draw }) : [],
    [note?.text],
  );
  const boardShapes = useMemo(
    () => [...shapes, ...noteShapes],
    [shapes, noteShapes],
  );

  return (
    <main className="board-panel drills tall-status">
      {/* A wide panel puts the status and cards beside the board (.drill-body, .trainer-feedback). */}
      <div className="drill-body">
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
            fen={s.line.fens[whyIdeas || missed ? len - 1 : ply]}
            lastMove={
              whyIdeas || missed
                ? s.line.lastMoves[len - 2]
                : ply > 0
                  ? s.line.lastMoves[ply - 1]
                  : undefined
            }
            orientation={set.color}
            onMove={openingMove}
            canMove={s.status === "playing" && !past}
            premoveColor={!over && !past ? set.color : undefined}
            shapes={past ? undefined : (ideaShapes ?? boardShapes)}
          />
          <BoardSteps
            onStep={openingStep}
            disabled={s.line.sans.length === 0}
          />
        </div>
        <StepButtons onStep={openingStep} disabled={s.line.sans.length === 0} />
        <div className="trainer-feedback">
          <div
            className={`drill-status ${close ? "solving" : s.status === "off" ? "wrong" : s.status === "done" ? "right" : "solving"}`}
          >
            {past && !over ? (
              <>
                <strong>Looking back.</strong> Step forward (▶ or ⏭) to play on.
              </>
            ) : over ? (
              <>
                <strong>
                  {close ? "≈ " : s.status === "off" ? "✗ " : "✓ "}
                </strong>
                <SquareText text={s.message} {...said} />
                {s.status === "off" && s.why?.evals && (
                  <WhyEvals why={s.why} at={said.at} />
                )}
                {trapWhy && trap && (
                  <span className="opening-note">
                    <strong>Why: </strong>
                    <SquareText
                      text={trapWhy}
                      at={s.line.fens[trap.at - 1]}
                      now={s.line.fens[trap.at]}
                      played={trapPlayed}
                    />
                  </span>
                )}
                {note && (
                  <span className="opening-note">
                    <strong>Think: </strong>
                    <SquareText text={note.text} {...said} />
                  </span>
                )}
              </>
            ) : (
              <>
                You play {set.color}. Move{" "}
                {Math.min(s.line.sans.length, s.target.moves.length)} of{" "}
                {s.target.moves.length} in the line.
                {s.message && (
                  <span className="muted">
                    {" "}
                    <SquareText text={s.message} {...said} />
                  </span>
                )}
                {note && (
                  <span className="opening-note">
                    <strong>Think: </strong>
                    <SquareText text={note.text} {...said} />
                  </span>
                )}
              </>
            )}
          </div>
          {plan && idea && !past && (
            <PlanCard
              plan={plan}
              index={plan.indexOf(idea)}
              onIndex={setIdeaIndex}
              at={s.line.fens[s.line.sans.length]}
              played={s.line}
            />
          )}
          {whyIdeas && idea && s.why && (
            <PlanCard
              heading={`Why ${s.why.book}, not ${s.why.played}`}
              plan={whyIdeas}
              index={whyIdeas.indexOf(idea)}
              onIndex={setIdeaIndex}
              at={s.line.fens[len - 1]}
            />
          )}
          {missed && idea && (
            <PlanCard
              heading={`Missed: ${missed.name.toLowerCase()}`}
              plan={missed.ideas}
              index={missed.ideas.indexOf(idea)}
              onIndex={setIdeaIndex}
              at={s.line.fens[len - 1]}
            />
          )}
          {structure && idea && (
            <PlanCard
              heading={structure.name}
              plan={structure.ideas}
              index={structure.ideas.indexOf(idea)}
              onIndex={setIdeaIndex}
              at={s.line.fens[len]}
              played={s.line}
              onClose={closeStructure}
            />
          )}
          {others.length > 0 && (
            <div className="structure-chips">
              {others.map((x) => (
                <button
                  key={x.id}
                  className={
                    s.structuresNew?.includes(x.id) ? "new" : undefined
                  }
                  onClick={() => openStructure(x.id)}
                  title="What this structure is about"
                >
                  {x.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="controls">
          {s.status === "off" ? (
            <>
              <button className="primary" onClick={openingTakeBack}>
                Take back
              </button>
              <button onClick={retryOpening}>Start over</button>
              {s.why && (!s.why.asked || s.why.loading) && canExplain() && (
                <button
                  onClick={explainOpening}
                  disabled={explaining || s.why.loading}
                  title="The coach explains, with drawings on the board"
                >
                  {s.why.loading
                    ? "Thinking…"
                    : close
                      ? "Why the book move?"
                      : `Why not ${s.why.played}?`}
                </button>
              )}
            </>
          ) : s.status === "done" ? (
            <>
              <button
                className="primary"
                onClick={() => startOpening(set.id, pickLine(set, s.target))}
              >
                Another line
              </button>
              <button onClick={retryOpening}>Again</button>
            </>
          ) : (
            <button
              onClick={openingHint}
              disabled={s.status !== "playing" || past}
            >
              {note ? "Show the move" : "Hint"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

/** The plan at the end of a line: one idea at a time; the board shows that idea's drawings. */
export function PlanCard({
  plan,
  index,
  onIndex,
  at,
  heading = "What you're playing for",
  played,
  onClose,
}: {
  plan: PlanIdea[];
  index: number;
  onIndex: (i: number) => void;
  at: string;
  heading?: string;
  /** The line the plan looks back on: the moves it names show where they were played. */
  played?: { fens: string[]; sans: string[] };
  /** A card the student can put away (the structure cards). */
  onClose?: () => void;
}) {
  const idea = plan[index];
  return (
    <section className="opening-plan" aria-label={heading}>
      <div className="opening-plan-head">
        <strong>
          <SquareText text={heading} at={at} />
        </strong>
        <span className="spacer" />
        {plan.length > 1 && (
          <span className="opening-plan-nav">
            <button
              onClick={() => onIndex(index - 1)}
              disabled={index === 0}
              aria-label="Previous idea"
            >
              ‹
            </button>
            <span className="muted small">
              {index + 1} of {plan.length}
            </span>
            <button
              onClick={() => onIndex(index + 1)}
              disabled={index === plan.length - 1}
              aria-label="Next idea"
            >
              ›
            </button>
          </span>
        )}
        {onClose && (
          <button
            className="opening-plan-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <div className="opening-plan-title">{idea.title}</div>
      <p>
        <SquareText text={idea.text} at={at} game={played} played={played} />
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
