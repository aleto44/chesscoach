import { useEval, whiteWinPercent } from "../engine/live";
import { formatScore } from "../engine/stockfish";

/** Vertical bar beside the board; White's share grows from White's side of the board. */
export function EvalBar({ orientation }: { orientation: "white" | "black" }) {
  const line = useEval((s) => s.line);
  const white = line ? whiteWinPercent(line) : 50;
  return (
    <div className={`eval-bar ${orientation === "black" ? "flipped" : ""}`} title={line ? formatScore(line) : "Analyzing…"}>
      <div className="eval-white" style={{ height: `${white}%` }} />
      <span className={`eval-score ${white >= 50 ? "for-white" : "for-black"}`}>
        {line ? formatScore(line).replace(/^\+/, "") : "…"}
      </span>
    </div>
  );
}
