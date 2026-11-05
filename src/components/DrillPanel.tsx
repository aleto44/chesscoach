import type { DrawShape } from "chessground/draw";
import { useMemo } from "react";
import { drillMove, drillQuestion, nextDrill, retireCurrent, startDrills, stopDrills, useDrill } from "../analysis/drillSession";
import { sendToCoach } from "../coach/bridge";
import { useAuth } from "../coach/auth";
import { hasBackend } from "../db";
import { useStore } from "../store";
import { Board } from "./Board";

const KIND_LABEL = { mistake: "From your games", opening: "Repertoire", coach: "From the coach", puzzle: "Missed puzzle" } as const;

/** Replaces the game board while a drill session runs. */
export function DrillPanel() {
  const s = useDrill()!;
  const busy = useStore((st) => st.busy);
  const signedIn = useAuth((a) => a.status === "signed-in") || !hasBackend();
  const drill = s.queue[s.index];
  const line = s.line;
  const ply = line ? line.sans.length : 0;
  const shapes = useMemo(() => s.shapes as DrawShape[], [s.shapes]);

  return (
    <main className="board-panel">
      <div className="game-bar">
        <span className="game-status">
          <strong>Drills</strong>
          {drill && (
            <span className="muted">
              {" "}
              · {s.index + 1} of {s.queue.length} · {KIND_LABEL[drill.kind]}
            </span>
          )}
        </span>
        <span className="spacer" />
        <button onClick={stopDrills}>‹ Drills menu</button>
      </div>

      <div className="crumbs">
        <span className="crumb current">{drill ? drill.title : "No drills due"}</span>
      </div>

      {drill && line ? (
        <>
          <div className="board-frame drill">
            <Board
              fen={line.fens[ply]}
              lastMove={ply > 0 ? line.lastMoves[ply - 1] : undefined}
              orientation={drill.color}
              onMove={drillMove}
              canMove={s.status === "solving"}
              shapes={shapes}
            />
          </div>
          <div className={`drill-status ${s.status}`}>
            {s.status === "solving" &&
              (drill.kind === "opening"
                ? `Play your ${drill.color} repertoire from memory.`
                : drill.kind === "puzzle"
                  ? `${drill.color === "white" ? "White" : "Black"} to move. Find the winning line${drill.note ? ` (${drill.note})` : ""}.`
                : `${drill.color === "white" ? "White" : "Black"} to move. Find a good move${drill.note ? ` (last time: ${drill.note})` : ""}.`)}
            {s.status === "checking" && "Checking with the engine…"}
            {(s.status === "right" || s.status === "wrong") && (
              <>
                <strong>{s.status === "right" ? "✓ Correct." : "✗ Not quite."}</strong> {s.message}
                {s.nextDue && <span className="muted"> Next review {formatDue(s.nextDue)}.</span>}
              </>
            )}
          </div>
          <div className="controls">
            {(s.status === "right" || s.status === "wrong") && (
              <>
                <button className="primary" onClick={nextDrill}>
                  Next
                </button>
                {s.status === "wrong" && signedIn && (
                  <button onClick={() => sendToCoach(drillQuestion())} disabled={busy} title="One message to the coach">
                    Ask the coach why
                  </button>
                )}
              </>
            )}
            <span className="spacer" />
            <button onClick={retireCurrent} title="Don't show this drill again">
              Retire drill
            </button>
          </div>
        </>
      ) : (
        <div className="drill-done">
          <p>
            {s.queue.length
              ? `Done: ${s.correct} of ${s.queue.length} correct.`
              : "Nothing is due right now. Drills come from mistakes in your analyzed games and from your repertoire."}
          </p>
          <div className="controls">
            <button onClick={() => startDrills(true)}>Practice all drills anyway</button>
            <button className="primary" onClick={stopDrills}>
              Back to drills
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function formatDue(sqlite: string): string {
  const due = new Date(sqlite.replace(" ", "T") + "Z");
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
