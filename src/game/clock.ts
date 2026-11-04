// Chess clocks. Each move stamps the mover's remaining time (with increment) into state.clocks;
// the side to move counts down from turnStartedAt. Neither side is charged for their first move.
import { Chess } from "chess.js";
import { sideToMove } from "../chess/line";
import { useStore, type Color, type TimeControl } from "../store";
import { finish } from "./session";

const TICK_MS = 100;

/** The clock a side had after its latest move (or the starting time). */
function lastStamp(side: Color): number | null {
  const { meta, game, clocks } = useStore.getState();
  if (!meta.timeControl) return null;
  for (let i = game.sans.length - 1; i >= 0; i--) {
    if (sideToMove(game.fens[i]) === side) return clocks[i] ?? meta.timeControl.initial * 1000;
  }
  return meta.timeControl.initial * 1000;
}

/** Whether the side to move is being charged: both sides have made their first move. */
function running(): boolean {
  const { meta, game, turnStartedAt } = useStore.getState();
  return !!meta.timeControl && !meta.result && meta.studentColor !== "both" && game.sans.length >= 2 && turnStartedAt !== null;
}

/** Milliseconds left on a side's clock right now; null in a game without a clock. */
export function clockLeft(side: Color, now = Date.now()): number | null {
  const stamp = lastStamp(side);
  if (stamp === null) return null;
  const { game, turnStartedAt } = useStore.getState();
  if (!running() || sideToMove(game.fens[game.sans.length]) !== side) return stamp;
  return Math.max(0, stamp - (now - turnStartedAt!));
}

/** Which side's clock is ticking, if any. */
export function clockRunning(): Color | null {
  const { game } = useStore.getState();
  return running() ? sideToMove(game.fens[game.sans.length]) : null;
}

/** Whether `side` has mating material at all (the flag only loses against a side that could mate). */
function canMate(fen: string, side: Color): boolean {
  const pieces = new Chess(fen)
    .board()
    .flat()
    .filter((p) => p && p.color === side[0] && p.type !== "k");
  if (pieces.length === 0) return false;
  return !(pieces.length === 1 && (pieces[0]!.type === "n" || pieces[0]!.type === "b"));
}

function flag(side: Color) {
  const { game } = useStore.getState();
  const winner: Color = side === "white" ? "black" : "white";
  if (!canMate(game.fens[game.sans.length], winner)) finish("1/2-1/2", "timeout vs insufficient material");
  else finish(winner === "white" ? "1-0" : "0-1", "timeout");
}

export function initClock() {
  useStore.subscribe((s, prev) => {
    if (s.game === prev.game || s.gameId !== prev.gameId || !s.meta.timeControl) return;
    const n = s.game.sans.length;
    const before = prev.game.sans.length;
    const now = Date.now();
    if (n === before + 1) {
      // A move at the end of the game: charge the mover for their thinking time.
      const mover = sideToMove(s.game.fens[n - 1]);
      const stamp = (() => {
        for (let i = before - 1; i >= 0; i--) {
          if (sideToMove(prev.game.fens[i]) === mover) return prev.clocks[i] ?? s.meta.timeControl!.initial * 1000;
        }
        return s.meta.timeControl!.initial * 1000;
      })();
      const charged = n - 1 >= 2 && prev.turnStartedAt !== null ? now - prev.turnStartedAt : 0;
      const left = stamp - charged;
      if (left <= 0 && !s.meta.result) {
        // The tick missed it (e.g. the window was asleep): the flag fell before this move.
        useStore.setState({ clocks: [...prev.clocks.slice(0, before), 0], turnStartedAt: now });
        flag(mover);
        return;
      }
      useStore.setState({
        clocks: [...prev.clocks.slice(0, before), left + s.meta.timeControl.increment * 1000],
        turnStartedAt: now,
      });
    } else if (n < before) {
      // Takeback: the clocks go back with the moves.
      useStore.setState({ clocks: s.clocks.slice(0, n), turnStartedAt: now });
    }
  });

  window.setInterval(() => {
    const side = clockRunning();
    if (side && clockLeft(side) === 0) flag(side);
  }, TICK_MS);
}

/** "4:59", "0:42", and tenths under ten seconds: "0:07.3". */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  if (ms < 10_000) return `0:0${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`;
  return `${m}:${sec}`;
}

const tc = (minutes: number, increment: number): TimeControl => ({ initial: minutes * 60, increment });

/** The usual online time controls, as on chess.com and lichess. */
export const TIME_CONTROLS: { group: "Bullet" | "Blitz" | "Rapid"; controls: TimeControl[] }[] = [
  { group: "Bullet", controls: [tc(1, 0), tc(1, 1), tc(2, 1)] },
  { group: "Blitz", controls: [tc(3, 0), tc(3, 2), tc(5, 0)] },
  { group: "Rapid", controls: [tc(10, 0), tc(10, 5), tc(15, 10)] },
];

/** "3 min", "3 + 2". */
export function timeControlLabel({ initial, increment }: TimeControl): string {
  const minutes = initial / 60;
  return increment ? `${minutes} + ${increment}` : `${minutes} min`;
}
