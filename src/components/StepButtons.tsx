import { useEffect, useRef, type ReactNode } from "react";
import type { Step } from "../chess/view";
import { touchNote } from "../touchLog";
import { buzz } from "../haptics";

/** How long ◀ is held before it opens the fat-finger recall. */
const RECALL_HOLD_MS = 3000;

/**
 * ◀ that steps back on a click and, held for three seconds, calls `onHold` instead: the hidden way
 * into the fat-finger recall (a rated game's takeback, a puzzle's voided misclick). Nothing on
 * screen points to it, on purpose.
 */
export function BackButton({ onStep, onHold, disabled }: { onStep: () => void; onHold?: () => void; disabled?: boolean }) {
  const timer = useRef(0);
  const held = useRef(false);
  const hold = useRef(onHold);
  hold.current = onHold;
  const stop = (why: string) => {
    if (timer.current) touchNote(`hold ◀ stopped: ${why}`);
    window.clearTimeout(timer.current);
    timer.current = 0;
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      onPointerDown={(e) => {
        held.current = false;
        stop("restart");
        if (!hold.current || e.button > 0) return;
        // A finger that drifts a little over three seconds stays this button's, not the page's.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not capturable (already released): the hold just ends with it.
        }
        touchNote("hold ◀ started");
        timer.current = window.setTimeout(() => {
          timer.current = 0;
          held.current = true;
          touchNote("hold ◀ → recall");
          buzz([30]);
          hold.current?.();
        }, RECALL_HOLD_MS);
      }}
      onPointerUp={() => stop("released")}
      // After a recall, the lift makes no mouse events: they'd land on the dialog that just opened.
      onTouchEnd={(e) => held.current && e.cancelable && e.preventDefault()}
      onPointerCancel={() => stop("cancelled by the browser")}
      // A mouse that leaves the button gives up; a finger is captured, so it can't wander off.
      onPointerLeave={(e) => e.pointerType === "mouse" && stop("mouse left")}
      // A long press on a phone mustn't open its menu (that would cancel the hold).
      onContextMenu={(e) => onHold && e.preventDefault()}
      onClick={() => {
        // The release after a recall isn't a step back too.
        if (held.current) held.current = false;
        else onStep();
      }}
      disabled={disabled}
      title="Back (←)"
      aria-label="Back"
      className="back-step"
    >
      ◀
    </button>
  );
}

interface StepProps {
  onStep: (s: Step) => void;
  disabled?: boolean;
  /** Holding ◀ for three seconds (see BackButton). */
  onHoldBack?: () => void;
}

function Buttons({ onStep, disabled, onHoldBack }: StepProps) {
  return (
    <>
      <button onClick={() => onStep("start")} disabled={disabled} title="Start (Home)" aria-label="Start">⏮</button>
      <BackButton onStep={() => onStep(-1)} onHold={onHoldBack} disabled={disabled} />
      <button onClick={() => onStep(1)} disabled={disabled} title="Forward (→)" aria-label="Forward">▶</button>
      <button onClick={() => onStep("end")} disabled={disabled} title="Latest (End)" aria-label="Latest">⏭</button>
    </>
  );
}

/** ⏮ ◀ ▶ ⏭ under a puzzle or drill board on desktop (the game board has its own, next to the flip button). */
export function StepButtons(props: StepProps) {
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
export function BoardSteps({ children, ...props }: StepProps & { children?: ReactNode }) {
  return (
    <div className="board-steps nav-buttons">
      <Buttons {...props} />
      {children}
    </div>
  );
}
