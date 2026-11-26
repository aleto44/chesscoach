// What the student knows of each course decision, spaced like the drills: a decision answered right
// comes back later each time (a box further along), one answered wrong drops back to the start and
// comes again in this session. Kept in the settings table (setting `openingCourse`), so the computer
// and the phone share it. Each decision is saved on its own (db_course_progress, merged on the
// computer), so a phone studying offline queues its answers and sends them when it's back.
import { hasBackend } from "../backend";
import { orOffline } from "../offline";
import { useSettings } from "../settings";

/** A move players really make at a decision that loses (find-pitfalls.mjs writes these). */
export interface Pitfall {
  san: string;
  /** The student's eval after it, and after the course's answer (centipawns, mates as ±(10000 − distance)). */
  eval: number;
  answerEval: number;
  /** How likely a player of each rating band is to play it (0–1), where it's 4% or more. */
  p: Record<string, number>;
  /** The opponent's punishment, from the move after the pitfall, played out until the loss is on the board. */
  refute: string[];
}

export interface NodeProgress {
  /** 0 = learned, not yet answered from memory; each right answer moves it one box on. */
  box: number;
  /** When it's next due (ms since the epoch). */
  due: number;
  right: number;
  wrong: number;
  /** The wrong first moves the student played here, latest last (a few): what the closer look (courseMemo.ts) answers. */
  misses?: string[];
  /** When it was last answered (ms): where two devices answered it, the later one is kept. */
  at?: number;
}

/** After this many misses a decision gets the coach's closer look (courseMemo.ts). */
export const STRUGGLE_MISSES = 2;

/** How long a decision rests after a right answer, by the box it was in. */
const REST_MS = [10 * 60e3, 1 * 864e5, 3 * 864e5, 7 * 864e5, 16 * 864e5, 35 * 864e5, 90 * 864e5];
/** From this box on, a decision counts as known for the map. */
export const KNOWN_BOX = 3;

export type Mastery = "new" | "learning" | "known";

export const progressOf = (id: string): NodeProgress | undefined => useSettings.getState().openingCourse[id];

export function masteryOf(p: NodeProgress | undefined): Mastery {
  if (!p) return "new";
  return p.box >= KNOWN_BOX ? "known" : "learning";
}

export const isDue = (p: NodeProgress | undefined, now = Date.now()) => !!p && p.due <= now;

function save(id: string, p: NodeProgress) {
  const progress = { ...p, at: Date.now() };
  useSettings.setState((s) => ({ openingCourse: { ...s.openingCourse, [id]: progress } }));
  if (!hasBackend()) return;
  orOffline("db_course_progress", { id, progress }, () => undefined, true).catch((e) => console.error("saving course progress failed", e));
}

/** The decision was shown and played with the answer in view: it's due to be answered from memory soon. */
export function markLearned(id: string) {
  if (!progressOf(id)) save(id, { box: 0, due: Date.now(), right: 0, wrong: 0 });
}

/**
 * The student's first answer to the decision this run. A right answer moves it one box on only when
 * it was due: answering it again before then (a chapter run straight after learning it) proves
 * nothing new about memory, so it counts but doesn't move. "hinted": right with a hint, which keeps it
 * where it was and brings it back soon. A wrong one starts it over.
 */
export function grade(id: string, result: "right" | "hinted" | "wrong", played?: string) {
  const p = progressOf(id) ?? { box: 0, due: 0, right: 0, wrong: 0 };
  const now = Date.now();
  if (result === "right" && !isDue(p, now)) save(id, { ...p, right: p.right + 1 });
  else if (result === "right") save(id, { ...p, box: p.box + 1, due: now + REST_MS[Math.min(p.box, REST_MS.length - 1)], right: p.right + 1 });
  else if (result === "hinted") save(id, { ...p, due: Math.min(p.due || Infinity, now + REST_MS[0]), right: p.right });
  else save(id, { ...p, box: 0, due: now, wrong: p.wrong + 1, misses: played ? [...(p.misses ?? []), played].slice(-5) : p.misses });
}

/**
 * Answered right from cold, before it was ever taught (a test-out run): the student already knows it,
 * so it starts as known instead of working up the boxes. It's still checked again in a week.
 */
export function testOut(id: string) {
  const p = progressOf(id);
  if (p && p.box >= KNOWN_BOX) return;
  save(id, { box: KNOWN_BOX, due: Date.now() + REST_MS[KNOWN_BOX], right: (p?.right ?? 0) + 1, wrong: p?.wrong ?? 0 });
}

/** "in 10 minutes", "tomorrow", "in 3 days": when a decision is next asked; "now" when it's due. */
export function dueText(p: NodeProgress, now = Date.now()): string {
  const ms = p.due - now;
  if (ms <= 0) return "now";
  const min = Math.ceil(ms / 60e3);
  if (min < 60) return `in ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(ms / 36e5);
  if (h < 20) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(ms / 864e5);
  return d <= 1 ? "tomorrow" : `in ${d} days`;
}

/** Where a decision stands, in words: "learning, 1 of 3 reviews, next tomorrow". */
export function stageText(p: NodeProgress | undefined, now = Date.now()): string {
  if (!p) return "new";
  if (p.box >= KNOWN_BOX) return `known, next check ${dueText(p, now)}`;
  return `learning: ${p.box} of ${KNOWN_BOX} reviews right, next ${dueText(p, now)}`;
}
