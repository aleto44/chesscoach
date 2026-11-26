import { evalText } from "../openings/explain";
import { LEAK_PLIES, numbered, openingLeaks, type Leak } from "../openings/leaks";
import { useFromGames } from "../training/games";
import { Board } from "./Board";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const moveNo = (path: string[]) => `${Math.floor(path.length / 2) + 1}${path.length % 2 ? "..." : "."}`;

/** School › Opening leaks: how the student's real games go in the opening, and what to fix first. */
export function LeaksMenu() {
  const { data, error } = useFromGames({ realOnly: true, maxPly: LEAK_PLIES + 6, limit: 300 }, async (games) => openingLeaks(games));
  return (
    <>
      <h2 className="section-title">Opening leaks</h2>
      <p className="section-lede muted">
        Your real games (rated here and imported), the first {LEAK_PLIES / 2} moves: how each opening goes for you, the
        positions you keep reaching and misplaying, with the engine's move.
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
      </div>
    </div>
  );
}
