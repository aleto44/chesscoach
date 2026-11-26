import { useEffect, useMemo } from "react";
import type { DrawShape } from "chessground/draw";
import { viewedPly } from "../chess/view";
import { openingMove, openingStep, stopOpening, useOpening } from "../openings/session";
import { COURSE_NEXT_MS, courseHint, courseNext, courseNode, courseRetry, hintSteps, LEARN_NEXT_MS, learning, numbered, startCourse, type CourseRun } from "../openings/courseSession";
import { memoOf, useMemoLoading, type CourseMemo } from "../openings/courseMemo";
import { CueFrame } from "./PuzzlePanel";
import { courseById, fenOf, pitfallShare, pitfallsOf, reviewRun, chapterOf } from "../openings/course";
import type { CourseNode } from "../openings/courseTypes";
import { dueText, KNOWN_BOX, STRUGGLE_MISSES, type Pitfall } from "../openings/progress";
import { planShapes } from "../openings/plans";
import { evalText } from "../openings/explain";
import { settingRating, useSettings } from "../settings";
import { START_RATING } from "../rating";
import { Board } from "./Board";
import { SquareText } from "./SquareText";
import { BoardSteps, StepButtons } from "./StepButtons";

const pct = (x: number) => `${Math.max(1, Math.round(x * 100))}%`;
/** "..." before a Black move, so "...e5" reads as Black's. */
const moveNo = (fen: string) => (fen.split(" ")[1] === "b" ? "..." : "");

/**
 * Enter or Space moves on once a decision is answered (Next, or Finish), so a student who knows it
 * doesn't wait for the auto-advance or reach for the mouse. Not while typing in a field.
 */
function useNextKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if ((e.target as HTMLElement).closest("textarea, input, select, button")) return;
      const s = useOpening.getState();
      if (!s?.course || s.course.over || s.status !== "done") return;
      e.preventDefault();
      courseNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** The opening course on the board: one decision at a time (openings/courseSession.ts). */
export function CoursePanel() {
  useNextKey();
  const s = useOpening()!;
  const run = s.course!;
  const course = courseById(run.courseId)!;
  const node = courseNode(run);
  const rating = useSettings((st) => settingRating(st, "rapid") ?? START_RATING);
  const progress = useSettings((st) => st.openingCourse);
  const memos = useSettings((st) => st.openingCourseMemos);
  const memoLoading = useMemoLoading((st) => (node ? st.ids.includes(node.id) : false));
  const ply = viewedPly(s.line.sans.length, s.view);
  const past = ply < s.line.sans.length;
  const teach = learning(run);
  const answered = s.status === "done" || s.status === "off";
  const pathLen = node ? node.path.split(" ").length : 0;
  const atNode = s.line.sans.length === pathLen;
  // The idea's drawings: while it's taught, and once it's answered right. A miss shows the answer's arrow instead.
  const ideaShapes = useMemo(() => (node ? planShapes({ title: "", text: "", draw: node.draw }) : []), [node]);
  // The closer look's "what to look for", drawn while it's the hint on show (before the arrow).
  const memoIdea = node ? memoOf(node.id, memos)?.ideas[0] : undefined;
  const lookShapes = useMemo(() => (memoIdea ? planShapes(memoIdea) : []), [memoIdea]);
  const looking = !teach && s.status === "playing" && atNode && run.hints === 2 && hintSteps(run) === 3;
  const shapes = useMemo(() => {
    if (past || run.caught || run.over) return undefined;
    if ((teach && s.status === "playing" && atNode) || s.status === "done") return [...ideaShapes, ...(s.shapes as DrawShape[])];
    if (looking) return [...lookShapes, ...(s.shapes as DrawShape[])];
    return s.shapes as DrawShape[];
  }, [past, run.caught, run.over, teach, s.status, atNode, ideaShapes, s.shapes, looking, lookShapes]);

  if (!node) return null;
  const nodeFen = fenOf(node);
  // Texts speak from the decision's position; numbered moves are found on the board's line.
  const ctx = { at: nodeFen, game: s.line, played: s.line };
  const chapter = chapterOf(course, node.id);
  const pits = pitfallsOf(node, rating).slice(0, 3);
  const showCard = teach || answered;
  const due = reviewRun(course, progress).length;
  const memo = memoOf(node.id, memos);
  const wrong = progress[node.id]?.wrong ?? 0;

  return (
    <main className="board-panel drills tall-status">
      <div className="drill-body">
        <div className="game-bar">
          <span className="game-status">
            <strong>Opening course</strong>
            <span className="muted"> · {course.name}</span>
          </span>
          <span className="spacer" />
          <button onClick={stopOpening}>‹ Course</button>
        </div>
        <div className="crumbs">
          <span className="crumb">{run.over ? "Done" : `${Math.min(run.index + 1, run.items.length)} of ${run.items.length}`}</span>
          {showCard && chapter && <span className="crumb">{chapter.name}</span>}
          {showCard && <span className="crumb current">{node.title}</span>}
        </div>
        <CueFrame
          frameClass="drill"
          burst={false}
          status={s.status === "off" ? "failed" : s.status === "done" && run.first !== "wrong" && !run.over ? "solved" : s.status}
          orientation={course.color}
          fen={s.line.fens[ply]}
          rating={null}
          after={<BoardSteps onStep={openingStep} disabled={s.line.sans.length === 0} />}
        >
          <Board
            fen={s.line.fens[ply]}
            lastMove={ply > 0 ? s.line.lastMoves[ply - 1] : undefined}
            orientation={course.color}
            onMove={openingMove}
            canMove={s.status === "playing" && !past && !run.over}
            premoveColor={s.status === "playing" && !past ? course.color : undefined}
            shapes={shapes}
          />
        </CueFrame>
        <StepButtons onStep={openingStep} disabled={s.line.sans.length === 0} />
        <div className="trainer-feedback">
          {run.over ? (
            <div className="drill-status right">
              <strong>Run finished.</strong> {run.tally.right + run.tally.wrong > 0
                ? `Right first time: ${run.tally.right} of ${run.tally.right + run.tally.wrong}.`
                : "Everything here is learned: it comes back to be answered from memory."}
              {run.tally.wrong > 0 && <span className="status-extra muted">The ones you missed come back sooner.</span>}
              <NextReview run={run} />
            </div>
          ) : (
            <div className={`drill-status ${s.status === "off" ? "wrong" : s.status === "done" ? "right" : "solving"}`}>
              <Status node={node} ctx={ctx} pathLen={pathLen} past={past} memo={memo} />
            </div>
          )}
          {!run.over && showCard && (
            <section className="opening-plan course-card" aria-label={node.title}>
              <div className="opening-plan-head">
                <strong>{teach && s.status === "playing" ? "New: " : ""}{node.title}</strong>
                {node.kind === "punish" && <span className="course-kind punish">Punish</span>}
              </div>
              <p className="course-recognize">
                <SquareText text={node.recognize} {...ctx} />
              </p>
              <p>
                <SquareText text={node.why} {...ctx} />
              </p>
              {memo ? (
                <MemoNote memo={memo} wrong={wrong} ctx={ctx} />
              ) : (
                memoLoading &&
                wrong >= STRUGGLE_MISSES && (
                  <p className="course-memo muted small">
                    You've missed this one {wrong} times: the coach is writing a closer look at what to spot here, for next time.
                  </p>
                )
              )}
              {pits.length > 0 && <WatchOut node={node} pits={pits} rating={rating} ctx={ctx} />}
              {node.watch && !pits.some((p) => p.san === node.watch!.move) && (
                <p className="course-watch">
                  <strong>⚠ Watch out: </strong>
                  <SquareText text={node.watch.text} {...ctx} />
                </p>
              )}
            </section>
          )}
        </div>
        <div className="controls">
          {run.over ? (
            <>
              {due > 0 && (
                <button className="primary" onClick={() => startCourse(course.id, reviewRun(course, progress))}>
                  Review what's due ({due})
                </button>
              )}
              <button className={due > 0 ? "" : "primary"} onClick={stopOpening}>
                Back to the course
              </button>
            </>
          ) : s.status === "off" ? (
            <>
              <button className="primary" onClick={courseRetry}>
                Try again
              </button>
              <button onClick={courseNext}>Next ›</button>
            </>
          ) : s.status === "done" ? (
            <NextButton run={run} />
          ) : teach ? null : (
            <button onClick={courseHint} disabled={s.status !== "playing" || past}>
              {run.hints === 0 ? "Hint" : run.hints + 1 < hintSteps(run) ? "What to look for" : "Show the move"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

/** When this run's moves come up again, and how many are green: so finishing a run doesn't look like nothing happened. */
function NextReview({ run }: { run: CourseRun }) {
  const progress = useSettings((st) => st.openingCourse);
  const ids = [...new Set(run.items.map((it) => it.id))];
  const ps = ids.map((id) => progress[id]).filter(Boolean);
  if (!ps.length) return null;
  const known = ps.filter((p) => p.box >= KNOWN_BOX).length;
  const next = ps.filter((p) => p.box < KNOWN_BOX).sort((a, b) => a.due - b.due)[0];
  return (
    <span className="status-extra muted">
      {known} of {ids.length} known (green after {KNOWN_BOX} right reviews spread over days)
      {next ? `. Next review ${dueText(next)}.` : "."}
    </span>
  );
}

/** Next, filling up while a right answer waits to move on by itself (as a solved puzzle's does); a click goes at once. */
function NextButton({ run }: { run: CourseRun }) {
  const wait = learning(run) ? LEARN_NEXT_MS : COURSE_NEXT_MS;
  const at = run.autoNextAt;
  const elapsed = at ? Math.min(wait, wait - (at - Date.now())) : 0;
  return (
    <button className="primary next-btn" onClick={courseNext}>
      {at && <span key={at} className="next-fill" style={{ animationDuration: `${wait}ms`, animationDelay: `${-elapsed}ms` }} />}
      <span className="next-label">{run.index + 1 >= run.items.length ? "Finish" : "Next ›"}</span>
    </button>
  );
}

/** What's going on, in a sentence: the prompt, the verdict, or what the pitfall cost. */
function Status({ node, ctx, pathLen, past, memo }: { node: CourseNode; ctx: { at: string; game: { fens: string[]; sans: string[] }; played: { fens: string[]; sans: string[] } }; pathLen: number; past: boolean; memo: CourseMemo | null }) {
  const s = useOpening()!;
  const run = s.course!;
  const line = s.line;
  const k = line.sans.length - pathLen;
  const path = (
    <span className="status-extra muted small">
      <SquareText text={numbered(line, 0, pathLen)} {...ctx} />
    </span>
  );
  if (past && s.status === "playing")
    return (
      <>
        <strong>Looking back.</strong> Step forward (▶ or ⏭) to play on.
      </>
    );
  if (run.caught) {
    const c = run.caught;
    const refute = numbered(line, pathLen, line.sans.length - pathLen);
    return (
      <>
        <strong>{s.status === "off" ? "✗ Caught. " : "Watch what happens… "}</strong>
        <SquareText text={`${refute}`} {...ctx} />
        {s.status === "off" && (
          <span className="status-extra">
            {c.share > 0 ? `${pct(c.share)} of players at your level play ${moveNo(ctx.at)}${c.san} here. ` : ""}
            It leaves you {evalText(c.eval)}; <SquareText text={node.answer} at={ctx.at} /> keeps you {evalText(c.answerEval)}.
          </span>
        )}
      </>
    );
  }
  if (s.status === "off" && run.evals)
    return (
      <>
        <strong>✗ </strong>
        <SquareText text={run.other ?? ""} at={ctx.at} /> costs something here: {evalText(run.evals.played)} against {evalText(run.evals.answer)} for{" "}
        <SquareText text={node.answer} at={ctx.at} />. The arrow shows it.
      </>
    );
  if (s.status === "done") {
    const verdict = learning(run)
      ? "Learned. It comes back in a moment, from memory."
      : run.other
        ? null
        : run.items[run.index]?.probe && run.first === "right"
          ? "Right: you know this one, it's marked known."
          : run.first === "hinted"
          ? "Right, with a hint: it comes back soon."
          : run.first === "wrong"
            ? "That's it. Missed the first time, so it comes back at the end."
            : "Right.";
    return (
      <>
        <strong>{run.other ? "≈ " : "✓ "}</strong>
        {verdict ?? (
          <>
            <SquareText text={run.other!} at={ctx.at} /> is good too. The course plays <SquareText text={node.answer} at={ctx.at} />
            {run.first === "hinted" ? ": it comes back soon, so that one sticks." : ", and the idea is the same."}
          </>
        )}
        {path}
      </>
    );
  }
  if (s.status === "thinking") return <>{s.message ? <SquareText text={s.message} {...ctx} /> : "…"}</>;
  // Playing: the prompt.
  const last = numbered(line, pathLen - 1, 1);
  return (
    <>
      {learning(run) ? (
        <>
          Play <strong><SquareText text={node.answer} at={ctx.at} /></strong> on the board, after <SquareText text={last} {...ctx} />.
        </>
      ) : k > 0 ? (
        <>Keep going: there's more to it.</>
      ) : (
        <>
          After <strong><SquareText text={last} {...ctx} /></strong>, your move.
        </>
      )}
      {s.message && (
        <span className="status-extra">
          <SquareText text={s.message} {...ctx} />
        </span>
      )}
      {!learning(run) && run.hints > 0 && k === 0 && (
        <span className="opening-note">
          <strong>Think: </strong>
          <SquareText text={node.recognize} {...ctx} />
        </span>
      )}
      {!learning(run) && memo && run.hints >= 2 && k === 0 && (
        <span className="opening-note course-memo-hint">
          <strong>Look for: </strong>
          <SquareText text={memo.ideas[0].text} {...ctx} />
        </span>
      )}
      {path}
    </>
  );
}

/** The moves players at the student's level really make here that lose, each with what it costs (hover a line to see it). */
function WatchOut({ node, pits, rating, ctx }: { node: CourseNode; pits: Pitfall[]; rating: number; ctx: { at: string } }) {
  return (
    <div className="course-watch">
      <strong>⚠ Don't get caught</strong>
      <ul>
        {pits.map((p) => (
          <li key={p.san}>
            <SquareText text={`${moveNo(ctx.at)}${p.san}? ${p.refute.join(" ")}`} at={ctx.at} />{" "}
            <span className="muted small">
              ({pitfallShare(p, rating) > 0 ? `${pct(pitfallShare(p, rating))} at your level, ` : ""}
              {evalText(p.eval)} for you)
            </span>
            {node.watch?.move === p.san && (
              <div className="small">
                <SquareText text={node.watch.text} at={ctx.at} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The coach's closer look at a decision the student keeps missing (courseMemo.ts): what to spot,
 * and how to remember it. Hover an idea to see its drawings on the board.
 */
function MemoNote({ memo, wrong, ctx }: { memo: CourseMemo; wrong: number; ctx: { at: string } }) {
  return (
    <div className="course-memo">
      <strong>🔎 A closer look</strong> <span className="muted small">(missed {wrong} times)</span>
      {memo.ideas.map((idea) => (
        <p key={idea.title}>
          <strong>{idea.title}. </strong>
          <SquareText text={idea.text} {...ctx} />
        </p>
      ))}
    </div>
  );
}
