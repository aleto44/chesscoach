import { useMemo } from "react";
import type { DrawShape } from "chessground/draw";
import { sendToCoach } from "../coach/bridge";
import { useAuth } from "../coach/auth";
import { viewedPly } from "../chess/view";
import { hasBackend } from "../db";
import { ENDGAMES, type Endgame } from "../endgames/positions";
import {
  endgameHint,
  endgameMove,
  endgameOf,
  endgameQuestion,
  endgameRecords,
  endgameStep,
  nextEndgame,
  retryEndgame,
  startEndgame,
  stopEndgame,
  useEndgame,
} from "../endgames/session";
import { isLocked, useStore } from "../store";
import { Board } from "./Board";
import { BoardSteps, StepButtons } from "./StepButtons";

const GOAL: Record<Endgame["goal"], string> = { mate: "Mate", promote: "Win", draw: "Hold the draw" };
const LEVEL = ["", "Basic", "Intermediate", "Hard"];

/** School › Endgame trainer: the positions, grouped, with how the student has done in each. */
export function EndgameMenu() {
  const records = endgameRecords();
  const groups = [...new Set(ENDGAMES.map((e) => e.group))];
  const solved = ENDGAMES.filter((e) => records[e.id]?.wins).length;
  return (
    <>
      <h2 className="section-title">Endgame trainer</h2>
      <p className="section-lede muted">
        The endings every player needs, against full-strength Stockfish. Win them (or hold them) against the best
        defence; a move that throws the result away ends the try, with the reason. Mastered {solved} of {ENDGAMES.length}.
      </p>
      {groups.map((g) => (
        <div key={g}>
          <h3 className="sub-title">{g}</h3>
          <div className="history-list">
            {ENDGAMES.filter((e) => e.group === g).map((e) => {
              const r = records[e.id];
              return (
                <div key={e.id} className={`history-row ${r?.last === "won" ? "right" : r?.last === "failed" ? "wrong" : ""}`}>
                  <span className="history-mark">{r?.wins ? "✓" : r?.tries ? "·" : ""}</span>
                  <span className="history-main">
                    <span>{e.name}</span>
                    <span className="muted small">
                      {GOAL[e.goal]} as {e.side} · {LEVEL[e.level]}
                      {r ? ` · ${r.wins} of ${r.tries} tries` : ""}
                    </span>
                  </span>
                  <span className="history-side">
                    <button onClick={() => startEndgame(e.id)}>
                      {r?.wins ? "Again" : "Play"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/** Replaces the game board while an endgame runs. */
export function EndgamePanel() {
  const s = useEndgame()!;
  const busy = useStore((st) => st.busy);
  // A rated game in progress keeps the coach off, wherever the student is.
  const locked = useStore((st) => isLocked(st.meta));
  const signedIn = useAuth((a) => a.status === "signed-in") || !hasBackend();
  const e = endgameOf(s);
  const ply = viewedPly(s.line.sans.length, s.view);
  const past = ply < s.line.sans.length;
  const shapes = useMemo(() => s.shapes as DrawShape[], [s.shapes]);
  const over = s.status === "won" || s.status === "held" || s.status === "failed";
  const goal = e.goal === "draw" ? `Hold the draw for ${e.moves ?? 15} moves` : e.goal === "mate" ? "Deliver checkmate" : "Promote and keep the win";

  return (
    <main className="board-panel drills tall-status">
      <div className="game-bar">
        <span className="game-status">
          <strong>Endgame trainer</strong>
          <span className="muted"> · {e.group}</span>
        </span>
        <span className="spacer" />
        <button onClick={stopEndgame}>‹ Endgames</button>
      </div>
      <div className="crumbs">
        <span className="crumb current">{e.name}</span>
      </div>
      <div className="board-frame drill">
        <Board
          fen={s.line.fens[ply]}
          lastMove={ply > 0 ? s.line.lastMoves[ply - 1] : undefined}
          orientation={e.side}
          onMove={endgameMove}
          canMove={s.status === "playing" && !past}
          premoveColor={!over && !past ? e.side : undefined}
          shapes={past ? undefined : shapes}
        />
        <BoardSteps onStep={endgameStep} disabled={s.line.sans.length === 0} />
      </div>
      <StepButtons onStep={endgameStep} disabled={s.line.sans.length === 0} />
      <div className={`drill-status ${s.status === "failed" ? "wrong" : over ? "right" : "solving"}`}>
        {past && !over ? (
          <>
            <strong>Looking back.</strong> Step forward (▶ or ⏭) to play on.
          </>
        ) : over ? (
          <>
            <strong>{s.status === "failed" ? "✗ " : "✓ "}</strong>
            {s.message}
          </>
        ) : (
          <>
            You play {e.side}. {goal}.{s.status === "thinking" && <span className="muted"> Stockfish is thinking…</span>}
            {s.moves > 0 && <span className="muted"> Move {s.moves}.</span>}
          </>
        )}
        {s.hint && <span className="status-extra muted">{e.hint}</span>}
      </div>
      <div className="controls">
        {over ? (
          <>
            <button className="primary" onClick={retryEndgame}>
              Try again
            </button>
            <button onClick={nextEndgame}>Next ending</button>
          </>
        ) : (
          <button onClick={endgameHint} disabled={s.status !== "playing"}>
            Hint
          </button>
        )}
        {signedIn && !locked && (
          <button onClick={() => sendToCoach(endgameQuestion())} disabled={busy} title="One message to the coach">
            Ask the coach
          </button>
        )}
      </div>
    </main>
  );
}
