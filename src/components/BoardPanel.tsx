import { useState } from "react";
import { resign, switchToPractice, takeBack, takebackPly } from "../game/session";
import {
  useStore,
  boardMove,
  goto,
  step,
  openTangent,
  tangentPath,
  flip,
  canStudentMove,
  isLocked,
  opponentLabel,
} from "../store";
import { Board } from "./Board";
import { GamesDialog, NewGameDialog } from "./GameDialogs";
import { SettingsDialog } from "./SettingsDialog";
import { EvalBar, EvalLine } from "./EvalBar";
import { ModeBadge } from "./ModeBadge";
import { ClockRow } from "./Clock";
import { markFor, ReviewBar, useMoment } from "./Review";
import { saveSetting, useSettings } from "../settings";

/** Main board with the tangent breadcrumbs, step-through controls and move list. */
export function BoardPanel() {
  const { game, gamePly, tangents, active, orientation, meta, opponentThinking, annotations, arrows } = useStore();
  const moment = useMoment();
  const locked = isLocked(meta);
  const showEval = useSettings((s) => s.showEval) && !locked;
  const canTakeBack = takebackPly(game, meta) !== null;
  const [dialog, setDialog] = useState<"new" | "games" | "settings" | null>(null);
  const tangent = active ? tangents[active] : null;
  const line = tangent ? tangent.line : game;
  const ply = tangent ? tangent.ply : gamePly;
  const path = tangentPath(active);
  const note = ply > 0 ? line.notes[ply - 1] : "";

  return (
    <main className={`board-panel ${meta.timeControl ? "timed" : ""}`}>
      <div className="game-bar">
        <span className="game-status">
          {meta.studentColor !== "both" && <ModeBadge mode={meta.mode} />}
          <strong>{opponentLabel(meta)}</strong>
          {meta.studentColor !== "both" && <span className="muted"> · you play {meta.studentColor}</span>}
          <span className="status-text"> · {gameStatus(meta, opponentThinking, game.fens[game.sans.length])}</span>
        </span>
        <span className="spacer" />
        <button onClick={() => setDialog("games")}>Games</button>
        <button onClick={() => setDialog("new")}>New game</button>
        {locked && (
          <button
            onClick={() =>
              confirm(
                "Switch this game to practice?\n\nThe engine, coach and takebacks turn on, and the game stops counting as a rated game. This can't be undone.",
              ) && switchToPractice()
            }
            title="Turn on the engine, coach and takebacks for this game"
          >
            Get help
          </button>
        )}
        {meta.studentColor !== "both" && !meta.result && game.sans.length > 0 && (
          <button onClick={() => confirm("Resign this game?") && resign()}>Resign</button>
        )}
        <button className="icon" onClick={() => setDialog("settings")} title="Settings" aria-label="Settings">
          ⚙
        </button>
      </div>
      {dialog === "new" && <NewGameDialog onClose={() => setDialog(null)} />}
      {dialog === "games" && <GamesDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}

      <nav className="crumbs">
        <button className={`crumb ${active ? "" : "current"}`} onClick={() => openTangent(null)}>
          Game
        </button>
        {path.map((t) => (
          <span key={t.id}>
            <span className="sep">›</span>
            <button className={`crumb ${t.id === active ? "current" : ""}`} onClick={() => openTangent(t.id)}>
              {t.title}
            </button>
          </span>
        ))}
        {tangent && (
          <button className="return" onClick={() => openTangent(null)}>
            Return to game
          </button>
        )}
      </nav>

      {meta.timeControl && <ClockRow side={orientation === "white" ? "black" : "white"} />}
      <div className={`board-frame ${tangent ? "tangent" : ""}`}>
        {!locked && (
          <button
            className={`eval-toggle ${showEval ? "on" : ""}`}
            onClick={() => saveSetting("showEval", !showEval)}
            title={showEval ? "Hide engine evaluation" : "Show engine evaluation"}
            aria-pressed={showEval}
          >
            <span className="eval-toggle-icon" />
          </button>
        )}
        {showEval && <EvalBar orientation={orientation} />}
        <Board
          fen={line.fens[ply]}
          lastMove={ply > 0 ? line.lastMoves[ply - 1] : undefined}
          orientation={orientation}
          onMove={boardMove}
          canMove={canStudentMove()}
          shapes={moment?.shapes ?? (arrows?.fen === line.fens[ply] ? arrows.shapes : undefined)}
          premoveColor={
            !tangent && !meta.result && meta.studentColor !== "both" && gamePly === game.sans.length
              ? meta.studentColor
              : undefined
          }
        />
      </div>

      {meta.timeControl && <ClockRow side={orientation} />}

      <div className="controls">
        <button onClick={() => goto(0)} title="Start (Home)">⏮</button>
        <button onClick={() => step(-1)} title="Back (←)">◀</button>
        <button onClick={() => step(1)} title="Forward (→)">▶</button>
        <button onClick={() => goto(line.sans.length)} title="End (End)">⏭</button>
        <span className="spacer" />
        {meta.mode === "practice" && meta.studentColor !== "both" && !tangent && (
          <button onClick={takeBack} disabled={!canTakeBack} title="Take back your last move">
            ↶ Take back
          </button>
        )}
        <button onClick={flip} title="Flip board">⇅</button>
      </div>

      <ReviewBar />

      {showEval && <EvalLine />}

      <div className={`note ${moment ? "moment" : ""}`}>{moment?.text || note || " "}</div>

      <MoveList sans={line.sans} fens={line.fens} ply={ply} marks={tangent ? undefined : annotations.map(markFor)} />
    </main>
  );
}

function gameStatus(meta: ReturnType<typeof useStore.getState>["meta"], thinking: boolean, endFen: string): string {
  if (meta.result) {
    const mine = meta.studentColor === "both" ? "" : meta.result === "1/2-1/2" ? " (draw)" : (meta.result === "1-0") === (meta.studentColor === "white") ? " (you won)" : " (you lost)";
    return `${meta.result} by ${meta.termination}${mine}`;
  }
  if (meta.studentColor === "both") return "move both sides";
  if (thinking) return "opponent is thinking…";
  const turn = endFen.split(" ")[1] === "w" ? "white" : "black";
  return turn === meta.studentColor ? "your move" : "opponent to move";
}

function MoveList({ sans, fens, ply, marks }: { sans: string[]; fens: string[]; ply: number; marks?: string[] }) {
  if (sans.length === 0) return <div className="moves empty">No moves yet. Drag a piece to play.</div>;
  return (
    <div className="moves">
      {sans.map((san, i) => {
        const [, turn, , , , full] = fens[i].split(" ");
        const num = turn === "w" ? `${full}.` : i === 0 ? `${full}...` : "";
        return (
          <span key={i}>
            {num && <span className="num">{num}</span>}
            <button className={`mv ${i + 1 === ply ? "current" : ""}`} onClick={() => goto(i + 1)}>
              {san}
              {marks?.[i] && <span className={`mark m${marks[i].length}${marks[i] === "?!" ? "i" : ""}`}>{marks[i]}</span>}
            </button>
          </span>
        );
      })}
    </div>
  );
}
