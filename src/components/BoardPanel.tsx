import { useStore, boardMove, goto, step, openTangent, tangentPath, flip, newGame } from "../store";
import { Board } from "./Board";

/** Main board with the tangent breadcrumbs, step-through controls and move list. */
export function BoardPanel() {
  const { game, gamePly, tangents, active, orientation } = useStore();
  const tangent = active ? tangents[active] : null;
  const line = tangent ? tangent.line : game;
  const ply = tangent ? tangent.ply : gamePly;
  const path = tangentPath(active);
  const note = ply > 0 ? line.notes[ply - 1] : "";

  return (
    <main className="board-panel">
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
        <Board
          fen={line.fens[ply]}
          lastMove={ply > 0 ? line.lastMoves[ply - 1] : undefined}
          orientation={orientation}
          onMove={boardMove}
        />
      </div>

      <div className="controls">
        <button onClick={() => goto(0)} title="Start (Home)">⏮</button>
        <button onClick={() => step(-1)} title="Back (←)">◀</button>
        <button onClick={() => step(1)} title="Forward (→)">▶</button>
        <button onClick={() => goto(line.sans.length)} title="End (End)">⏭</button>
        <span className="spacer" />
        <button onClick={flip} title="Flip board">⇅</button>
        {!tangent && <button onClick={newGame}>New game</button>}
      </div>

      <div className="note">{note || " "}</div>

      <MoveList sans={line.sans} fens={line.fens} ply={ply} />
    </main>
  );
}

function MoveList({ sans, fens, ply }: { sans: string[]; fens: string[]; ply: number }) {
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
            </button>
          </span>
        );
      })}
    </div>
  );
}
