// The shape of an opening course (courses/*.ts). Kept free of runtime imports so the check and
// pitfall scripts (scripts/check-course.mjs, scripts/find-pitfalls.mjs) can load the content.
//
// A course teaches an opening as the handful of decisions it really is, not as a list of lines to
// memorize: which setup the opponent chose, the one answer to it, and why. Each decision is a node: a
// position with the student to move, reached by `path`, and the move the course plays there. Chapters
// are the opponent's setups (the Classical, the Sämisch...), each a chain of nodes from the first
// moves that tell the setups apart to where the plan takes over.

/**
 * One decision. `path` is the moves from the start position (SAN, space separated), ending with the
 * opponent's move that the student answers. `answer` is the course's move; `also` are other moves it
 * accepts outright (an engine-equal move outside them is accepted too, with the course's move shown).
 */
export interface CourseNode {
  id: string;
  path: string;
  answer: string;
  also?: string[];
  /** "punish": the opponent's last move was a mistake and `answer` cashes in. */
  kind?: "punish";
  /** Short name for the map and the card's heading. */
  title: string;
  /** What the opponent's last move means: what changed, what's coming. Shown first by Hint. */
  recognize: string;
  /** Why the answer: the idea, in a sentence or three. Speaks from the node's position. */
  why: string;
  /** Drawings for `why` on the node's position (plans.ts format: "g:e7e5 r:d4 y:g7a1 b:b8d7"). */
  draw: string;
  /**
   * The natural move that loses here, written by hand and checked by the engine (scripts/check-course.mjs):
   * `text` says what goes wrong. Pitfalls players really fall into are also found by find-pitfalls.mjs.
   */
  watch?: { move: string; text: string };
  /** After the answer, the rest of the point played out (both sides, SAN): the student finds their moves. */
  cont?: string;
}

export interface CourseChapter {
  id: string;
  name: string;
  /** What the setup is and how to spot it, in a sentence or two. */
  blurb: string;
  nodes: CourseNode[];
}

export interface Course {
  id: string;
  /** The training set (training.ts) it belongs to: the opening trainer shows it as that opening's course. */
  setId: string;
  name: string;
  color: "white" | "black";
  /** What studying it is about, on the course's map. */
  intro: string;
  chapters: CourseChapter[];
}
