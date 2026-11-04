import { useEffect, useState } from "react";
import { clockLeft, clockRunning, formatClock } from "../game/clock";
import { opponentLabel, useStore, type Color } from "../store";

/** A player's name, whose turn it is and their clock, at the top or bottom of the side column. */
export function PlayerCard({ side }: { side: Color }) {
  const meta = useStore((s) => s.meta);
  const thinking = useStore((s) => s.opponentThinking);
  const toMove = useStore((s) => (s.game.fens[s.game.sans.length].split(" ")[1] === "w" ? "white" : "black"));
  // Re-render on every store change (moves) and, while this clock runs, every 100 ms.
  useStore((s) => s.clocks);
  const active = useStore(() => clockRunning() === side);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(t);
  }, [active]);

  const you = side === meta.studentColor;
  const name =
    meta.studentColor === "both" ? (side === "white" ? "White" : "Black") : you ? "You" : opponentLabel(meta);
  const turn = !meta.result && toMove === side;
  const left = clockLeft(side);
  const low = left !== null && left < 20_000;
  return (
    <div className={`player-card ${turn ? "turn" : ""}`}>
      <span className={`player-piece ${side}`} aria-hidden />
      <span className="player-name">{name}</span>
      {turn && !you && thinking && <span className="player-thinking" aria-label="Thinking" />}
      <span className="spacer" />
      {left !== null && (
        <span className={`clock ${active ? "active" : ""} ${low ? "low" : ""}`} aria-label={`${name} clock`}>
          {formatClock(left)}
        </span>
      )}
    </div>
  );
}
