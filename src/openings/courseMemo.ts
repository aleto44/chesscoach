// The coach's closer look at a course decision the student keeps missing. The card's `recognize`
// and `why` are written for everyone; after a few misses this student needs more: what in the
// position should make them think of the answer (the signal), and a rule of thumb that ties that
// signal to the move, written against the moves they actually played instead. It's worked out once
// (a one-off coach_explain call, handed the course's own text, the chapter's neighbouring decisions
// and the engine on the student's wrong moves), kept in the settings so the phone shares it, and
// asked again from another angle if the misses keep coming.
import { create } from "zustand";
import { invoke } from "../backend";
import { saveSetting, settingRating, useSettings } from "../settings";
import { START_RATING } from "../rating";
import { canExplain, compareMoves, evalText, parseIdeas, pieceList } from "./explain";
import { chapterOf, fenOf, pitfallsOf } from "./course";
import type { Course, CourseNode } from "./courseTypes";
import { progressOf, STRUGGLE_MISSES } from "./progress";
import type { PlanIdea } from "./plans";

export interface CourseMemo {
  /** Two ideas: what to look for (doesn't name the answer, so it works as a hint), then how to remember it. */
  ideas: PlanIdea[];
  /** The decision's miss count when it was written: more misses since and it's asked again. */
  wrong: number;
  v: number;
}

/** Bumped when the prompt changes, so older memos are written again. */
const MEMO_V = 1;
/** Misses since the last memo that call for a new angle. */
const RETRY_MISSES = 3;

/** Decisions the coach is writing a memo for right now (the card says so). */
export const useMemoLoading = create<{ ids: string[] }>(() => ({ ids: [] }));
const loading = (id: string, on: boolean) =>
  useMemoLoading.setState((s) => ({ ids: on ? [...s.ids.filter((x) => x !== id), id] : s.ids.filter((x) => x !== id) }));

/** The decision's memo, if the student has one (and it's of the current kind). */
export function memoOf(id: string, memos = useSettings.getState().openingCourseMemos): CourseMemo | null {
  const m = memos[id];
  return m && m.v === MEMO_V && m.ideas.length ? m : null;
}

/** Whether the decision has been missed enough for a memo, and the one it has (if any) is out of date. */
export function wantsMemo(id: string): boolean {
  const p = progressOf(id);
  if (!p || p.wrong < STRUGGLE_MISSES) return false;
  const m = memoOf(id);
  return !m || p.wrong >= m.wrong + RETRY_MISSES;
}

const san = (fen: string, move: string) => (fen.split(" ")[1] === "b" ? `...${move}` : move);
const numbered = (moves: string[]) => moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");

/** The question: the course's own text and the facts around it, then the format (parseIdeas reads it). */
async function memoPrompt(course: Course, node: CourseNode): Promise<string> {
  const fen = fenOf(node);
  const p = progressOf(node.id)!;
  const chapter = chapterOf(course, node.id);
  const path = node.path.split(" ");
  const rating = settingRating(useSettings.getState(), "rapid") ?? START_RATING;
  const misses = [...new Set(p.misses ?? [])].slice(-3);
  const missLines = await Promise.all(
    misses.map(async (m) => {
      try {
        const e = await compareMoves(fen, m, node.answer, course.color);
        return `- ${san(fen, m)}: ${evalText(e.played)} for the student, against ${evalText(e.book)} after ${san(fen, node.answer)}`;
      } catch {
        return `- ${san(fen, m)}`;
      }
    }),
  );
  // The chapter's other decisions, so the memo can say what tells this one apart from those.
  const neighbours = (chapter?.nodes ?? [])
    .filter((n) => n.id !== node.id)
    .slice(0, 8)
    .map((n) => `- "${n.title}": after ${numbered(n.path.split(" "))} the course plays ${san(fenOf(n), n.answer)}`);
  const pits = pitfallsOf(node, rating)
    .slice(0, 3)
    .map((x) => `- ${san(fen, x.san)}? ${x.refute.join(" ")} (${evalText(x.eval)} for the student)`);
  const old = memoOf(node.id);

  return [
    `A club player is studying the ${course.name} as ${course.color} in an opening course: each decision is a position and the one move the course plays there.`,
    `They keep getting one decision wrong (${p.wrong} misses, ${p.right} right). Help them see what to look for, so the move comes to mind next time.`,
    "",
    `Chapter: ${chapter?.name ?? ""}. ${chapter?.blurb ?? ""}`,
    `Decision: "${node.title}". Moves: ${numbered(path)}`,
    `Position (FEN, ${course.color} to move): ${fen}`,
    `Pieces: ${pieceList(fen)}`,
    `The course's move: ${san(fen, node.answer)}${node.also?.length ? ` (also accepted: ${node.also.map((m) => san(fen, m)).join(", ")})` : ""}.`,
    `What the course says the opponent's last move means: ${node.recognize}`,
    `Why the course's move: ${node.why}`,
    ...(node.watch ? [`The course warns against ${san(fen, node.watch.move)}: ${node.watch.text}`] : []),
    ...(missLines.length ? ["What the student played instead (Stockfish, the student's view):", ...missLines] : []),
    ...(pits.length ? ["Moves players really make here that lose, with the punishment:", ...pits] : []),
    ...(neighbours.length ? ["Other decisions in the same chapter, which the student may be mixing this one up with:", ...neighbours] : []),
    ...(old
      ? ["", "An earlier explanation didn't stick; take a different angle from this one:", ...old.ideas.map((i) => `${i.title}: ${i.text}`)]
      : []),
    "",
    "Answer with exactly 2 ideas, in exactly this format and nothing else:",
    "## <title, 2 to 6 words>",
    "<1 to 3 short sentences>",
    "draw: <drawings on the position above>",
    "",
    `First idea: what to look for. The concrete feature of this position (the opponent's last move, a piece, a square, the pawns) that should make the student think of the course's move, and what it calls for. ` +
      `Don't name or draw the course's move in this one: it's shown as a hint before the answer.`,
    `Second idea: how to remember it. A short rule of thumb that links that feature to ${san(fen, node.answer)}` +
      `${misses.length ? `, and why the move they keep playing (${misses.map((m) => san(fen, m)).join(", ")}) doesn't fit here` : ""}` +
      `${neighbours.length ? "; if a neighbouring decision looks alike, say what tells them apart" : ""}.`,
    "Drawings are space-separated tokens: g:e2e4 a green arrow (a move or pawn break for the student), b:g1f3 a blue arrow (a piece route), " +
      "r:d8h4 a red arrow (the opponent's threat or idea), r:d4 a red circle (a target or weak square), y:a1h8 a yellow line (a diagonal or file), " +
      "y:d5 a yellow circle (a key square). Every green, blue and red arrow starts on a piece in the position above, or where an earlier arrow " +
      "of the same idea ends. 1 to 3 drawings per idea; they show exactly what the sentences say.",
    "Under 100 words in all. Plain words a club player uses. No preamble, no move lists. " +
      'Write Black\'s moves with "..." (...Nf6) and White\'s without (Nf3). Agree with the course and the engine numbers above.',
  ].join("\n");
}

const asking = new Set<string>();

/**
 * Writes the decision's memo in the background if it wants one (wantsMemo) and the coach can be
 * asked here. Nothing happens otherwise; a failure is logged and tried again on the next miss or visit.
 */
export async function ensureMemo(course: Course, node: CourseNode) {
  if (asking.has(node.id) || !wantsMemo(node.id) || !canExplain()) return;
  asking.add(node.id);
  loading(node.id, true);
  try {
    const text = await invoke<string>("coach_explain", { prompt: await memoPrompt(course, node) });
    const ideas = parseIdeas(text, fenOf(node))?.slice(0, 2);
    if (!ideas) throw new Error(`not in the ideas format: ${text.slice(0, 200)}`);
    const memo: CourseMemo = { ideas, wrong: progressOf(node.id)?.wrong ?? 0, v: MEMO_V };
    await saveSetting("openingCourseMemos", { ...useSettings.getState().openingCourseMemos, [node.id]: memo });
  } catch (e) {
    console.error("course memo failed", e);
  } finally {
    asking.delete(node.id);
    loading(node.id, false);
  }
}
