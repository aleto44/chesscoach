// Utility → Chess clock: two big halves, one per player, tapped after each move. On a phone it takes
// the whole screen, with the top half turned to face the player across the table.
import { useEffect, useRef, useState } from "react";
import { buzz } from "../haptics";
import { back } from "../nav";
import { play } from "../sound";
import {
  applySetup,
  checkFlag,
  clockLabel,
  formatClock,
  pause,
  press,
  PRESETS,
  resetTimer,
  resume,
  running,
  started,
  timeLeft,
  useTimer,
  type Side,
  type SideClock,
  type TimerSetup,
} from "../utility/timer";
import { askConfirm } from "./Confirm";
import { Modal } from "./GameDialogs";

const LOW_TIME = 10_000;

export function TimerScreen() {
  const s = useTimer();
  const [setupOpen, setSetupOpen] = useState(false);
  const on = running(s);
  useTicker(on);
  useWakeLock(on);

  // Space for desktop: the player to move ends their turn (before the start, the bottom clock starts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (document.querySelector(".modal-backdrop")) return;
      e.preventDefault();
      const t = useTimer.getState();
      tap(t.turn === null ? 1 : t.turn);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSetup = () => {
    pause();
    setSetupOpen(true);
  };
  const reset = async () => {
    if (started(s) && s.flagged === null) {
      pause();
      if (!(await askConfirm({ title: "Reset the clock?", body: "Both clocks go back to their starting times.", confirmLabel: "Reset", danger: true }))) return;
    }
    resetTimer();
  };

  return (
    <main className={`timer-screen ${on ? "is-running" : ""}`}>
      <Half side={1} />
      <div className="timer-bar">
        <button className="timer-exit" onClick={back} aria-label="Leave the clock" title="Leave (the clock keeps its time)">
          ‹
        </button>
        {s.flagged === null && started(s) && (
          <button className="timer-main" onClick={s.paused ? resume : pause} aria-label={s.paused ? "Resume" : "Pause"}>
            {s.paused ? "▶" : "❚❚"}
          </button>
        )}
        <button onClick={reset} aria-label="Reset" title="Reset">
          ↺
        </button>
        <button onClick={openSetup} aria-label="Set the times" title="Set the times">
          ⚙
        </button>
      </div>
      <Half side={0} />
      {setupOpen && <TimerSetupDialog onClose={() => setSetupOpen(false)} />}
    </main>
  );
}

function tap(side: Side) {
  const before = useTimer.getState();
  press(side);
  if (useTimer.getState() !== before) {
    play("move");
    buzz([15]);
  }
}

function Half({ side }: { side: Side }) {
  const s = useTimer();
  const ms = timeLeft(s, side);
  const active = s.turn === side && s.flagged === null;
  const waiting = s.turn === null;
  const status =
    s.flagged === side
      ? "Out of time"
      : s.flagged !== null
        ? "Wins on time"
        : waiting
          ? "Tap after your move to start your opponent's clock"
          : s.paused
            ? "Paused"
            : null;
  const cls = [
    "timer-half",
    side === 1 ? "top" : "bottom",
    side === 1 && s.setup.facing ? "facing" : "",
    active && !s.paused ? "active" : "",
    s.flagged === side ? "flagged" : "",
    active && ms < LOW_TIME ? "low" : "",
  ].join(" ");
  return (
    <button
      className={cls}
      // pointerdown: a tap counts the moment the finger lands, not when it lifts.
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        tap(side);
      }}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${side === 1 ? "Top" : "Bottom"} player, ${formatClock(ms)}`}
    >
      <span className="timer-face">
        <span className="timer-time">{formatClock(ms)}</span>
        <span className="timer-info">
          {status ?? `Moves ${s.moves[side]}`}
          {s.setup.sides[0].base !== s.setup.sides[1].base || s.setup.sides[0].inc !== s.setup.sides[1].inc
            ? ` · ${clockLabel(s.setup.sides[side])}`
            : ""}
        </span>
      </span>
    </button>
  );
}

/** Re-renders often enough for tenths while a clock runs; flags a clock that reaches zero. */
function useTicker(on: boolean) {
  const [, setTick] = useState(0);
  const warned = useRef(false);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      const s = useTimer.getState();
      const left = s.turn === null ? Infinity : timeLeft(s, s.turn);
      // One warning per stretch under ten seconds, and only in games long enough for it to mean something.
      if (left < LOW_TIME && !warned.current && s.setup.sides[s.turn!].base > 30_000) {
        warned.current = true;
        play("low-time");
      } else if (left >= LOW_TIME) warned.current = false;
      if (checkFlag()) {
        play("game-end");
        buzz([200, 100, 200]);
      }
      setTick((t) => t + 1);
    }, 50);
    return () => clearInterval(id);
  }, [on]);
}

/** A phone lying on the table mustn't dim and lock mid-game. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const take = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(
        (l) => {
          if (live) lock = l;
          else l.release().catch(() => {});
        },
        () => {},
      );
    };
    take();
    // The browser drops the lock when the page is hidden; take it again on return.
    document.addEventListener("visibilitychange", take);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", take);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

function TimerSetupDialog({ onClose }: { onClose: () => void }) {
  const current = useTimer((s) => s.setup);
  const [sides, setSides] = useState<[SideClock, SideClock]>(current.sides);
  const [facing, setFacing] = useState(current.facing);
  const [split, setSplit] = useState(current.sides[0].base !== current.sides[1].base || current.sides[0].inc !== current.sides[1].inc);
  const start = (setup: TimerSetup) => {
    applySetup(setup);
    onClose();
  };
  const setSide = (i: Side, c: SideClock) =>
    setSides((prev) => (split ? (i === 0 ? [c, prev[1]] : [prev[0], c]) : [c, c]));
  return (
    <Modal title="Chess clock" onClose={onClose} className="timer-setup">
      <div className="timer-presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className={!split && sides[0].base === p.base && sides[0].inc === p.inc ? "on" : ""}
            onClick={() => start({ sides: [{ base: p.base, inc: p.inc }, { base: p.base, inc: p.inc }], facing })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={split}
          onChange={(e) => {
            setSplit(e.target.checked);
            if (!e.target.checked) setSides([sides[0], sides[0]]);
          }}
        />
        Different time for each player (odds)
      </label>
      {split ? (
        <div className="timer-split">
          <SideFields label="Top player" value={sides[1]} onChange={(c) => setSide(1, c)} />
          <button className="timer-swap" onClick={() => setSides([sides[1], sides[0]])} title="Swap the two players' times">
            ⇅ Swap
          </button>
          <SideFields label="Bottom player" value={sides[0]} onChange={(c) => setSide(0, c)} />
        </div>
      ) : (
        <SideFields label="Both players" value={sides[0]} onChange={(c) => setSide(0, c)} />
      )}
      <label className="toggle">
        <input type="checkbox" checked={facing} onChange={(e) => setFacing(e.target.checked)} />
        Turn the top half to face the player across the table
      </label>
      <footer>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={sides[0].base <= 0 || sides[1].base <= 0} onClick={() => start({ sides, facing })}>
          Set clock
        </button>
      </footer>
    </Modal>
  );
}

/** Minutes, seconds and increment for one player, each with − / + for thumbs and a field for typing. */
function SideFields({ label, value, onChange }: { label: string; value: SideClock; onChange: (c: SideClock) => void }) {
  const total = Math.round(value.base / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const inc = Math.round(value.inc / 1000);
  const set = (mm: number, ss: number, ii: number) =>
    onChange({ base: (Math.max(0, Math.min(600, mm)) * 60 + Math.max(0, Math.min(59, ss))) * 1000, inc: Math.max(0, Math.min(600, ii)) * 1000 });
  return (
    <fieldset className="timer-fields">
      <legend>{label}</legend>
      <Stepper label="Minutes" value={m} onChange={(v) => set(v, s, inc)} />
      <Stepper label="Seconds" value={s} step={5} onChange={(v) => set(m, v, inc)} />
      <Stepper label="Increment (s)" value={inc} onChange={(v) => set(m, s, v)} />
    </fieldset>
  );
}

function Stepper({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="timer-stepper">
      <span>{label}</span>
      <span className="timer-stepper-row">
        <button type="button" onClick={() => onChange(value - step)} aria-label={`Less ${label.toLowerCase()}`}>
          −
        </button>
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" onClick={() => onChange(value + step)} aria-label={`More ${label.toLowerCase()}`}>
          +
        </button>
      </span>
    </label>
  );
}
