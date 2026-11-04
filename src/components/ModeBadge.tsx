import type { GameMode } from "../store";

export function ModeBadge({ mode }: { mode: GameMode }) {
  return (
    <span
      className={`mode-badge ${mode}`}
      title={
        mode === "rated"
          ? "Rated: no engine, coach or takebacks until the game ends. Counts toward your profile."
          : "Practice: engine, coach and takebacks allowed. Doesn't count toward your profile."
      }
    >
      {mode === "rated" ? "Rated" : "Practice"}
    </span>
  );
}
