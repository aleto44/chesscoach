import { useEffect, useState } from "react";
import { clockLeft, clockRunning, formatClock } from "../game/clock";
import { opponentLabel, useStore, type Color } from "../store";

/** A player's name and clock, shown above (opponent) or below (student) the board. */
export function ClockRow({ side }: { side: Color }) {
  const meta = useStore((s) => s.meta);
  // Re-render on every store change (moves) and, while this clock runs, every 100 ms.
  useStore((s) => s.clocks);
  const active = useStore(() => clockRunning() === side);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(t);
  }, [active]);

  const left = clockLeft(side);
  if (left === null) return null;
  const name = side === meta.studentColor ? "You" : opponentLabel(meta);
  const low = left < 20_000;
  return (
    <div className="clock-row">
      <span className={`clock-piece ${side}`} aria-hidden />
      <span className="clock-name">{name}</span>
      <span className="spacer" />
      <span className={`clock ${active ? "active" : ""} ${low ? "low" : ""}`} aria-label={`${name} clock`}>
        {formatClock(left)}
      </span>
    </div>
  );
}
