import { useSettings } from "../settings";
import { useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { viewedPly } from "../chess/view";
import { ENDGAMES, type Endgame } from "../endgames/positions";
import { SURPRISES } from "../endgames/surprise";
import { planShapes } from "../openings/plans";
import {
  endgameHint,
  endgameMove,
  endgameOf,
  endgameRecords,
  endgameStep,
  hasNextEndgame,
  nextHint,
  nowCards,
  nextEndgame,
  retryEndgame,
  canTakeBack,
  takeBackEndgame,
  startEndgame,
  startSurprise,
  stopEndgame,
  useEndgame,
} from "../endgames/session";
import { Board } from "./Board";
import { PlanCard } from "./OpeningPanel";
import { BoardSteps, StepButtons } from "./StepButtons";

const GOAL: Record<Endgame["goal"], string> = {
  mate: "Mate",
  promote: "Win",
  draw: "Hold the draw",
  convert: "Convert",
};
const LEVEL = ["", "Basic", "Intermediate", "Hard"];

/** School › Endgame trainer: the positions, grouped, with how the student has done in each. */
export function EndgameMenu() {
  const records = useSettings((st) => st.endgameRecords);
  const groups = [...new Set(ENDGAMES.map((e) => e.group))];
  const solved = ENDGAMES.filter((e) => records[e.id]?.wins).length;
  return (
    <>
      <h2 className="section-title">Endgame trainer</h2>
      <p className="section-lede muted">
        The endings every player needs, against full-strength Stockfish. Win
        them (or hold them) against the best defence; a move that throws the
        result away ends the try, with the reason. Mastered {solved} of{" "}
        {ENDGAMES.length}.
      </p>
      <SurpriseMenu records={records} />
      {groups.map((g) => (
        <div key={g}>
          <h3 className="sub-title">{g}</h3>
          <div className="history-list">
            {ENDGAMES.filter((e) => e.group === g).map((e) => {
              const r = records[e.id];
              return (
                <div
                  key={e.id}
                  className={`history-row ${r?.last === "won" ? "right" : r?.last === "failed" ? "wrong" : ""}`}
                >
                  <span className="history-mark">
                    {r?.wins ? "✓" : r?.tries ? "·" : ""}
                  </span>
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

/** "Surprise me", and the surprise endings already met (the rest stay a surprise). */
function SurpriseMenu({
  records,
}: {
  records: ReturnType<typeof endgameRecords>;
}) {
  const met = SURPRISES.filter((e) => records[e.id]?.tries);
  const won = met.filter((e) => records[e.id].wins).length;
  return (
    <div>
      <h3 className="sub-title">Surprise me</h3>
      <p className="muted small">
        A random ending with pawns and at most one piece: win it, or hold it
        level. Each hint is an idea to think about, drawn on the board: passed
        pawns, where the king goes, which pawns to push or leave alone, and what
        to watch out for.{" "}
        {met.length
          ? `Met ${met.length} of ${SURPRISES.length}, ${won} brought home.`
          : `${SURPRISES.length} to find.`}
      </p>
      <div className="controls">
        <button className="primary" onClick={startSurprise}>
          Surprise me
        </button>
      </div>
      {met.length > 0 && (
        <div className="history-list">
          {met.map((e) => {
            const r = records[e.id];
            return (
              <div
                key={e.id}
                className={`history-row ${r.last === "won" ? "right" : r.last === "failed" ? "wrong" : ""}`}
              >
                <span className="history-mark">{r.wins ? "✓" : "·"}</span>
                <span className="history-main">
                  <span>{e.name}</span>
                  <span className="muted small">
                    {GOAL[e.goal]} as {e.side} · {e.group} · {r.wins} of{" "}
                    {r.tries} tries
                  </span>
                </span>
                <span className="history-side">
                  <button onClick={() => startEndgame(e.id, true)}>
                    Again
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const HINT_LABEL = {
  idea: (shown: number) => (shown ? "Next idea" : "Hint: an idea"),
  situation: () => "Hint: what's going on?",
  move: () => "Show the move",
};

/** Replaces the game board while an endgame runs. */
export function EndgamePanel() {
  const s = useEndgame()!;
  // A rated game in progress keeps the coach off, wherever the student is.
  const e = endgameOf(s);
  const ply = viewedPly(s.line.sans.length, s.view);
  const past = ply < s.line.sans.length;
  const over =
    s.status === "won" || s.status === "held" || s.status === "failed";
  // Surprise endings: hint cards, one at a time. First the cards about the board as it is now
  // (endgames/now.ts), then the written ideas asked for so far (all of them once it's over). The
  // written ones speak from the start position, so they're drawn only while the board shows it.
  // A card's drawings show when it's opened and clear on the next move, like the engine's arrow.
  const plies = s.line.sans.length;
  const live = over ? [] : nowCards(s);
  const canned = e.ideas ? (over ? e.ideas : e.ideas.slice(0, s.ideas)) : [];
  const ideas = useMemo(
    () => [
      ...live,
      ...(plies > 0
        ? canned.map((i) => ({
            ...i,
            title: `${i.title} (the plan from the start)`,
          }))
        : canned),
    ],
    [live, canned, plies],
  );
  const [ideaIndex, setIdeaIndex] = useState(0);
  const [drawnAt, setDrawnAt] = useState<number | null>(null);
  const open = (i: number) => {
    setIdeaIndex(i);
    setDrawnAt(useEndgame.getState()?.line.sans.length ?? null);
  };
  useEffect(() => {
    if (s.ideas) open(live.length + s.ideas - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when another written idea is asked for.
  }, [s.ideas, s.id]);
  useEffect(() => {
    if (live.length) open(live.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new live card arrives.
  }, [live.length, s.now?.fen]);
  const index = Math.min(ideaIndex, ideas.length - 1);
  const idea = ideas[index];
  const isLive = index < live.length;
  const ideaShapes = useMemo(
    () =>
      idea && drawnAt === plies && (isLive || plies === 0)
        ? planShapes(idea)
        : [],
    [idea, drawnAt, plies, isLive],
  );
  const boardShapes = useMemo(
    () => [...ideaShapes, ...(s.shapes as DrawShape[])],
    [ideaShapes, s.shapes],
  );
  // A surprise keeps its name (which gives the idea away) until a hint, the end, or a second try.
  const hidden =
    !!s.surprise && !s.ideas && !over && !endgameRecords()[s.id]?.tries;
  const goal =
    e.goal === "draw"
      ? s.spec
        ? `Hold on for ${e.moves ?? 15} moves without letting it get lost`
        : `Hold the draw for ${e.moves ?? 15} moves`
      : e.goal === "mate"
        ? "Deliver checkmate"
        : e.goal === "convert"
          ? `Turn it into a decisive advantage (+${((e.winAt ?? 600) / 100).toFixed(1)}) or mate`
          : "Promote and keep the win";

  return (
    <main className="board-panel drills tall-status">
      {/* A wide panel puts the status and cards beside the board (.drill-body, .trainer-feedback). */}
      <div className="drill-body">
        <div className="game-bar">
          <span className="game-status">
            <strong>
              {s.spec
                ? "Win it again"
                : s.surprise
                  ? "Surprise ending"
                  : "Endgame trainer"}
            </strong>
            <span className="muted"> · {e.group}</span>
          </span>
          <span className="spacer" />
          <button onClick={stopEndgame}>
            {s.spec ? "‹ Your positions" : "‹ Endgames"}
          </button>
        </div>
        <div className="crumbs">
          <span className="crumb current">
            {hidden ? "What's this position about?" : e.name}
          </span>
          {e.note && <span className="muted small"> · {e.note}</span>}
        </div>
        <div className="board-frame drill">
          <Board
            fen={s.line.fens[ply]}
            lastMove={ply > 0 ? s.line.lastMoves[ply - 1] : undefined}
            orientation={e.side}
            onMove={endgameMove}
            canMove={s.status === "playing" && !past}
            premoveColor={!over && !past ? e.side : undefined}
            shapes={past ? undefined : boardShapes}
          />
          <BoardSteps
            onStep={endgameStep}
            disabled={s.line.sans.length === 0}
          />
        </div>
        <StepButtons onStep={endgameStep} disabled={s.line.sans.length === 0} />
        <div className="trainer-feedback">
          <div
            className={`drill-status ${s.status === "failed" ? "wrong" : over ? "right" : "solving"}`}
          >
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
                You play {e.side}. {goal}.
                {s.status === "thinking" && (
                  <span className="muted"> Stockfish is thinking…</span>
                )}
                {s.moves > 0 && <span className="muted"> Move {s.moves}.</span>}
              </>
            )}
            {s.hint && <span className="status-extra muted">{e.hint}</span>}
          </div>
          {idea && (
            <PlanCard
              plan={ideas}
              index={index}
              onIndex={open}
              at={isLive ? s.line.fens[plies] : e.fen}
              heading={over ? "The ideas behind it" : "What to think about"}
            />
          )}
        </div>
        <div className="controls">
          {over ? (
            <>
              {canTakeBack(s) && (
                <button className="primary" onClick={takeBackEndgame}>
                  Take back
                </button>
              )}
              <button
                className={canTakeBack(s) ? "" : "primary"}
                onClick={retryEndgame}
              >
                {s.status === "failed" ? "Start over" : "Try again"}
              </button>
              {hasNextEndgame(s) && (
                <button onClick={nextEndgame}>
                  {s.spec
                    ? "Next position"
                    : s.surprise
                      ? "Another surprise"
                      : "Next ending"}
                </button>
              )}
            </>
          ) : (
            <button
              onClick={endgameHint}
              disabled={s.status !== "playing" || !!s.hinting || !nextHint(s)}
            >
              {s.hinting
                ? "Thinking…"
                : !e.ideas
                  ? "Hint"
                  : HINT_LABEL[nextHint(s) ?? "move"](s.ideas)}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
