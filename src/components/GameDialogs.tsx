import { useEffect, useState, type ReactNode } from "react";
import { db, opponentElo, type GameSummary } from "../db";
import { OPPONENT_LEVELS } from "../engine/stockfish";
import { loadGame, newGame } from "../game/session";
import { opponentLabel, useStore, type Color } from "../store";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <span className="spacer" />
          <button onClick={onClose}>✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function NewGameDialog({ onClose }: { onClose: () => void }) {
  const last = useStore((s) => s.meta);
  const [elo, setElo] = useState<number | null>(last.opponentElo ?? 1500);
  const [color, setColor] = useState<Color | "random">(last.studentColor === "black" ? "black" : "white");

  const start = async () => {
    const studentColor: Color | "both" =
      elo === null ? "both" : color === "random" ? (Math.random() < 0.5 ? "white" : "black") : color;
    await newGame({ studentColor, opponentElo: elo });
    onClose();
  };

  return (
    <Modal title="New game" onClose={onClose}>
      <label className="field">
        <span>Opponent</span>
        <select value={elo ?? ""} onChange={(e) => setElo(e.target.value ? Number(e.target.value) : null)}>
          {OPPONENT_LEVELS.map((l) => (
            <option key={l} value={l}>
              Stockfish {l}
            </option>
          ))}
          <option value="">None (free play, move both sides)</option>
        </select>
      </label>
      {elo !== null && (
        <div className="field">
          <span>You play</span>
          <div className="segmented">
            {(["white", "black", "random"] as const).map((c) => (
              <button key={c} className={color === c ? "on" : ""} onClick={() => setColor(c)}>
                {c[0].toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}
      <footer>
        <button className="primary" onClick={start}>
          Start game
        </button>
      </footer>
    </Modal>
  );
}

export function GamesDialog({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.gameId);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.listGames(200).then(setGames, (e) => setError(String(e)));
  }, []);

  const open = async (id: number) => {
    await loadGame(id);
    onClose();
  };

  return (
    <Modal title="Games" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {games?.length === 0 && <p className="muted">No games yet.</p>}
      <div className="game-list">
        {games?.map((g) => (
          <button key={g.id} className={`game-row ${g.id === current ? "current" : ""}`} onClick={() => open(g.id)}>
            <div className="game-row-top">
              <strong>{describeSides(g)}</strong>
              <span className={`result ${outcome(g)}`}>{g.result ?? "in progress"}</span>
            </div>
            <div className="game-row-sub">
              {formatDate(g.updatedAt)} · {Math.ceil(g.plies / 2)} moves
              {g.termination ? ` · ${g.termination}` : ""}
            </div>
            {g.opening && <div className="game-row-moves">{numbered(g.opening)}…</div>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function describeSides(g: GameSummary): string {
  const opp = opponentLabel({ studentColor: g.studentColor, opponentElo: opponentElo(g.opponent), result: null, termination: null });
  if (g.studentColor === "both") return opp;
  return g.studentColor === "white" ? `You vs ${opp}` : `${opp} vs You`;
}

function outcome(g: GameSummary): string {
  if (!g.result || g.studentColor === "both") return "";
  if (g.result === "1/2-1/2") return "draw";
  return (g.result === "1-0") === (g.studentColor === "white") ? "win" : "loss";
}

function numbered(sans: string): string {
  return sans
    .split(" ")
    .map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s))
    .join(" ");
}

/** SQLite datetime('now') is UTC without a zone marker. */
function formatDate(sqlite: string): string {
  return new Date(sqlite.replace(" ", "T") + "Z").toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
