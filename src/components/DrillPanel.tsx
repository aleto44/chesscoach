import type { DrawShape } from "chessground/draw";
import { useEffect, useMemo, useState } from "react";
import {
  drillMove,
  drillQuestion,
  drillStep,
  drillTitle,
  nextDrill,
  retireCurrent,
  startDrills,
  stopDrills,
  useDrill,
  type DrillState,
} from "../analysis/drillSession";
import type { Explanation } from "../analysis/explain";
import { sendToCoach } from "../coach/bridge";
import { useAuth } from "../coach/auth";
import { hasBackend } from "../db";
import { useStore } from "../store";
import { Board } from "./Board";
import { BoardSteps, StepButtons } from "./StepButtons";
import { viewedPly } from "../chess/view";
import { Modal } from "./GameDialogs";
import { WhyLines } from "./Why";

const KIND_LABEL = { mistake: "From your games", opening: "Repertoire", coach: "From the coach", puzzle: "Missed puzzle" } as const;

/** Replaces the game board while a drill session runs. */
export function DrillPanel() {
  const s = useDrill()!;
  const busy = useStore((st) => st.busy);
  const signedIn = useAuth((a) => a.status === "signed-in") || !hasBackend();
  const drill = s.queue[s.index];
  const line = s.line;
  const ply = line ? viewedPly(line.sans.length, s.view) : 0;
  const past = line !== null && ply < line.sans.length;
  const shapes = useMemo(() => s.shapes as DrawShape[], [s.shapes]);
  const [whyOpen, setWhyOpen] = useState(false);
  useEffect(() => setWhyOpen(false), [s.index]);
  const side = drill ? (drill.color === "white" ? "White" : "Black") : "";
  const opponent = drill ? (drill.color === "white" ? "Black" : "White") : "";
  const lead = s.lead && s.status !== "intro" ? <span className="muted">{opponent} played {s.lead.label}. </span> : null;

  return (
    <main className="board-panel drills">
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
        <span className="crumb current">{drill ? drillTitle(drill) : s.status === "loading" ? "Drills" : "No drills due"}</span>
      </div>

      {drill && line ? (
        <>
          <div className="board-frame drill">
            <Board
              fen={line.fens[ply]}
              lastMove={ply > 0 ? line.lastMoves[ply - 1] : undefined}
              orientation={drill.color}
              onMove={drillMove}
              canMove={s.status === "solving" && !past}
              premoveColor={(s.status === "intro" || s.status === "solving") && !past ? drill.color : undefined}
              shapes={past ? undefined : shapes}
            />
            <BoardSteps onStep={drillStep} disabled={line.sans.length === 0} />
          </div>
          <StepButtons onStep={drillStep} disabled={line.sans.length === 0} />
          <div className={`drill-status ${s.status}`}>
            {s.status === "intro" && s.lead && `${opponent} plays ${s.lead.label}…`}
            {s.status === "loading" && "Setting up the next drill…"}
            {s.status === "solving" && past && (
              <>
                <strong>Looking back.</strong> Step forward (▶ or ⏭) to play on.
              </>
            )}
            {s.status === "solving" && !past && (
              <>
                {lead}
                {drill.kind === "opening"
                  ? `Play your ${drill.color} repertoire from memory.`
                  : drill.kind === "puzzle"
                    ? `${side} to move. Find the winning line${drill.note ? ` (${drill.note})` : ""}.`
                    : `${side} to move. Find a good move${drill.note ? ` (last time: ${drill.note})` : ""}.`}
              </>
            )}
            {s.status === "checking" && "Checking with the engine…"}
            {(s.status === "right" || s.status === "wrong") && (
              <>
                <strong>{s.status === "right" ? "✓ Correct." : "✗ Not quite."}</strong> {s.message}
                {s.nextDue && <span className="muted"> Next review {formatDue(s.nextDue)}.</span>}
              </>
            )}
          </div>
          {s.status === "wrong" && (drill.kind === "mistake" || drill.kind === "coach" || drill.kind === "puzzle") && (
            <WhySummary s={s} onOpen={() => setWhyOpen(true)} />
          )}
          {whyOpen && s.why && (
            <Modal title={`Why ${playedLabel(s)} isn't good`} onClose={() => setWhyOpen(false)} className="why-dialog">
              <div className="why-stats">
                <span>
                  Eval for you <strong>{s.why.evalBefore}</strong> → <strong>{s.why.evalAfter}</strong>
                </span>
                <span>
                  Winning chances <strong>{s.why.winBefore}%</strong> → <strong>{s.why.winAfter}%</strong>
                </span>
              </div>
              <WhyLines ex={s.why} playedSan={playedSan(s)} orientation={drill.color} />
            </Modal>
          )}
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
      ) : s.status === "loading" ? (
        <div className="drill-done">
          <p className="muted">Setting up your drills…</p>
        </div>
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

const playedSan = (s: DrillState) => s.line?.sans[s.base] ?? "";
/** "14.g5". */
const playedLabel = (s: DrillState) => s.why?.played.steps[0]?.label ?? playedSan(s);

/**
 * Why the answer was wrong, in words: what the opponent does against it and what that comes to,
 * then what the better move does. The full lines open on their own board.
 */
function WhySummary({ s, onOpen }: { s: DrillState; onOpen: () => void }) {
  const ex: Explanation | null = s.why;
  if (!ex) return <div className="drill-why muted">{s.whyFailed ? "The engine couldn't work out why." : "Working out why…"}</div>;
  const reply = ex.played.steps[1];
  const better = ex.better;
  return (
    <div className="drill-why">
      <p className="bad">
        <strong>Why {ex.played.steps[0]?.san ?? playedSan(s)} is bad:</strong> {reply ? `${reply.note} ` : ""}
        {ex.played.verdict}
      </p>
      {ex.alternatives?.length > 1 ? (
        <p className="good">
          <strong>Better:</strong> {ex.betterSummary.replace(/ Pick one to see the reply\.$/, "")}
        </p>
      ) : better && (
        <p className="good">
          <strong>Why {better.steps[0]?.san} is better:</strong> {better.steps[0]?.note}
          {better.steps.length > 1 && (
            <span className="muted">
              {" "}
              ({better.steps.map((st) => st.label).join(" ")})
            </span>
          )}{" "}
          {better.verdict}
        </p>
      )}
      <button className="why-button" onClick={onOpen}>
        Step through both lines on a board ›
      </button>
    </div>
  );
}

function formatDue(sqlite: string): string {
  const due = new Date(sqlite.replace(" ", "T") + "Z");
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
