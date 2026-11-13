import { useState } from "react";
import { go } from "../nav";
import { evalText } from "../openings/explain";
import { LEAK_PLIES, numbered, openingLeaks, type Leak, type RepertoireExit } from "../openings/leaks";
import { addToRepertoire, getRepertoire } from "../openings/repertoire";
import { useFromGames } from "../training/games";
import type { Color } from "../store";
import { Board } from "./Board";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const moveNo = (path: string[]) => `${Math.floor(path.length / 2) + 1}${path.length % 2 ? "..." : "."}`;

/** School › Opening leaks: how the student's real games go in the opening, and what to fix first. */
export function LeaksMenu() {
  const { data, error } = useFromGames({ realOnly: true, maxPly: LEAK_PLIES + 6, limit: 300 }, async (games) =>
    openingLeaks(games, await getRepertoire().catch(() => [])),
  );
  return (
    <>
      <h2 className="section-title">Opening leaks</h2>
      <p className="section-lede muted">
        Your real games (rated here and imported), the first {LEAK_PLIES / 2} moves: how each opening goes for you, the
        positions you keep reaching and misplaying, and where you leave your repertoire. Fix one by adding the engine's move
        to your repertoire; it becomes a drill.
      </p>
      {error && <p className="muted">Couldn't load your games: {error}</p>}
      {!data && !error && <p className="muted">Looking through your games…</p>}
      {data && data.games === 0 && (
        <p className="muted">No analyzed real games yet. Play rated games or import your games from chess.com or Lichess (Profile), and let them be analyzed.</p>
      )}
      {data && data.games > 0 && (
        <>
          <h3 className="sub-title">Fix these first</h3>
          {data.leaks.length === 0 ? (
            <p className="muted small">No repeated opening mistakes in {data.games} games. Well played.</p>
          ) : (
            <div className="leak-list">
              {data.leaks.map((l) => (
                <LeakRow key={l.key} leak={l} />
              ))}
            </div>
          )}

          <h3 className="sub-title">Leaving your repertoire</h3>
          {!data.hasRepertoire.white && !data.hasRepertoire.black ? (
            <p className="muted small">
              You have no repertoire yet. Add lines in <button className="link" onClick={() => go("openings")}>Opening training</button> to see where your games leave them.
            </p>
          ) : data.exits.length === 0 ? (
            <p className="muted small">Your games stay in your repertoire as far as it goes.</p>
          ) : (
            <div className="leak-list">
              {data.exits.map((e) => (
                <ExitRow key={e.key} exit={e} />
              ))}
            </div>
          )}

          <h3 className="sub-title">Your openings</h3>
          <table className="leak-table">
            <thead>
              <tr>
                <th>Opening</th>
                <th>As</th>
                <th>Games</th>
                <th>Score</th>
                <th title="Engine's average eval after move 10, for you">After move 10</th>
              </tr>
            </thead>
            <tbody>
              {data.openings.map((o) => (
                <tr key={`${o.color}|${o.name}`}>
                  <td>{o.name}</td>
                  <td>{o.color}</td>
                  <td>{o.games}</td>
                  <td className={o.score >= 0.55 ? "good" : o.score < 0.45 ? "bad" : ""}>{pct(o.score)}</td>
                  <td className={o.evalAfter === null ? "muted" : o.evalAfter >= 50 ? "good" : o.evalAfter <= -50 ? "bad" : ""}>
                    {o.evalAfter === null ? "–" : evalText(o.evalAfter)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

/** Adds `moves` (from the start) to the repertoire, which also makes it an opening drill. */
function AddFix({ color, name, moves, label }: { color: Color; name: string; moves: string[]; label: string }) {
  const [state, setState] = useState<"idle" | "adding" | "added" | "failed">("idle");
  return (
    <button
      disabled={state === "adding" || state === "added"}
      onClick={() => {
        setState("adding");
        addToRepertoire(color, name, moves).then(
          () => setState("added"),
          (e) => (console.error("repertoire add failed", e), setState("failed")),
        );
      }}
    >
      {state === "added" ? "✓ In your repertoire" : state === "failed" ? "Couldn't add it, try again" : label}
    </button>
  );
}

function LeakRow({ leak: l }: { leak: Leak }) {
  const played = l.played.map((p) => (p.count > 1 ? `${p.san} (${p.count}×)` : p.san)).join(", ");
  return (
    <div className="leak-row">
      <Board fen={l.fen} orientation={l.color} preview coordinates={false} className="mini-board" />
      <div className="leak-info">
        <div className="leak-title">
          {l.opening ?? "Opening"}, move {moveNo(l.path)} as {l.color}
        </div>
        <div className="muted small">{numbered(l.path) || "Start position"}</div>
        <div>
          Reached in {l.games} {l.games === 1 ? "game" : "games"} (scored {pct(l.points / l.games)}). You played {played}
          {l.best ? (
            <>
              ; the engine plays <strong>{l.best}</strong>
            </>
          ) : null}
          . Costs you {(l.avgLoss / 100).toFixed(1)} pawns on average{l.worst ? `, worst a ${l.worst}` : ""}.
        </div>
        {l.best && (
          <div className="controls">
            <AddFix color={l.color} name={`${l.opening ?? "Opening"}: fix at move ${moveNo(l.path)}`} moves={[...l.path, l.best]} label={`Add ${l.best} to my repertoire`} />
          </div>
        )}
      </div>
    </div>
  );
}

function ExitRow({ exit: e }: { exit: RepertoireExit }) {
  const n = `${e.games} ${e.games === 1 ? "game" : "games"}`;
  return (
    <div className="leak-row">
      <Board fen={e.fen} orientation={e.color} preview coordinates={false} className="mini-board" />
      <div className="leak-info">
        <div className="leak-title">
          {e.kind === "you" ? "You left your line" : "A reply you haven't prepared"}, move {moveNo(e.path)} as {e.color}
        </div>
        <div className="muted small">{numbered(e.path)}</div>
        {e.kind === "you" ? (
          <div>
            In {n} you played {e.played} here; your repertoire has <strong>{e.answer}</strong>.
          </div>
        ) : (
          <div>
            In {n} the opponent played {e.lastMove}, which your repertoire doesn't cover. You answered {e.played}
            {e.answer && e.answer !== e.played ? (
              <>
                ; the engine plays <strong>{e.answer}</strong>
              </>
            ) : null}
            .
          </div>
        )}
        <div className="controls">
          {e.kind === "you" ? (
            <button onClick={() => go("openings")}>Practise your repertoire</button>
          ) : (
            e.answer && (
              <AddFix color={e.color} name={`Against ${e.lastMove} (move ${moveNo(e.path.slice(0, -1))})`} moves={[...e.path, e.answer]} label={`Add ${e.answer} to my repertoire`} />
            )
          )}
        </div>
      </div>
    </div>
  );
}
