// Startup timing: how long each step of opening the app took, in ms since the page started
// loading. Kept for the last few launches (Settings shows them) so "the phone was slow" can be
// pinned on the network, the page or the engines.
import { create } from "zustand";

export interface Launch {
  at: string;
  /** How the page came up: from the saved snapshot or with nothing to show yet. */
  from: "snapshot" | "cold";
  marks: Record<string, number>;
}

const KEY = "cc-launches";
const KEEP = 5;

function saved(): Launch[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const current: Launch = { at: new Date().toISOString(), from: "cold", marks: {} };

/** This launch first, then earlier ones. */
export const useLaunches = create<Launch[]>(() => [current, ...saved()].slice(0, KEEP));

function store() {
  const list = [current, ...saved().filter((l) => l.at !== current.at)].slice(0, KEEP);
  useLaunches.setState([{ ...current, marks: { ...current.marks } }, ...list.slice(1)], true);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // No storage: the timings just aren't kept.
  }
}

/** Records the first time a step happened in this launch (later calls are ignored). */
export function mark(step: string) {
  if (step in current.marks) return;
  current.marks[step] = Math.round(performance.now());
  console.info(`[startup] ${step} at ${current.marks[step]} ms`);
  store();
}

export function launchedFrom(from: Launch["from"]) {
  current.from = from;
  store();
}

// What the browser measured for the page itself.
if (typeof window !== "undefined") {
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav) {
    current.marks["page arrived"] = Math.round(nav.responseEnd);
  }
}
