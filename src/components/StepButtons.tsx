import type { ReactNode } from "react";
import type { Step } from "../chess/view";

function Buttons({ onStep, disabled }: { onStep: (s: Step) => void; disabled?: boolean }) {
  return (
    <>
      <button onClick={() => onStep("start")} disabled={disabled} title="Start (Home)" aria-label="Start">⏮</button>
      <button onClick={() => onStep(-1)} disabled={disabled} title="Back (←)" aria-label="Back">◀</button>
      <button onClick={() => onStep(1)} disabled={disabled} title="Forward (→)" aria-label="Forward">▶</button>
      <button onClick={() => onStep("end")} disabled={disabled} title="Latest (End)" aria-label="Latest">⏭</button>
    </>
  );
}

/** ⏮ ◀ ▶ ⏭ under a puzzle or drill board on desktop (the game board has its own, next to the flip button). */
export function StepButtons(props: { onStep: (s: Step) => void; disabled?: boolean }) {
  return (
    <div className="side-controls">
      <div className="nav-buttons">
        <Buttons {...props} />
      </div>
    </div>
  );
}

/**
 * Phones: the same buttons in a slim row inside the board's frame, right under the board, so they
 * belong to the board (and the half-open chat sheet starts below them) instead of the chat's bar.
 */
export function BoardSteps({ children, ...props }: { onStep: (s: Step) => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className="board-steps nav-buttons">
      <Buttons {...props} />
      {children}
    </div>
  );
}
