// The Utility chess clock: a two-player clock for a game over a real board, mostly on a phone set
// between the players. Each side has its own time and increment, so odds games (5 minutes against 1)
// are just a setup. Side 0 sits at the bottom of the screen, side 1 at the top.
import { create } from "zustand";

export type Side = 0 | 1;

export interface SideClock {
  /** Starting time, ms. */
  base: number;
  /** Added after each of this side's moves, ms. */
  inc: number;
}

export interface TimerSetup {
  sides: [SideClock, SideClock];
  /** The top player sits across the table: their half is turned to face them. */
  facing: boolean;
}

export interface TimerState {
  setup: TimerSetup;
  /** Time left on each side when `since` was taken, ms. */
  left: [number, number];
  /** Whose clock runs (or would run, while paused); null before the first tap. */
  turn: Side | null;
  paused: boolean;
  /** Date.now() when the running clock last started; wall time, so a reload keeps counting. */
  since: number;
  moves: [number, number];
  flagged: Side | null;
}

const min = (m: number) => m * 60_000;
const sec = (s: number) => s * 1000;

export const PRESETS: { label: string; base: number; inc: number }[] = [
  { label: "1 + 0", base: min(1), inc: 0 },
  { label: "2 + 1", base: min(2), inc: sec(1) },
  { label: "3 + 0", base: min(3), inc: 0 },
  { label: "3 + 2", base: min(3), inc: sec(2) },
  { label: "5 + 0", base: min(5), inc: 0 },
  { label: "5 + 3", base: min(5), inc: sec(3) },
  { label: "10 + 0", base: min(10), inc: 0 },
  { label: "10 + 5", base: min(10), inc: sec(5) },
  { label: "15 + 10", base: min(15), inc: sec(10) },
  { label: "30 + 0", base: min(30), inc: 0 },
  { label: "30 + 20", base: min(30), inc: sec(20) },
  { label: "60 + 0", base: min(60), inc: 0 },
];

const DEFAULT_SETUP: TimerSetup = { sides: [{ base: min(5), inc: 0 }, { base: min(5), inc: 0 }], facing: true };

function fresh(setup: TimerSetup): TimerState {
  return {
    setup,
    left: [setup.sides[0].base, setup.sides[1].base],
    turn: null,
    paused: false,
    since: 0,
    moves: [0, 0],
    flagged: null,
  };
}

/** The clock survives the phone dropping the page mid-game, and the last setup is kept for next time. */
const KEY = "cc-timer";
function saved(): TimerState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as TimerState | null;
    if (s && Array.isArray(s.left) && s.setup?.sides?.length === 2) return s;
  } catch {
    // Unreadable: start over.
  }
  return fresh(DEFAULT_SETUP);
}

export const useTimer = create<TimerState>(saved);
useTimer.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode: the clock just won't survive a reload.
  }
});

export const running = (s: TimerState) => s.turn !== null && !s.paused && s.flagged === null;
export const started = (s: TimerState) => s.turn !== null;

/** Time left on a side right now, ms. */
export function timeLeft(s: TimerState, side: Side, now = Date.now()): number {
  const t = s.left[side];
  return running(s) && s.turn === side ? Math.max(0, t - (now - s.since)) : t;
}

/**
 * A tap on a side's half: that player has moved. Before the start, either player's tap starts the
 * other clock (the side that taps first is Black, like setting a clock down next to the board).
 */
export function press(side: Side) {
  const s = useTimer.getState();
  if (s.flagged !== null || s.paused) return;
  const now = Date.now();
  if (s.turn === null) {
    useTimer.setState({ turn: other(side), since: now });
    return;
  }
  if (s.turn !== side) return;
  const left = [...s.left] as [number, number];
  left[side] = timeLeft(s, side, now) + s.setup.sides[side].inc;
  const moves = [...s.moves] as [number, number];
  moves[side]++;
  useTimer.setState({ left, moves, turn: other(side), since: now });
}

export const other = (side: Side): Side => (side === 0 ? 1 : 0);

export function pause() {
  const s = useTimer.getState();
  if (!running(s)) return;
  const left = [...s.left] as [number, number];
  left[s.turn!] = timeLeft(s, s.turn!);
  useTimer.setState({ left, paused: true });
}

export function resume() {
  const s = useTimer.getState();
  if (s.paused) useTimer.setState({ paused: false, since: Date.now() });
}

/** Called by the screen's ticker: a clock that reached zero stops both. */
export function checkFlag() {
  const s = useTimer.getState();
  if (!running(s) || timeLeft(s, s.turn!) > 0) return false;
  const left = [...s.left] as [number, number];
  left[s.turn!] = 0;
  useTimer.setState({ left, flagged: s.turn });
  return true;
}

export const resetTimer = () => useTimer.setState(fresh(useTimer.getState().setup));
export const applySetup = (setup: TimerSetup) => useTimer.setState(fresh(setup));

/** h:mm:ss over an hour, m:ss otherwise, and tenths in the last 20 seconds. */
export function formatClock(ms: number): string {
  if (ms < 20_000) {
    const tenths = Math.floor(ms / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "5 + 3", "30 s + 0", "2:30 + 1" for a side's setting. */
export function clockLabel(c: SideClock): string {
  const total = Math.round(c.base / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const base = m === 0 ? `${s} s` : s ? `${m}:${String(s).padStart(2, "0")}` : `${m}`;
  return `${base} + ${Math.round(c.inc / 1000)}`;
}
