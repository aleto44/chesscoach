import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Chess } from "chess.js";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import {
  analysisFlip,
  analysisGoto,
  analysisMove,
  analysisPlay,
  analysisStep,
  closeAnalysis,
  openAnalysis,
  pvSteps,
  useAnalysis,
  useCanAnalyze,
} from "../analysis/layer";
import { setEvalFocus, TOP_LINES, useEval } from "../engine/live";
import { formatScore, type EngineLine } from "../engine/stockfish";
import { Board } from "./Board";
import { MoveList } from "./BoardPanel";
import { EvalBar } from "./EvalBar";
import { MaterialStrip } from "./Material";
import { BoardSteps } from "./StepButtons";

/** The live engine's lines for `fen`: empty while it's still on another position. */
export function useEngineLines(fen: string): EngineLine[] {
  const evalFen = useEval((s) => s.fen);
  const lines = useEval((s) => s.lines);
  return evalFen === fen ? lines : [];
}

/** The top bar's button: opens the analysis board on the position on screen, or closes it. */
export function AnalysisButton() {
  const open = useAnalysis((a) => a !== null);
  const can = useCanAnalyze();
  if (!open && !can) return null;
  return (
    <button
      className={`icon analysis-button ${open ? "on" : ""}`}
      onClick={open ? closeAnalysis : openAnalysis}
      title={open ? "Close the analysis board" : "Analyze this position: engine lines and your own moves"}
      aria-label="Analysis board"
      aria-pressed={open}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M15 15l5.5 5.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M6.5 11.5l2-2 1.5 1.5 3-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * The analysis board: the position it was opened on with that screen's moves, the student's own
 * moves for both sides forking off them, and the engine always on with its top lines.
 */
export function AnalysisPanel() {
  const a = useAnalysis()!;
  const { x, orientation, from } = a;
  const fen = x.line.fens[x.ply];
  const forked = x.forkAt !== null;
  const top = orientation === "white" ? "black" : "white";

  // This board has the live engine while it's open, with several lines; the screen below gets it back on close.
  useEffect(() => setEvalFocus(fen, TOP_LINES), [fen]);
  useEffect(() => () => setEvalFocus(null), []);

  const current = useEngineLines(fen);
  // The engine's first moves as arrows, the best one strongest. Keyed by the moves, so deeper search
  // that keeps the same first moves doesn't redraw the board.
  const firsts = current.map((l) => l.pv[0] ?? "").join(" ");
  const shapes = useMemo<DrawShape[]>(
    () =>
      firsts
        .split(" ")
        .map((uci, k) => ({ uci, k }))
        .filter(({ uci }) => uci)
        .map(({ uci, k }) => ({ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush: k === 0 ? "paleBlue" : "paleGrey" }))
        .reverse(),
    [firsts],
  );

  // Engine updates re-render this panel several times a second; the move list only changes with the moves.
  const moveList = useMemo(
    () => <MoveList sans={x.line.sans} fens={x.line.fens} ply={x.ply} forkAt={x.forkAt} onGoto={analysisGoto} />,
    [x.line.sans, x.line.fens, x.ply, x.forkAt],
  );

  return (
    <main className="board-panel play analysis">
      <nav className="crumbs">
        <button className="crumb" onClick={closeAnalysis}>
          {from[0].toUpperCase() + from.slice(1)}
        </button>
        <span className="sep">›</span>
        <span className="crumb current">Analysis</span>
        <button className="return" onClick={closeAnalysis}>
          Back to the {from}
        </button>
      </nav>

      <div className="board-frame with-eval">
        <EvalBar orientation={orientation} />
        <MaterialStrip fen={fen} side={top} />
        <Board
          fen={fen}
          orientation={orientation}
          lastMove={x.ply > 0 ? x.line.lastMoves[x.ply - 1] : undefined}
          onMove={analysisMove}
          shapes={shapes}
        />
        <MaterialStrip fen={fen} side={orientation} />
        <BoardSteps onStep={analysisStep}>
          <button className="icon" onClick={analysisFlip} title="Flip board" aria-label="Flip board">⇅</button>
        </BoardSteps>
      </div>

      <aside className="game-side">
        <div className="game-head">
          <strong>Analysis</strong>
          <span className="spacer" />
          <span className="muted small">{current[0] ? `depth ${current[0].depth}` : "Stockfish"}</span>
        </div>
        <EngineLines fen={fen} lines={current} orientation={orientation} onPlay={analysisPlay} />
        <div className="side-body">
          {moveList}
          {forked && (
            <div className="note fork-note">
              <span>
                <strong>What if…</strong> Your own moves. Step back past them to get the {from}'s moves back.
              </span>
              <button onClick={() => analysisGoto(x.forkAt!)}>Back to the {from}</button>
            </div>
          )}
        </div>
        <div className="side-controls">
          <div className="nav-buttons">
            <button onClick={() => analysisStep("start")} title="Start (Home)" aria-label="Start">⏮</button>
            <button onClick={() => analysisStep(-1)} title="Back (←)" aria-label="Back">◀</button>
            <button onClick={() => analysisStep(1)} title="Forward (→)" aria-label="Forward">▶</button>
            <button onClick={() => analysisStep("end")} title="End (End)" aria-label="End">⏭</button>
          </div>
          <button className="icon" onClick={analysisFlip} title="Flip board" aria-label="Flip board">⇅</button>
        </div>
      </aside>
    </main>
  );
}

/**
 * The engine's best lines: score, then the moves, each one showing its position when hovered.
 * `onPlay` gets the line's moves up to the one clicked (the score: just the first).
 */
export function EngineLines({
  fen,
  lines,
  orientation,
  onPlay,
}: {
  fen: string;
  lines: EngineLine[];
  orientation: "white" | "black";
  onPlay: (uci: string[]) => void;
}) {
  const over = useMemo(() => {
    const c = new Chess(fen);
    return c.isCheckmate() ? "Checkmate" : c.isStalemate() ? "Stalemate" : c.isDraw() ? "Draw" : null;
  }, [fen]);
  if (over) return <div className="engine-lines muted small">{over}</div>;
  return (
    <div className="engine-lines">
      {Array.from({ length: TOP_LINES }, (_, k) =>
        lines[k] ? (
          <PvRow key={k} fen={fen} line={lines[k]} orientation={orientation} onPlay={onPlay} />
        ) : (
          <div key={k} className="pv-row pending">
            <span className="pv-score">…</span>
          </div>
        ),
      )}
    </div>
  );
}

function PvRow({
  fen,
  line,
  orientation,
  onPlay,
}: {
  fen: string;
  line: EngineLine;
  orientation: "white" | "black";
  onPlay: (uci: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{ i: number; rect: DOMRect } | null>(null);
  // Keyed by the moves: a new depth with the same line skips replaying it.
  const pv = line.pv.slice(0, 20).join(" ");
  const steps = useMemo(() => pvSteps(fen, pv.split(" ")), [fen, pv]);
  const shown = hover && steps[hover.i];
  const good = line.mate !== undefined ? line.mate > 0 : (line.cp ?? 0) >= 0;
  return (
    <div className={`pv-row ${open ? "open" : ""}`}>
      <button className={`pv-score ${good ? "for-white" : "for-black"}`} onClick={() => onPlay(line.pv.slice(0, 1))} title="Play the first move">
        {formatScore(line)}
      </button>
      <span className="pv-moves" onMouseLeave={() => setHover(null)}>
        {steps.map((s, i) => (
          <button
            key={i}
            className="pv-move"
            onMouseEnter={(e) => setHover({ i, rect: e.currentTarget.getBoundingClientRect() })}
            onClick={() => {
              setHover(null);
              onPlay(line.pv.slice(0, i + 1));
            }}
          >
            {s.label}
          </button>
        ))}
      </span>
      <button className="pv-more" onClick={() => setOpen(!open)} aria-label={open ? "Show less" : "Show the whole line"} aria-expanded={open}>
        ▾
      </button>
      {shown && hover && <PvThumb fen={shown.fen} lastMove={[shown.from, shown.to]} orientation={orientation} rect={hover.rect} />}
    </div>
  );
}

const THUMB = 168;

/** The position after a hovered move, in a small board by the move (outside the side column, which clips). */
function PvThumb({ fen, lastMove, orientation, rect }: { fen: string; lastMove: [Key, Key]; orientation: "white" | "black"; rect: DOMRect }) {
  const left = Math.max(8, Math.min(window.innerWidth - THUMB - 8, rect.left + rect.width / 2 - THUMB / 2));
  const below = rect.bottom + THUMB + 12 < window.innerHeight;
  const top = below ? rect.bottom + 6 : rect.top - THUMB - 6;
  return createPortal(
    <div className="pv-thumb" style={{ left, top, width: THUMB, height: THUMB }}>
      <Board fen={fen} lastMove={lastMove} orientation={orientation} preview coordinates={false} className="pv-thumb-board" />
    </div>,
    document.body,
  );
}
