import { useEval, whiteWinPercent } from "../engine/live";
import { formatScore, pvToSan } from "../engine/stockfish";

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

/** One-line summary under the board: score, depth and the engine's best line. */
export function EvalLine() {
  const { fen, line } = useEval();
  if (!fen) return null;
  if (!line) return <div className="eval-line muted">Analyzing…</div>;
  return (
    <div className="eval-line">
      <strong>{formatScore(line)}</strong>
      <span className="muted"> · depth {line.depth} · </span>
      <span>{pvToSan(fen, line.pv, 8)}</span>
    </div>
  );
}
