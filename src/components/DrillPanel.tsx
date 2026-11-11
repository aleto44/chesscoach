import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useState } from "react";
import { PIECE_NAMES, type PieceType } from "../chess/material";
import {
  drillHint,
  drillMove,
  drillQuestion,
  drillStep,
  drillTitle,
  gameMoveSan,
  lessonOf,
  nextDrill,
  quizReveal,
  quizTap,
  retireCurrent,
  startDrills,
  stopDrills,
  useDrill,
  type DrillState,
} from "../analysis/drillSession";
import { THEME_NAMES, type Explanation } from "../analysis/explain";
import { sendToCoach } from "../coach/bridge";
import { useAuth } from "../coach/auth";
import { hasBackend } from "../db";
import { useStore } from "../store";
import { Board } from "./Board";
import { BoardSteps, StepButtons } from "./StepButtons";
import { viewedPly } from "../chess/view";
import { formatMoves, lastMoveContext } from "../chess/line";
import { Modal } from "./GameDialogs";
import { SquareText } from "./SquareText";
import { WhyLines } from "./Why";

const KIND_LABEL = {
  mistake: "From your games",
  opening: "Repertoire",
  coach: "From the coach",
  puzzle: "Missed puzzle",
} as const;

/** Replaces the game board while a drill session runs. */
export function DrillPanel() {
  const s = useDrill()!;
  const busy = useStore((st) => st.busy);
  const signedIn = useAuth((a) => a.status === "signed-in") || !hasBackend();
  const drill = s.queue[s.index];
  const line = s.line;
  const ply = line ? viewedPly(line.sans.length, s.view) : 0;
  const past = line !== null && ply < line.sans.length;
  const shapes = useMemo(() => s.shapes as DrawShape[], [s.shapes]);
  // The attack quiz takes the board while it's open: the better move played, the student's finds circled.
  const quiz = s.status === "wrong" && s.quiz && !s.quiz.done ? s.quiz : null;
  const quizShapes = useMemo<DrawShape[]>(
    () =>
      quiz
        ? [
            ...quiz.found.map((k) => ({ orig: k, brush: "green" })),
            ...(quiz.miss ? [{ orig: quiz.miss, brush: "red" }] : []),
          ]
        : [],
    [quiz],
  );
  const [whyOpen, setWhyOpen] = useState(false);
  useEffect(() => setWhyOpen(false), [s.index]);
  const side = drill ? (drill.color === "white" ? "White" : "Black") : "";
  const opponent = drill ? (drill.color === "white" ? "Black" : "White") : "";
  const lead =
    s.lead && s.status !== "intro" ? (
      <span className="muted">
        {opponent} played <SquareText text={s.lead.label} at={line?.fens[0]} />
        .{" "}
      </span>
    ) : drill?.kind === "mistake" && drill.sourceGameId === null && s.status === "solving" ? (
      // The game was deleted (its drills keep their position, not the game): the move that led
      // here is gone with it, so say why the board starts without it.
      <span className="muted">
        {opponent}'s last move isn't known: the game this came from was deleted.{" "}
      </span>
    ) : null;

  return (
    <main className="board-panel drills">
      <div className="drill-body">
        <div className="game-bar">
          <span className="game-status">
            <strong>Drills</strong>
            {drill && (
              <span className="muted">
                {" "}
                · {s.index + 1} of {s.queue.length} · {KIND_LABEL[drill.kind]}
              </span>
            )}
          </span>
          <span className="spacer" />
          <button onClick={stopDrills}>‹ Drills menu</button>
        </div>

        <div className="crumbs">
          <span className="crumb current">
            {drill ? (
              // The student's move in their game, played from the drill's position.
              <SquareText text={drillTitle(drill)} at={line?.fens[s.base]} />
            ) : s.status === "loading" ? (
              "Drills"
            ) : (
              "No drills due"
            )}
          </span>
        </div>

        {drill && line ? (
          <>
            <div className="board-frame drill">
              {quiz ? (
                <Board
                  fen={quiz.fen}
                  lastMove={quiz.lastMove}
                  orientation={drill.color}
                  canMove={false}
                  shapes={quizShapes}
                  onSquare={quizTap}
                />
              ) : (
                <Board
                  fen={line.fens[ply]}
                  lastMove={ply > 0 ? line.lastMoves[ply - 1] : undefined}
                  orientation={drill.color}
                  onMove={drillMove}
                  canMove={s.status === "solving" && !past}
                  premoveColor={
                    (s.status === "intro" || s.status === "solving") && !past
                      ? drill.color
                      : undefined
                  }
                  shapes={past ? undefined : shapes}
                />
              )}
              <BoardSteps
                onStep={drillStep}
                disabled={line.sans.length === 0 || !!quiz}
              />
            </div>
            <StepButtons onStep={drillStep} disabled={line.sans.length === 0 || !!quiz} />
            <div className="drill-feedback">
              <div className={`drill-status ${s.status}`}>
                {s.status === "intro" && s.lead && (
                  <>
                    {opponent} plays{" "}
                    <SquareText text={s.lead.label} at={line.fens[0]} />…
                  </>
                )}
                {s.status === "loading" && "Setting up the next drill…"}
                {s.status === "solving" && past && (
                  <>
                    <strong>Looking back.</strong> Step forward (▶ or ⏭) to play
                    on.
                  </>
                )}
                {s.status === "solving" && !past && (
                  <>
                    {lead}
                    {drill.kind === "opening"
                      ? `Play your ${drill.color} repertoire from memory.`
                      : drill.kind === "puzzle"
                        ? `${side} to move. Find the winning line.`
                        : `${side} to move. Find a good move.`}
                    {/* What went wrong last time is part of the hint now: shown up front it gave the answer away. */}
                    {s.hint && (
                      <div className="drill-hint">
                        <strong>Hint:</strong>{" "}
                        <SquareText
                          text={s.hint}
                          at={line.fens[line.sans.length]}
                        />
                      </div>
                    )}
                  </>
                )}
                {s.status === "checking" && "Checking with the engine…"}
                {(s.status === "right" || s.status === "wrong") && (
                  <>
                    <strong>
                      {s.status === "wrong"
                        ? "✗ Not quite."
                        : s.hint
                          ? "✓ Right, with a hint (counts as missed)."
                          : "✓ Correct."}
                    </strong>{" "}
                    <SquareText text={s.message} {...lastMoveContext(line)} />
                    {s.nextDue && (
                      <span className="muted">
                        {" "}
                        Next review {formatDue(s.nextDue)}.
                      </span>
                    )}
                  </>
                )}
              </div>
              {s.status === "wrong" && s.quiz && <QuizPanel q={s.quiz} />}
              {s.status === "wrong" &&
                !quiz &&
                (drill.kind === "mistake" ||
                  drill.kind === "coach" ||
                  drill.kind === "puzzle") && (
                  <WhySummary s={s} onOpen={() => setWhyOpen(true)} />
                )}
              {s.status === "right" && gameMoveSan(drill) && (
                <WhySummary s={s} onOpen={() => setWhyOpen(true)} right />
              )}
            </div>
            {whyOpen && s.why && (
              <Modal
                title={`Why ${playedLabel(s)} isn't good`}
                onClose={() => setWhyOpen(false)}
                className="why-dialog"
              >
                <div className="why-stats">
                  <span>
                    Eval for you <strong>{s.why.evalBefore}</strong> →{" "}
                    <strong>{s.why.evalAfter}</strong>
                  </span>
                  <span>
                    Winning chances <strong>{s.why.winBefore}%</strong> →{" "}
                    <strong>{s.why.winAfter}%</strong>
                  </span>
                </div>
                <WhyLines
                  ex={s.why}
                  playedSan={playedSan(s)}
                  orientation={drill.color}
                />
              </Modal>
            )}
            <div className="controls">
              {s.status === "solving" && !past && !s.hint && (
                <button
                  onClick={drillHint}
                  title="Shows which piece to move. The drill counts as missed."
                >
                  Hint
                </button>
              )}
              {(s.status === "right" || s.status === "wrong") && (
                <>
                  <button className="primary" onClick={nextDrill}>
                    Next
                  </button>
                  {s.status === "wrong" && signedIn && (
                    <button
                      onClick={() => sendToCoach(drillQuestion())}
                      disabled={busy}
                      title="One message to the coach"
                    >
                      Ask the coach why
                    </button>
                  )}
                </>
              )}
              <span className="spacer" />
              <button
                onClick={retireCurrent}
                title="Don't show this drill again"
              >
                Retire drill
              </button>
            </div>
          </>
        ) : s.status === "loading" ? (
          <div className="drill-done">
            <p className="muted">Setting up your drills…</p>
          </div>
        ) : (
          <div className="drill-done">
            <p>
              {s.queue.length
                ? `Done: ${s.correct} of ${s.queue.length} correct.`
                : "Nothing is due right now. Drills come from mistakes in your analyzed games and from your repertoire."}
            </p>
            <div className="controls">
              <button onClick={() => startDrills(true)}>
                Practice all drills anyway
              </button>
              <button className="primary" onClick={stopDrills}>
                Back to drills
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/** "the queen on d3". */
function pieceOn(fen: string, sq: Key): string {
  const p = new Chess(fen).get(sq as Square);
  const name = !p ? "piece" : p.type === "k" ? "king" : PIECE_NAMES[p.type as PieceType];
  return `the ${name} on ${sq}`;
}

const andList = (xs: string[]) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? "");

const NUMBER_WORDS = ["", "one", "two", "three", "four"];

/** The attack quiz's question while it's open, and its answer once found or shown. */
function QuizPanel({ q }: { q: NonNullable<DrillState["quiz"]> }) {
  const n = q.targets.length;
  if (q.done) {
    const answer = `${q.san} attacks ${andList(q.targets.map((t) => pieceOn(q.fen, t)))}.`;
    return (
      <div className="drill-quiz done">
        <strong>{q.done === "found" ? "✓ Found them." : "Here they are:"}</strong>{" "}
        <SquareText text={answer} at={q.fen} />
      </div>
    );
  }
  const what = n === 1 ? "the piece it attacks" : `the ${NUMBER_WORDS[n] ?? n} pieces it attacks`;
  return (
    <div className="drill-quiz">
      <p>
        <strong>
          What does <SquareText text={q.san} at={q.fen} /> attack?
        </strong>{" "}
        Tap {what} on the board.
      </p>
      <p className="muted">
        {q.miss
          ? new Chess(q.fen).get(q.miss as Square)
            ? `Not ${pieceOn(q.fen, q.miss)}. Try again.`
            : `There's nothing on ${q.miss}. Try again.`
          : q.found.length
            ? `${q.found.length} of ${n} found.`
            : " "}
      </p>
      <button onClick={quizReveal}>Show me</button>
    </div>
  );
}

const playedSan = (s: DrillState) => s.line?.sans[s.base] ?? "";
/** "14.g5". */
const playedLabel = (s: DrillState) =>
  s.why?.played.steps[0]?.label ?? playedSan(s);

/**
 * Why the answer was wrong, in words: what the opponent does against it and what that comes to,
 * then what the better move does. The full lines open on their own board. `right`: the answer was
 * right, and this compares the move played in the game with it instead.
 */
function WhySummary({
  s,
  onOpen,
  right = false,
}: {
  s: DrillState;
  onOpen: () => void;
  right?: boolean;
}) {
  const ex: Explanation | null = s.why;
  if (!ex)
    return (
      <div className="drill-why muted">
        {s.whyFailed
          ? "The engine couldn't work out why."
          : right
            ? "Working out what your game move missed…"
            : "Working out why…"}
      </div>
    );
  const reply = ex.played.steps[1];
  const better = ex.better;
  // The drill's lesson (worked out when it was made): its themes, and the game move's story when
  // the answer given was a different wrong move.
  const lesson = lessonOf(s.queue[s.index]);
  const themes = (lesson ?? ex).themes ?? [];
  const game = lesson && !right && ex.played.steps[0]?.san !== lesson.played.steps[0]?.san ? lesson.played : null;
  // Text about a line names its moves by number ("By 37...Qxh4+"): they're found in the line itself.
  const playedLine = {
    fens: [ex.played.startFen, ...ex.played.steps.map((st) => st.fen)],
  };
  const betterLine = better && {
    fens: [better.startFen, ...better.steps.map((st) => st.fen)],
  };
  return (
    <div className="drill-why">
      {themes.length > 0 && (
        <p className="lesson-themes">
          <span className="muted">The lesson:</span> {themes.map((t) => THEME_NAMES[t]).join(" · ")}
        </p>
      )}
      <p className="bad">
        <strong>
          {right ? "In your game, " : "Why "}
          <SquareText
            text={ex.played.steps[0]?.san ?? playedSan(s)}
            at={ex.played.startFen}
          />
          {right ? ":" : " is bad:"}
        </strong>{" "}
        {/* The reply's note speaks from after the move played; the verdict names moves of the line. */}
        <SquareText
          text={`${reply ? `${reply.note} ` : ""}${ex.played.verdict}`}
          at={ex.played.steps[0]?.fen ?? ex.played.startFen}
          earlier={[ex.played.startFen]}
          game={playedLine}
        />
      </p>
      {ex.alternatives?.length > 1 ? (
        <p className="good">
          <strong>Better:</strong>{" "}
          <SquareText
            text={ex.betterSummary.replace(/ Pick one to see the reply\.$/, "")}
            at={ex.played.startFen}
          />
        </p>
      ) : (
        better && (
          <p className="good">
            <strong>
              Why{" "}
              <SquareText
                text={better.steps[0]?.san ?? ""}
                at={better.startFen}
              />{" "}
              {right ? "is good:" : "is better:"}
            </strong>{" "}
            <SquareText
              text={better.steps[0]?.note ?? ""}
              at={better.startFen}
            />
            {better.steps.length > 1 && (
              <span className="muted">
                {" "}
                (
                <SquareText
                  text={formatMoves({
                    fens: [
                      better.startFen,
                      ...better.steps.map((st) => st.fen),
                    ],
                    sans: better.steps.map((st) => st.san),
                  })}
                  at={better.startFen}
                />
                )
              </span>
            )}{" "}
            <SquareText
              text={better.verdict}
              at={better.startFen}
              game={betterLine ?? undefined}
            />
          </p>
        )
      )}
      {game && (
        <p className="bad">
          <strong>
            In your game, <SquareText text={game.steps[0]?.label ?? ""} at={game.startFen} />:
          </strong>{" "}
          <SquareText
            text={`${game.steps[1] ? `${game.steps[1].note} ` : ""}${game.verdict}`}
            at={game.steps[0]?.fen ?? game.startFen}
            earlier={[game.startFen]}
            game={{ fens: [game.startFen, ...game.steps.map((st) => st.fen)] }}
          />
        </p>
      )}
      <button className="why-button" onClick={onOpen}>
        Step through both lines on a board ›
      </button>
    </div>
  );
}

function formatDue(sqlite: string): string {
  const due = new Date(sqlite.replace(" ", "T") + "Z");
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
