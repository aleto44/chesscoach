// The opening courses at runtime: their decisions, where each one stands for the student, and the
// pitfalls a player of the student's rating falls into there (pitfalls.ts).
import { Chess } from "chess.js";
import type { Course, CourseChapter, CourseNode } from "./courseTypes";
import { COURSES as ALL } from "./courses";
import { PITFALLS } from "./pitfalls";
import { isDue, masteryOf, type Mastery, type NodeProgress, type Pitfall } from "./progress";
import { positionKey } from "./blunders";

export const COURSES: Course[] = ALL;

/** The course of a training set (training.ts), if it has one. */
export const courseForSet = (setId: string) => COURSES.find((c) => c.setId === setId) ?? null;
export const courseById = (id: string) => COURSES.find((c) => c.id === id) ?? null;

export const nodesOf = (course: Course) => course.chapters.flatMap((ch) => ch.nodes);

export function nodeById(course: Course, id: string): CourseNode | null {
  for (const ch of course.chapters) for (const n of ch.nodes) if (n.id === id) return n;
  return null;
}

export const chapterOf = (course: Course, id: string): CourseChapter | null => course.chapters.find((ch) => ch.nodes.some((n) => n.id === id)) ?? null;

const fens = new Map<string, string>();
/** The position of a decision (the student to move). */
export function fenOf(node: CourseNode): string {
  let fen = fens.get(node.id);
  if (!fen) {
    const chess = new Chess();
    for (const m of node.path.split(" ")) chess.move(m);
    fen = chess.fen();
    fens.set(node.id, fen);
  }
  return fen;
}

/** The ratings find-pitfalls.mjs works pitfalls out for (chess.com scale). */
const BANDS = [800, 1000, 1200, 1400, 1600, 1800, 2000];
/** A pitfall shows for a rating when at least this share of players there fall into it. */
const MIN_P = 0.04;
const bandOf = (rating: number) => String(BANDS.reduce((a, b) => (Math.abs(b - rating) < Math.abs(a - rating) ? b : a)));

/** How often players of `rating` play the pitfall (0–1). */
export const pitfallShare = (p: Pitfall, rating: number) => p.p[bandOf(rating)] ?? 0;

/**
 * The moves that lose at this decision, for a player of `rating`: the ones players there really make,
 * likeliest first, and the course's own watch move (which may not be common, but is the one to know).
 */
export function pitfallsOf(node: CourseNode, rating: number): Pitfall[] {
  const all = PITFALLS[positionKey(fenOf(node))] ?? [];
  const common = all.filter((p) => pitfallShare(p, rating) >= MIN_P).sort((a, b) => pitfallShare(b, rating) - pitfallShare(a, rating));
  const watch = node.watch && all.find((p) => p.san === node.watch!.move);
  return watch && !common.includes(watch) ? [watch, ...common] : common;
}

/** Any stored pitfall at this decision for this move, common or not (a student who plays it gets shown what happens). */
export const pitfallFor = (node: CourseNode, san: string): Pitfall | null =>
  (PITFALLS[positionKey(fenOf(node))] ?? []).find((p) => p.san === san) ?? null;

/** Decisions with something to get caught by: a watch move, or a pitfall players of `rating` fall into. */
export const isDanger = (node: CourseNode, rating: number) => !!node.watch || pitfallsOf(node, rating).length > 0;

export type Progress = Record<string, NodeProgress>;

/** A study run: the decisions in order, each either taught (answer shown) or asked from memory. */
/** `probe`: asked cold to test out of it (testOutRun); right marks it known, a miss teaches it. */
export type StudyItem = { id: string; learn: boolean; probe?: boolean };

/** How many new decisions one "Learn" run teaches. */
export const LEARN_BATCH = 5;
/** The most decisions one review run asks. */
const REVIEW_MAX = 20;

const shuffle = <T,>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Teach the next new decisions (in the course's order, or a chapter's), then ask them all from memory
 * in a shuffled order: seeing it once and recalling it a few minutes later is what makes it stick.
 */
export function learnRun(course: Course, progress: Progress, chapterId?: string): StudyItem[] {
  const pool = chapterId ? (course.chapters.find((c) => c.id === chapterId)?.nodes ?? []) : nodesOf(course);
  const fresh = pool.filter((n) => !progress[n.id]).slice(0, LEARN_BATCH);
  return [...fresh.map((n) => ({ id: n.id, learn: true })), ...shuffle(fresh).map((n) => ({ id: n.id, learn: false }))];
}

/** The decisions due again, shuffled: answered from memory. */
export function reviewRun(course: Course, progress: Progress, now = Date.now()): StudyItem[] {
  const due = nodesOf(course).filter((n) => isDue(progress[n.id], now));
  return shuffle(due)
    .slice(0, REVIEW_MAX)
    .map((n) => ({ id: n.id, learn: false }));
}

/** Every decision with a pitfall, from memory; the ones never seen are taught first. */
export function dangerRun(course: Course, progress: Progress, rating: number): StudyItem[] {
  const nodes = shuffle(nodesOf(course).filter((n) => isDanger(n, rating))).slice(0, REVIEW_MAX);
  return [...nodes.filter((n) => !progress[n.id]).map((n) => ({ id: n.id, learn: true })), ...nodes.map((n) => ({ id: n.id, learn: false }))];
}

/**
 * For a student who knows some of it already: every decision not yet known (in a chapter, or the
 * whole course), in order, asked cold. Right the first time and it's known; a miss is taught and
 * asked again at the end, so nobody has to sit through lessons on moves they already play.
 */
export function testOutRun(course: Course, progress: Progress, chapterId?: string): StudyItem[] {
  const pool = chapterId ? (course.chapters.find((c) => c.id === chapterId)?.nodes ?? []) : nodesOf(course);
  return pool.filter((n) => masteryOf(progress[n.id]) !== "known").map((n) => ({ id: n.id, learn: false, probe: true }));
}

/** A chapter start to end: new decisions taught, the rest asked. */
export function chapterRun(chapter: CourseChapter, progress: Progress): StudyItem[] {
  return chapter.nodes.map((n) => ({ id: n.id, learn: !progress[n.id] }));
}

export function counts(course: Course, progress: Progress, now = Date.now()) {
  const nodes = nodesOf(course);
  const by = (m: Mastery) => nodes.filter((n) => masteryOf(progress[n.id]) === m).length;
  return { total: nodes.length, fresh: by("new"), learning: by("learning"), known: by("known"), due: nodes.filter((n) => isDue(progress[n.id], now)).length };
}
