// The card over the board when a rated game ends: the result and the rating it won or lost,
// counting from the old rating to the new one.
import { useEffect, useState } from "react";
import { useRatingResult } from "../game/session";
import { signed } from "../rating";
import { opponentLabel, useStore } from "../store";
import { NewGameDialog } from "./GameDialogs";

const COUNT_MS = 1100;

export function RatingResult() {
  const shown = useRatingResult((s) => s.shown);
  const gameId = useStore((s) => s.gameId);
  const meta = useStore((s) => s.meta);
  const [newGame, setNewGame] = useState(false);
  const shownHere = shown && shown.gameId === gameId ? shown : null;
  const rating = useCountUp(shownHere?.before ?? 0, shownHere?.after ?? 0, shownHere?.gameId);

  // Escape closes it, like the other cards.
  useEffect(() => {
    if (!shownHere) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shownHere]);

  if (newGame) return <NewGameDialog mode="rated" onClose={() => (setNewGame(false), close())} />;
  if (!shownHere) return null;

  const delta = shownHere.after - shownHere.before;
  const outcome =
    meta.result === "1/2-1/2"
      ? "draw"
      : (meta.result === "1-0") === (meta.studentColor === "white")
        ? "win"
        : "loss";
  const trend = delta > 0 ? "up" : delta < 0 ? "down" : "even";

  return (
    <div className="rating-result-backdrop" onMouseDown={close}>
      <div className={`rating-result ${outcome}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Game result">
        <button className="rating-result-close" onClick={close} aria-label="Close">
          ✕
        </button>
        <div className="rating-result-icon" aria-hidden>
          {outcome === "win" ? "♔" : outcome === "draw" ? "½" : "♚"}
        </div>
        <h2>{outcome === "win" ? "You won!" : outcome === "draw" ? "Draw" : "You lost"}</h2>
        <p className="muted small">
          {meta.termination ? `by ${meta.termination} · ` : ""}vs {opponentLabel(meta)}
        </p>
        <div className="rating-result-number">
          <span className="rating-result-value">{rating}</span>
          <span className={`rating-result-delta ${trend}`}>{signed(delta)}</span>
        </div>
        <p className="muted small">
          {delta > 0
            ? `Rating gained, up from ${shownHere.before}`
            : delta < 0
              ? `Rating lost, down from ${shownHere.before}`
              : `Rating unchanged at ${shownHere.before}`}
        </p>
        <div className="rating-result-actions">
          <button
            className="primary"
            onClick={() => {
              close();
              useStore.setState({ reportOpen: true });
            }}
          >
            Review game
          </button>
          <button onClick={() => setNewGame(true)}>New rated game</button>
        </div>
      </div>
    </div>
  );
}

function close() {
  useRatingResult.setState({ shown: null });
}

/** Counts from `from` to `to`, easing out, restarting when `key` changes. */
function useCountUp(from: number, to: number, key: unknown): number {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setValue(to);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      setValue(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setValue(from);
    // A beat first, so the old rating registers before it moves.
    const delay = window.setTimeout(() => (frame = requestAnimationFrame(tick)), 350);
    return () => (clearTimeout(delay), cancelAnimationFrame(frame));
  }, [key, from, to]);
  return value;
}
