// What sort of position a drill is, for the drills menu's "focus on one kind". Game mistakes are
// split by what went wrong, read from the review's tags and the drill's lesson; puzzle and coach
// drills are their own kind. Worked out when the drill is stored (addDrills, and again with each
// new lesson), so the computer can count and filter by it.
import type { Drill } from "./drills";
import type { PackedLesson } from "./lesson";

export type DrillCategory =
  | "hung"
  | "walked-into"
  | "missed-material"
  | "missed-tactic"
  | "mate"
  | "long-term"
  | "puzzle"
  | "coach";

/** In menu order. */
export const CATEGORIES: { id: DrillCategory; icon: string; label: string; about: string }[] = [
  { id: "hung", icon: "🎯", label: "Hung material", about: "Your move left something to be taken at once" },
  { id: "walked-into", icon: "🪤", label: "Walked into a tactic", about: "The opponent won material a few moves later" },
  { id: "missed-material", icon: "💰", label: "Missed free material", about: "You could have taken something" },
  { id: "missed-tactic", icon: "⚡", label: "Missed tactics", about: "A combination a few moves deep was there" },
  { id: "mate", icon: "♚", label: "Mates", about: "Mates you missed or allowed" },
  { id: "long-term", icon: "♟", label: "Long-term mistakes", about: "Pawns and slower plans, nothing tactical" },
  { id: "puzzle", icon: "🧩", label: "Missed puzzles", about: "Lichess puzzles you got wrong" },
  { id: "coach", icon: "💬", label: "From the coach", about: "Positions the coach set" },
];

export const categoryLabel = (c: string | null | undefined) => CATEGORIES.find((x) => x.id === c)?.label ?? "Drills";

export function drillCategory(d: { kind: Drill["kind"]; note?: string | null; lesson?: string | null }): DrillCategory {
  if (d.kind === "puzzle" || d.kind === "coach") return d.kind;
  const tags = (d.note ?? "").split(", ");
  let l: PackedLesson | null = null;
  try {
    l = d.lesson ? JSON.parse(d.lesson) : null;
  } catch {
    l = null;
  }
  const themes = l?.rest?.themes ?? [];
  if (tags.includes("missed-mate") || tags.includes("allowed-mate") || themes[0] === "mate") return "mate";
  if (!l?.played) {
    // No lesson (yet): the review's tags are all there is.
    if (tags.includes("hung-piece")) return "hung";
    return tags.includes("missed-capture") ? "missed-material" : "walked-into";
  }
  if (themes[0] === "later" || themes[0] === "pawns") return "long-term";
  if (l.rest.focus === "better") {
    // The move played gave nothing away; the chance it missed is the lesson. A capture straight
    // away is free material, anything else is a combination that pays off a few moves later.
    const best = l.alternatives[0]?.sans[0] ?? "";
    return best.includes("x") ? "missed-material" : "missed-tactic";
  }
  // The move played lost something: at once (the reply takes) or after a sequence.
  const reply = l.played.sans[1] ?? "";
  return tags.includes("hung-piece") || reply.includes("x") ? "hung" : "walked-into";
}
