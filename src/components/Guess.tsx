import { useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { sendToCoach } from "../coach/bridge";
import { useAuth } from "../coach/auth";
import { viewedPly } from "../chess/view";
import { hasBackend } from "../db";
import { parsePgn } from "../games/pgn";
import { MASTER_GAMES, type MasterGame } from "../guess/games";
import {
  bestScores,
  continueGuess,
  guessMove,
  guessQuestion,
  guessStep,
  maxScore,
  score,
  startGuess,
  stopGuess,
  useGuess,
  type GuessGame,
} from "../guess/session";
import { START_FEN } from "../chess/line";
import { useStore, type Color } from "../store";
import { Board } from "./Board";
import { BLOCKED, useSessionsBlocked } from "./Home";
import { BoardSteps, StepButtons } from "./StepButtons";

const SKIPS = [0, 4, 8];

function fromMaster(g: MasterGame): GuessGame {
  return {
    id: g.id,
    title: `${g.white} vs ${g.black}, ${g.event} ${g.year}`,
    startFen: START_FEN,
    sans: g.moves.split(/\s+/).map((t) => t.replace(/^\d+\.+/, "")).filter(Boolean),
    result: null,
  };
}

/** School › Guess the move: the classic games, or any game pasted as PGN. */
export function GuessMenu() {
  const blocked = useSessionsBlocked();
  const best = bestScores();
  const [skip, setSkip] = useState(4);
  const [pgn, setPgn] = useState("");
  const [pgnSide, setPgnSide] = useState<Color>("white");
  const [error, setError] = useState<string | null>(null);

  const playPasted = () => {
    try {
      const p = parsePgn(pgn);
      if (p.line.sans.length < 2) throw new Error("That game has no moves.");
      const h = p.headers;
      const title = h.White && h.Black ? `${h.White} vs ${h.Black}${h.Event && h.Event !== "?" ? `, ${h.Event}` : ""}` : "Pasted game";
      setError(null);
      startGuess({ id: null, title, startFen: p.line.startFen, sans: p.line.sans, result: h.Result ?? null }, pgnSide, skip);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    }
  };

  return (
    <>
      <h2 className="section-title">Guess the move</h2>
      <p className="section-lede muted">
        Play through a master game from the winner's side and guess each move. The master's move scores 3; another move
        scores 2 if the engine rates it as good, 1 if it's close. Then the game goes on with the master's move.
      </p>
      <label className="field">
        <span>Start guessing</span>
        <div className="segmented">
          {SKIPS.map((n) => (
            <button key={n} className={n === skip ? "on" : ""} onClick={() => setSkip(n)}>
              {n === 0 ? "From move 1" : `After move ${n}`}
            </button>
          ))}
        </div>
      </label>
      <div className="history-list">
        {MASTER_GAMES.map((g) => (
          <div key={g.id} className="history-row">
            <span className="history-main">
              <span>
                {g.white} vs {g.black} <span className="muted small">· {g.event} {g.year}</span>
              </span>
              <span className="muted small">{g.blurb}</span>
            </span>
            <span className="history-side">
              <button onClick={() => startGuess(fromMaster(g), g.side, skip)} disabled={blocked} title={blocked ? BLOCKED : undefined}>
                Play as {g.side}
              </button>
              <span className="muted small">{best[g.id] !== undefined ? `best ${best[g.id]}%` : "new"}</span>
            </span>
          </div>
        ))}
      </div>
      <h3 className="sub-title">Any game</h3>
      <p className="muted small">Paste a PGN, from a book, a database or a game you watched.</p>
      <textarea className="pgn-input" rows={5} value={pgn} onChange={(e) => setPgn(e.target.value)} placeholder='[White "…"]&#10;1. e4 e5 2. Nf3 …' />
      <div className="segmented">
        <button className={pgnSide === "white" ? "on" : ""} onClick={() => setPgnSide("white")}>
          Guess White
        </button>
        <button className={pgnSide === "black" ? "on" : ""} onClick={() => setPgnSide("black")}>
          Guess Black
        </button>
        <span className="spacer" />
        <button className="primary" onClick={playPasted} disabled={!pgn.trim() || blocked}>
          Start
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </>
  );
}

/** Replaces the game board while a guess-the-move game runs. */
export function GuessPanel() {
  const s = useGuess()!;
  const busy = useStore((st) => st.busy);
  const signedIn = useAuth((a) => a.status === "signed-in") || !hasBackend();
  const ply = viewedPly(s.line.sans.length, s.view);
  const past = ply < s.line.sans.length;
  const shapes = useMemo(() => s.shapes as DrawShape[], [s.shapes]);
  const last = s.results[s.results.length - 1];
  const total = score(s);
  const max = maxScore(s);
  const moveNo = Math.floor(s.line.sans.length / 2) + 1;

  return (
    <main className="board-panel drills">
      <div className="game-bar">
        <span className="game-status">
          <strong>Guess the move</strong>
          <span className="muted">
            {" "}
            · {total} of {max}
            {max ? ` (${Math.round((100 * total) / max)}%)` : ""}
          </span>
        </span>
        <span className="spacer" />
        <button onClick={stopGuess}>‹ Games</button>
      </div>
      <div className="crumbs">
        <span className="crumb current">{s.game.title}</span>
      </div>
      <div className="board-frame drill">
        <Board
          fen={s.line.fens[ply]}
          lastMove={ply > 0 ? s.line.lastMoves[ply - 1] : undefined}
          orientation={s.side}
          onMove={guessMove}
          canMove={s.status === "guessing" && !past}
          premoveColor={s.status === "waiting" && !past ? s.side : undefined}
          shapes={past ? undefined : shapes}
        />
        <BoardSteps onStep={guessStep} disabled={s.line.sans.length === 0} />
      </div>
      <StepButtons onStep={guessStep} disabled={s.line.sans.length === 0} />
      <div className={`drill-status ${s.status === "reveal" && last?.points === 0 ? "wrong" : s.status === "done" ? "right" : "solving"}`}>
        {past && s.status !== "done" ? (
          <>
            <strong>Looking back.</strong> Step forward (▶ or ⏭) to go on.
          </>
        ) : s.status === "guessing" ? (
          <>
            {s.message && <span className="muted">{s.message} </span>}
            Move {moveNo}: what did {s.side === "white" ? "White" : "Black"} play?
          </>
        ) : (
          s.message || (s.status === "waiting" ? "…" : "")
        )}
      </div>
      <div className="controls">
        {s.status === "reveal" && (
          <button className="primary" onClick={continueGuess}>
            Continue
          </button>
        )}
        {s.status === "done" && (
          <button className="primary" onClick={stopGuess}>
            Back to the games
          </button>
        )}
        {signedIn && s.results.length > 0 && (
          <button onClick={() => sendToCoach(guessQuestion())} disabled={busy || s.status === "checking"} title="One message to the coach">
            Ask the coach why
          </button>
        )}
      </div>
    </main>
  );
}
