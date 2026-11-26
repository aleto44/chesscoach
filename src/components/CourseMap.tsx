import { useState } from "react";
import type { Course, CourseChapter } from "../openings/courseTypes";
import { chapterRun, counts, dangerRun, isDanger, LEARN_BATCH, learnRun, reviewRun, testOutRun } from "../openings/course";
import { dueText, isDue, KNOWN_BOX, masteryOf, stageText } from "../openings/progress";
import { startCourse } from "../openings/courseSession";
import { settingRating, useSettings } from "../settings";
import { START_RATING } from "../rating";

/**
 * An opening course as a map: White's setups one card each, every decision a dot coloured by how
 * well the student knows it, and the ways to study: what's due, the next new ones, or only the
 * decisions with a pitfall to get caught by.
 */
export function CourseMap({ course }: { course: Course }) {
  const progress = useSettings((s) => s.openingCourse);
  const rating = useSettings((s) => settingRating(s, "rapid") ?? START_RATING);
  const c = counts(course, progress);
  const due = reviewRun(course, progress);
  const fresh = learnRun(course, progress);
  const danger = course.chapters.flatMap((ch) => ch.nodes).filter((n) => isDanger(n, rating)).length;
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="course-map">
      <p className="opening-mode-help muted">{course.intro}</p>
      <div className="course-summary">
        <div className="course-bar" aria-label={`${c.known} of ${c.total} known`}>
          <span className="known" style={{ flexGrow: c.known }} />
          <span className="learning" style={{ flexGrow: c.learning }} />
          <span className="fresh" style={{ flexGrow: c.fresh }} />
        </div>
        <span className="muted small">
          {c.known} known · {c.learning} learning · {c.fresh} new
        </span>
      </div>
      <p className="course-legend muted small">
        <span className="course-dot new" /> new <span className="course-dot learning" /> learning <span className="course-dot known" /> known. A move
        turns green after {KNOWN_BOX} right answers on separate reviews, spread out (10 minutes, a day, 3 days): that's
        what shows it's stuck. Answering it again before it's due counts, but doesn't move it on.
      </p>
      <div className="opening-start">
        <button className={due.length ? "primary" : ""} disabled={!due.length} onClick={() => startCourse(course.id, due)}>
          {due.length ? `▶ Review due (${due.length})` : "Nothing due"}
        </button>
        <button className={due.length ? "" : "primary"} disabled={!fresh.length} onClick={() => startCourse(course.id, fresh)}>
          {fresh.length ? `Learn ${Math.min(LEARN_BATCH, c.fresh)} new` : "All learned"}
        </button>
        <button
          disabled={c.known === c.total}
          onClick={() => startCourse(course.id, testOutRun(course, progress))}
          title="Already play some of this? Every move you get right first time is marked known; only the misses get taught"
        >
          Test what I know
        </button>
        <button disabled={!danger} onClick={() => startCourse(course.id, dangerRun(course, progress, rating))} title="The moments where the natural move loses: find the safe one">
          ⚠ Don't get caught ({danger})
        </button>
      </div>
      <div className="course-chapters">
        {course.chapters.map((ch) => (
          <ChapterCard key={ch.id} course={course} chapter={ch} open={open === ch.id} onToggle={() => setOpen(open === ch.id ? null : ch.id)} rating={rating} />
        ))}
      </div>
    </div>
  );
}

function ChapterCard({ course, chapter, open, onToggle, rating }: { course: Course; chapter: CourseChapter; open: boolean; onToggle: () => void; rating: number }) {
  const progress = useSettings((s) => s.openingCourse);
  const known = chapter.nodes.filter((n) => masteryOf(progress[n.id]) === "known").length;
  const fresh = chapter.nodes.filter((n) => !progress[n.id]).length;
  const learning = chapter.nodes.filter((n) => masteryOf(progress[n.id]) === "learning");
  // The soonest a learning move comes up again: "next review in 8 minutes".
  const soonest = learning.map((n) => progress[n.id]).sort((a, b) => a.due - b.due)[0];
  return (
    <section className={`course-chapter ${open ? "open" : ""}`}>
      <button className="course-chapter-head" onClick={onToggle} aria-expanded={open}>
        <span className="course-chapter-name">{chapter.name}</span>
        <span className="muted small">
          {known}/{chapter.nodes.length} known
        </span>
      </button>
      {soonest && (
        <span className="muted small">
          {learning.length} learning · next review {dueText(soonest)}
        </span>
      )}
      <div className="course-dots" aria-hidden>
        {chapter.nodes.map((n) => (
          <span key={n.id} className={`course-dot ${masteryOf(progress[n.id])} ${isDue(progress[n.id]) ? "due" : ""}`} title={`${n.title}: ${stageText(progress[n.id])}`}>
            {n.kind === "punish" ? "⚔" : isDanger(n, rating) ? "!" : ""}
          </span>
        ))}
      </div>
      <p className="muted small course-blurb">{chapter.blurb}</p>
      <div className="course-chapter-actions">
        {fresh > 0 && (
          <button className="primary" onClick={() => startCourse(course.id, learnRun(course, progress, chapter.id))}>
            Learn {Math.min(LEARN_BATCH, fresh)} new
          </button>
        )}
        {known < chapter.nodes.length && (
          <button
            onClick={() => startCourse(course.id, testOutRun(course, progress, chapter.id))}
            title="Already play this? Right first time marks a move known; only the misses get taught"
          >
            Test out
          </button>
        )}
        <button onClick={() => startCourse(course.id, chapterRun(chapter, progress))}>Whole chapter</button>
      </div>
      {open && (
        <ol className="course-nodes">
          {chapter.nodes.map((n) => (
            <li key={n.id}>
              <button className="course-node" onClick={() => startCourse(course.id, [{ id: n.id, learn: !progress[n.id] }])}>
                <span className={`course-dot ${masteryOf(progress[n.id])}`} />
                <span className="course-node-title">
                  {n.title}
                  <span className="muted small course-node-stage">{stageText(progress[n.id])}</span>
                </span>
                {n.kind === "punish" ? <span className="course-kind punish">Punish</span> : isDanger(n, rating) ? <span className="course-kind danger">Trap here</span> : null}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
