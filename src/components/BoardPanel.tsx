import { useEffect, useRef } from "react";
import { resign, switchToPractice, takeBack, takebackPly } from "../game/session";
import { timeControlLabel } from "../game/clock";
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
  type GameMeta,
} from "../store";
import { Board } from "./Board";
import { askConfirm } from "./Confirm";
import { EvalBar, EvalLine } from "./EvalBar";
import { ModeBadge } from "./ModeBadge";
import { PlayerCard } from "./Clock";
import { markFor, ReviewBar, useMoment } from "./Review";
import { saveSetting, useSettings } from "../settings";

/**
 * The board, with a side column like lichess's: the player at the top of the board, the moves and
 * controls, then the player at the bottom.
 */
export function BoardPanel() {
  const { game, gamePly, tangents, active, orientation, meta, opponentThinking, annotations, arrows } = useStore();
  const moment = useMoment();
  const locked = isLocked(meta);
  const showEval = useSettings((s) => s.showEval) && !locked;
  const canTakeBack = takebackPly(game, meta) !== null;
  const tangent = active ? tangents[active] : null;
  const line = tangent ? tangent.line : game;
  const ply = tangent ? tangent.ply : gamePly;
  const path = tangentPath(active);
  const note = ply > 0 ? line.notes[ply - 1] : "";
  const vsOpponent = meta.studentColor !== "both";
  const inProgress = vsOpponent && !meta.result;
  const top = orientation === "white" ? "black" : "white";

  const confirmResign = async () => {
    if (await askConfirm({ title: "Resign this game?", body: `${opponentLabel(meta)} wins.`, confirmLabel: "Resign", danger: true }))
      resign();
  };
  const confirmHelp = async () => {
    const ok = await askConfirm({
      title: "Switch to practice?",
      body: "The engine, coach and takebacks turn on, and this game stops counting as rated. This can't be undone.",
      confirmLabel: "Switch to practice",
    });
    if (ok) switchToPractice();
  };

  return (
    <main className="board-panel play">
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

      <aside className="game-side">
        <div className="game-head">
          {vsOpponent ? <ModeBadge mode={meta.mode} /> : <strong>Free play</strong>}
          {meta.timeControl && <span className="muted">{timeControlLabel(meta.timeControl)}</span>}
          <span className="spacer" />
          <span className={`game-state ${meta.result ? "over" : ""}`}>
            {gameStatus(meta, opponentThinking, game.fens[game.sans.length])}
          </span>
        </div>

        <PlayerCard side={top} />

        <div className="side-body">
          <MoveList sans={line.sans} fens={line.fens} ply={ply} marks={tangent ? undefined : annotations.map(markFor)} />
          {showEval && <EvalLine />}
          {(moment?.text || note) && <div className={`note ${moment ? "moment" : ""}`}>{moment?.text || note}</div>}
          <ReviewBar />
        </div>

        <div className="side-controls">
          <div className="nav-buttons">
            <button onClick={() => goto(0)} title="Start (Home)" aria-label="Start">⏮</button>
            <button onClick={() => step(-1)} title="Back (←)" aria-label="Back">◀</button>
            <button onClick={() => step(1)} title="Forward (→)" aria-label="Forward">▶</button>
            <button onClick={() => goto(line.sans.length)} title="End (End)" aria-label="End">⏭</button>
          </div>
          <button className="icon" onClick={flip} title="Flip board" aria-label="Flip board">⇅</button>
        </div>

        {inProgress && !tangent && (
          <div className="side-actions">
            {meta.mode === "practice" && (
              <button onClick={takeBack} disabled={!canTakeBack} title="Take back your last move">
                ↶ Take back
              </button>
            )}
            {locked && (
              <button onClick={confirmHelp} title="Turn on the engine, coach and takebacks for this game">
                Get help
              </button>
            )}
            <button className="resign" onClick={confirmResign} disabled={game.sans.length === 0}>
              ⚑ Resign
            </button>
          </div>
        )}

        <PlayerCard side={orientation} />
      </aside>
    </main>
  );
}

function gameStatus(meta: GameMeta, thinking: boolean, endFen: string): string {
  if (meta.result) {
    const mine =
      meta.studentColor === "both"
        ? ""
        : meta.result === "1/2-1/2"
          ? "Draw"
          : (meta.result === "1-0") === (meta.studentColor === "white")
            ? "You won"
            : "You lost";
    return `${mine ? `${mine} · ` : ""}${meta.termination ?? meta.result}`;
  }
  if (meta.studentColor === "both") return "Move both sides";
  if (thinking) return "Thinking…";
  const turn = endFen.split(" ")[1] === "w" ? "white" : "black";
  return turn === meta.studentColor ? "Your move" : "Their move";
}

/** Moves in rows, one per move number, scrolled to keep the current move in view. */
function MoveList({ sans, fens, ply, marks }: { sans: string[]; fens: string[]; ply: number; marks?: string[] }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    const current = el?.querySelector<HTMLElement>(".mv.current");
    if (!el) return;
    if (current) current.scrollIntoView({ block: "nearest" });
    else if (ply === 0) el.scrollTop = 0;
  }, [ply, sans.length]);

  if (sans.length === 0) return <div className="moves empty">No moves yet. Drag a piece to play.</div>;

  const rows: { num: string; cells: (number | null)[] }[] = [];
  sans.forEach((_, i) => {
    const [, turn, , , , full] = fens[i].split(" ");
    if (turn === "w" || i === 0) rows.push({ num: full, cells: turn === "w" ? [i] : [null, i] });
    else rows[rows.length - 1].cells.push(i);
  });

  return (
    <div className="moves" ref={list}>
      {rows.map((r) => (
        <div className="move-row" key={r.num}>
          <span className="num">{r.num}.</span>
          {[0, 1].map((c) => {
            const i = r.cells[c];
            if (i === undefined) return <span key={c} />;
            if (i === null) return <span key={c} className="mv muted">…</span>;
            return (
              <button key={c} className={`mv ${i + 1 === ply ? "current" : ""}`} onClick={() => goto(i + 1)}>
                {sans[i]}
                {marks?.[i] && <span className={`mark m${marks[i].length}${marks[i] === "?!" ? "i" : ""}`}>{marks[i]}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
