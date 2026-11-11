// Spaced-repetition drills (SM-2 scheduling lives in src-tauri/src/stats.rs). Mistake drills come
// from post-game analysis; opening drills from the repertoire; coach drills from ask_move;
// puzzle drills from missed Lichess puzzles.
import { gradedOffline, orOffline, packDrillCounts, packDrills, retiredOffline } from "../offline";
import { create } from "zustand";
import { Chess } from "chess.js";
import { sideToMove, type Line } from "../chess/line";
import { hasBackend } from "../db";
import type { Color, GameMeta } from "../store";
import type { MoveAnnotation } from "./review";
import { whiteWinPercent } from "../engine/live";
import { invoke, isTauri } from "../backend";
import { computeLesson, LESSON_VERSION, teaches } from "./lesson";

export interface Drill {
  id: number;
  kind: "mistake" | "opening" | "coach" | "puzzle";
  title: string;
  fen: string;
  color: Color;
  answerUci: string | null;
  line: string[];
  note: string | null;
  sourceGameId: number | null;
  sourcePly: number | null;
  dueAt: string;
  reps: number;
  lapses: number;
  /** What a mistake drill teaches (JSON, see lesson.ts); null until worked out. */
  lesson?: string | null;
}

export interface NewDrill {
  kind: Drill["kind"];
  title: string;
  fen: string;
  color: Color;
  answerUci?: string | null;
  line?: string[];
  note?: string | null;
  sourceGameId?: number | null;
  sourcePly?: number | null;
  lesson?: string | null;
}

export const useDrillCounts = create<{ total: number; due: number }>(() => ({ total: 0, due: 0 }));

export async function refreshDrillCounts() {
  if (!hasBackend()) return;
  useDrillCounts.setState(await orOffline<{ total: number; due: number }>("db_drill_counts", {}, packDrillCounts));
}

export async function addDrills(drills: NewDrill[]): Promise<number> {
  if (!hasBackend() || drills.length === 0) return 0;
  const added = await orOffline<number>("db_add_drills", { drills }, () => 0, true);
  await refreshDrillCounts();
  return added;
}

/** `tag`: only the mistake drills from games with that review tag (e.g. "hung-piece"), due or not. */
export const dueDrills = (limit = 20, all = false, tag: string | null = null) =>
  orOffline<Drill[]>("db_due_drills", { limit, all, tag }, () => packDrills(limit, all, tag));

/** Records the attempt; returns when the drill is next due. */
export async function gradeDrill(id: number, correct: boolean, played: string, ms: number): Promise<string> {
  const due = await orOffline<string>("db_grade_drill", { id, correct, played, ms }, () => gradedOffline(id, correct), true);
  await refreshDrillCounts();
  return due;
}

export async function retireDrill(id: number) {
  await orOffline("db_retire_drill", { id }, () => retiredOffline(id), true);
  await refreshDrillCounts();
}

/** Tags that mean the position held something concrete to find. */
const FINDS = ["missed-mate", "missed-capture"];

/**
 * Worth a "find the move" drill: the position asks for something. A blunder always does (you'll
 * want to spot the danger next time); so does a missed mate or capture, or a position where even
 * the engine's second choice is a mistake. A plain mistake with several sound moves on offer
 * (5.Nb5 when f4, Be2, d4, g3 and Nge2 are all fine) only teaches "not that one", so it stays in
 * the review.
 */
function drillWorthy(a: MoveAnnotation): boolean {
  if (a.class === "blunder") return true;
  if (a.class !== "mistake") return false;
  return a.tags.some((t) => FINDS.includes(t)) || (a.secondLoss ?? Infinity) >= 10;
}

/** Winning chances (%) at or under which a position counts as lost whatever the student plays. */
const LOST_WIN = 15;

/**
 * Lost even with the best move: the "mistake" only made the loss quicker (mated in 11 instead of
 * 19), so there's nothing to learn by finding the engine's move. `before` is the eval with the best
 * move (White's view, mates as ±(10000 − distance)).
 */
export function lostAnyway(before: number | undefined, mover: Color): boolean {
  if (before === undefined) return false;
  const w = Math.abs(before) >= 9000 ? (before > 0 ? 100 : 0) : whiteWinPercent({ cp: before });
  return (mover === "white" ? w : 100 - w) <= LOST_WIN;
}

/**
 * One drill per mistake or blunder the student made that's worth drilling (see drillWorthy), with
 * its lesson worked out now. A position whose lesson has nothing concrete in it (all there is to
 * say is "the position gets better") isn't a teaching moment, so it doesn't become a drill.
 */
export async function addMistakeDrills(
  g: { gameId: number; line: Line; meta: Pick<GameMeta, "studentColor"> },
  annotations: MoveAnnotation[],
) {
  const drills: NewDrill[] = [];
  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i];
    if (!drillWorthy(a) || !a.bestUci) continue;
    const fen = g.line.fens[i];
    const color = sideToMove(fen);
    if (g.meta.studentColor !== "both" && g.meta.studentColor !== color) continue;
    const before = a.evalBefore ?? annotations[i - 1]?.evalAfter;
    if (lostAnyway(before, color)) continue;
    const [, turn, , , , full] = fen.split(" ");
    const gameUci = g.line.lastMoves[i].join("") + (g.line.sans[i].match(/=([QRBN])/)?.[1].toLowerCase() ?? "");
    let lesson: string | null = null;
    try {
      const l = await computeLesson(fen, gameUci, a.bestUci, before !== undefined ? { before, after: a.evalAfter } : undefined);
      if (!teaches(l.ex)) continue;
      lesson = l.json;
    } catch (e) {
      // Kept without one: the computer works it out later (backfillLessons).
      console.warn("could not work out a drill's lesson", e);
    }
    drills.push({
      kind: "mistake",
      title: `In your game: ${full}${turn === "w" ? "." : "..."}${g.line.sans[i]}`,
      fen,
      color,
      answerUci: a.bestUci,
      note: a.tags.length ? a.tags.join(", ") : null,
      sourceGameId: g.gameId,
      sourcePly: i + 1,
      lesson,
    });
  }
  return addDrills(drills);
}

/** The game move of a mistake drill, from its title ("In your game: 14.Qa1", or the older "Move 14.: you played Qa1"). */
export function gameMoveOf(d: Pick<Drill, "kind" | "title">): string | null {
  if (d.kind !== "mistake") return null;
  return d.title.match(/^In your game: \d+\.+(\S+)$/)?.[1] ?? d.title.match(/^Move \d+\.{1,3}: you played (\S+)$/)?.[1] ?? null;
}

/** Stores a drill's lesson (worked out after the drill was made). */
export const setDrillLesson = (id: number, lesson: string) => invoke("db_set_drill_lesson", { id, lesson });

let backfilling = false;

/**
 * Drills made before lessons, or whose lesson is from an older LESSON_VERSION: works theirs out, one at a time in the background, on the computer
 * (the phone gets them with its next pack). One with nothing concrete to teach is retired, the
 * same as a new one wouldn't be made.
 */
export async function backfillLessons() {
  if (!isTauri || backfilling) return;
  backfilling = true;
  let retired = 0;
  let done = 0;
  try {
    for (;;) {
      const batch = await invoke<Drill[]>("db_drills_without_lesson", { limit: 10, version: LESSON_VERSION });
      if (!batch.length) break;
      for (const d of batch) {
        const san = gameMoveOf(d);
        let gameUci: string | null = null;
        try {
          const m = san ? new Chess(d.fen).move(san) : null;
          gameUci = m ? m.from + m.to + (m.promotion ?? "") : null;
        } catch {
          gameUci = null;
        }
        if (!gameUci || !d.answerUci || gameUci === d.answerUci) {
          // Nothing to compare (the game move is unknown): a placeholder, so it isn't tried again.
          await setDrillLesson(d.id, JSON.stringify({ v: LESSON_VERSION }));
          continue;
        }
        const l = await computeLesson(d.fen, gameUci, d.answerUci);
        await setDrillLesson(d.id, l.json);
        done++;
        if (!teaches(l.ex)) {
          await retireDrill(d.id);
          retired++;
        }
      }
    }
  } catch (e) {
    console.warn("backfilling drill lessons stopped", e);
  } finally {
    backfilling = false;
    if (done) console.info(`drill lessons: ${done} worked out, ${retired} retired (nothing concrete to teach)`);
  }
}
