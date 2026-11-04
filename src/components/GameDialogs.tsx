import { useEffect, useState, type ReactNode } from "react";
import { db, opponentElo, type GameSummary } from "../db";
import { OPPONENT_RATING } from "../engine/stockfish";
import { deleteGame, loadGame, newGame } from "../game/session";
import { FREE_PLAY, opponentLabel, useStore, type Color, type GameMode } from "../store";
import { ModeBadge } from "./ModeBadge";

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
  const [mode, setMode] = useState<GameMode>(last.mode);
  const [hasOpponent, setHasOpponent] = useState(last.studentColor !== "both" || last.opponentElo !== null);
  const [rating, setRating] = useState(last.opponentElo ?? 1500);
  // A rated game is always against an opponent.
  const elo = hasOpponent || mode === "rated" ? rating : null;
  const [color, setColor] = useState<Color | "random">(last.studentColor === "black" ? "black" : "white");

  const start = async () => {
    const studentColor: Color | "both" =
      elo === null ? "both" : color === "random" ? (Math.random() < 0.5 ? "white" : "black") : color;
    await newGame({ mode, studentColor, opponentElo: elo });
    onClose();
  };

  return (
    <Modal title="New game" onClose={onClose}>
      <div className="field">
        <span>Game type</span>
        <div className="mode-choice">
          <button className={mode === "rated" ? "on" : ""} onClick={() => setMode("rated")}>
            <ModeBadge mode="rated" />
            <span>No engine, no coach, no takebacks. Shows how you really play, and counts toward your profile.</span>
          </button>
          <button className={mode === "practice" ? "on" : ""} onClick={() => setMode("practice")}>
            <ModeBadge mode="practice" />
            <span>Engine, coach and takebacks whenever you want. Doesn't count toward your profile.</span>
          </button>
        </div>
      </div>
      {mode === "practice" && (
        <div className="field">
          <span>Opponent</span>
          <div className="segmented">
            <button className={hasOpponent ? "on" : ""} onClick={() => setHasOpponent(true)}>
              Stockfish
            </button>
            <button className={hasOpponent ? "" : "on"} onClick={() => setHasOpponent(false)}>
              None (free play)
            </button>
          </div>
        </div>
      )}
      {elo !== null && (
        <label className="field">
          <span>
            Strength: <strong>{rating}</strong>
          </span>
          <input
            type="range"
            className="elo-slider"
            min={OPPONENT_RATING.min}
            max={OPPONENT_RATING.max}
            step={50}
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
          />
          <span className="elo-scale muted small">
            <span>{OPPONENT_RATING.min}</span>
            <span>about chess.com rapid</span>
            <span>{OPPONENT_RATING.max}</span>
          </span>
        </label>
      )}
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

  const remove = async (g: GameSummary) => {
    const what = `${describeSides(g)}, ${formatDate(g.updatedAt)}`;
    if (!confirm(`Delete this game and its coach chat? This can't be undone.

${what}`)) return;
    await deleteGame(g.id);
    setGames((list) => list?.filter((x) => x.id !== g.id) ?? null);
  };

  return (
    <Modal title="Games" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {games?.length === 0 && <p className="muted">No games yet.</p>}
      <div className="game-list">
        {games?.map((g) => (
          <div key={g.id} className={`game-row ${g.id === current ? "current" : ""}`}>
            <button className="game-row-open" onClick={() => open(g.id)}>
            <div className="game-row-top">
              <ModeBadge mode={g.mode} />
              <strong>{describeSides(g)}</strong>
              <span className={`result ${outcome(g)}`}>{g.result ?? "in progress"}</span>
            </div>
            <div className="game-row-sub">
              {formatDate(g.updatedAt)} · {Math.ceil(g.plies / 2)} moves
              {g.takebacks ? ` · ${g.takebacks} takeback${g.takebacks > 1 ? "s" : ""}` : ""}
              {g.termination ? ` · ${g.termination}` : ""}
            </div>
            {g.opening && <div className="game-row-moves">{numbered(g.opening)}…</div>}
            </button>
            <button className="game-row-delete" onClick={() => remove(g)} title="Delete game" aria-label="Delete game">
              🗑
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function describeSides(g: GameSummary): string {
  const opp = opponentLabel({ ...FREE_PLAY, studentColor: g.studentColor, opponentElo: opponentElo(g.opponent) });
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
