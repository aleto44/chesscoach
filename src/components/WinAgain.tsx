import { gamePositions } from "../convert/positions";
import type { Endgame } from "../endgames/positions";
import { endgameRecords, startCustomEndgame } from "../endgames/session";
import { useFromGames } from "../training/games";

/** School › Win it again: positions from the student's games to convert, or to hold, against Stockfish. */
export function WinAgainMenu() {
  const { data, error } = useFromGames({ realOnly: false, maxPly: null, limit: 200 }, gamePositions);
  return (
    <>
      <h2 className="section-title">Win it again</h2>
      <p className="section-lede muted">
        Positions from your own analyzed games. You were clearly better and didn't win, or worse but still holding and
        then lost. Play them again against Stockfish's best defence (or attack). A move that throws the result away ends the try.
      </p>
      {error && <p className="muted">Couldn't load your games: {error}</p>}
      {!data && !error && <p className="muted">Looking through your games…</p>}
      {data && (
        <>
          <PositionList
            title="Convert the advantage"
            empty="No games yet where you were clearly better (+3) and didn't win. Nice, or play and analyze a few more."
            list={data.convert}
          />
          <PositionList
            title="Hold the worse position"
            empty="No lost games yet that went from slightly worse to lost. Positions show up here once you have some."
            list={data.defend}
          />
        </>
      )}
    </>
  );
}

function PositionList({ title, empty, list }: { title: string; empty: string; list: Endgame[] }) {
  const records = endgameRecords();
  const done = list.filter((e) => records[e.id]?.wins).length;
  return (
    <div>
      <h3 className="sub-title">
        {title}
        {list.length > 0 && (
          <span className="muted small">
            {" "}
            · {done} of {list.length} done
          </span>
        )}
      </h3>
      {list.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <div className="history-list">
          {list.map((e, i) => {
            const r = records[e.id];
            return (
              <div key={e.id} className={`history-row ${r?.last === "won" ? "right" : r?.last === "failed" ? "wrong" : ""}`}>
                <span className="history-mark">{r?.wins ? "✓" : r?.tries ? "·" : ""}</span>
                <span className="history-main">
                  <span>
                    {e.name} as {e.side}
                  </span>
                  <span className="muted small">
                    {e.note}
                    {r ? ` · ${r.wins} of ${r.tries} tries` : ""}
                  </span>
                </span>
                <span className="history-side">
                  <button onClick={() => startCustomEndgame(e, list.slice(i + 1))}>{r?.wins ? "Again" : "Play"}</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
