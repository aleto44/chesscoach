// Stepping back and forward through the moves of a puzzle or drill. The viewed ply is null while
// the student is at the latest position, so the board follows new moves without being told.

export type Step = number | "start" | "end";

/** The ply on screen for a line of `end` moves (a stale view past the end shows the end). */
export const viewedPly = (end: number, view: number | null) => Math.min(view ?? end, end);

/** Where a step lands: null when it reaches the latest position. */
export function stepView(end: number, view: number | null, delta: Step): number | null {
  const at = viewedPly(end, view);
  const to = delta === "start" ? 0 : delta === "end" ? end : Math.max(0, Math.min(end, at + delta));
  return to === end ? null : to;
}
