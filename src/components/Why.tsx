import { useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { explainCached, type Explanation, type ExplainedLine } from "../analysis/explain";
import { labelOf, type MoveLabel } from "../analysis/review";
import { useStore } from "../store";
import type { Key } from "chessground/types";
import { explore, exploreGoto, exploreMove, type Explore } from "../chess/explore";
import { moveLabel, type Line } from "../chess/line";
import { setEvalFocus } from "../engine/live";
import { Board } from "./Board";
import { EvalBar, EvalLine } from "./EvalBar";
import { Modal } from "./GameDialogs";
import { MaterialStrip } from "./Material";

const NOUN: Partial<Record<MoveLabel, string>> = {
  inaccuracy: "an inaccuracy",
  mistake: "a mistake",
  miss: "a miss",
  blunder: "a blunder",
};

/**
 * A button for the student's bad move at index `i`: the explanation stays out of the way until
 * they ask for it, then opens on its own board.
 */
export function WhyButton({ i }: { i: number }) {
  const [open, setOpen] = useState(false);
  const a = useStore((s) => s.annotations[i]);
  if (!a) return null;
  const noun = NOUN[labelOf(a)];
  if (!noun) return null;
  return (
    <>
      <button className="why-button" onClick={() => setOpen(true)}>
        Why is it {noun}? ›
      </button>
      {open && <WhyDialog i={i} onClose={() => setOpen(false)} />}
    </>
  );
}

function WhyDialog({ i, onClose }: { i: number; onClose: () => void }) {
  const game = useStore((s) => s.game);
  const a = useStore((s) => s.annotations[i])!;
  const prevEval = useStore((s) => s.annotations[i - 1]?.evalAfter);
  const orientation = useStore((s) => s.orientation);
  const [ex, setEx] = useState<Explanation | null>(null);
  const [failed, setFailed] = useState(false);
  const fen = game.fens[i];
  const [, turn, , , , full] = fen.split(" ");
  const moveText = `${full}${turn === "w" ? "." : "..."}${game.sans[i]}`;
  const noun = NOUN[labelOf(a)] ?? "a weak move";

  useEffect(() => {
    let live = true;
    const uci = game.lastMoves[i].join("") + (game.sans[i].match(/=([QRBN])/)?.[1].toLowerCase() ?? "");
    explainCached({ fenBefore: fen, uci, bestUci: a.bestUci, evalBefore: a.evalBefore ?? prevEval ?? 0, evalAfter: a.evalAfter })
      .then((e) => live && setEx(e))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [fen, a, prevEval, game, i]);

  return (
    <Modal title={`Why ${moveText} is ${noun}`} onClose={onClose} className="why-dialog">
      {!ex ? (
        <p className="muted">{failed ? "The engine couldn't work this one out." : "Working it out…"}</p>
      ) : (
        <>
          <div className="why-stats">
            <span>
              Eval for you <strong>{ex.evalBefore}</strong> → <strong>{ex.evalAfter}</strong>
            </span>
            <span>
              Winning chances <strong>{ex.winBefore}%</strong> → <strong>{ex.winAfter}%</strong>
            </span>
          </div>
          <WhyLines ex={ex} playedSan={game.sans[i]} orientation={orientation} />
          <p className="muted small why-foot">
            {noun[0].toUpperCase() + noun.slice(1)} means the move gave away{" "}
            {{ inaccuracy: "5–10%", mistake: "10–20%", blunder: "20% or more", miss: "a winning chance" }[labelOf(a) as string] ?? "some"} of
            your winning chances (chess.com's scale).
          </p>
        </>
      )}
    </Modal>
  );
}

/** An explanation's two lines, each on its own board: after the move played, and the better move. */
export function WhyLines({ ex, playedSan, orientation }: { ex: Explanation; playedSan: string; orientation: "white" | "black" }) {
  const [tab, setTab] = useState<"played" | "better">("played");
  const line = tab === "better" && ex.better ? ex.better : ex.played;
  return (
    <>
      {ex.better && (
        <div className="why-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "played"} className={tab === "played" ? "on bad" : ""} onClick={() => setTab("played")}>
            After {playedSan}
          </button>
          <button role="tab" aria-selected={tab === "better"} className={tab === "better" ? "on good" : ""} onClick={() => setTab("better")}>
            Better: {ex.better.steps[0]?.san}
          </button>
        </div>
      )}
      <LineViewer key={tab} line={line} kind={tab} orientation={orientation} />
    </>
  );
}

/** The explained line as a Line, so the student can fork their own moves off it. */
function toLine(line: ExplainedLine): Line {
  return {
    startFen: line.startFen,
    sans: line.steps.map((s) => s.san),
    fens: [line.startFen, ...line.steps.map((s) => s.fen)],
    lastMoves: line.steps.map((s) => [s.from, s.to] as [Key, Key]),
    notes: line.steps.map((s) => s.note),
  };
}

/**
 * One line on a board of its own: step through it, a caption per move, the verdict at the end.
 * The student can play their own moves on it ("what if he takes instead?"): they fork off the
 * line, and stepping back to the fork brings the line back (chess/explore.ts).
 */
function LineViewer({ line, kind, orientation }: { line: ExplainedLine; kind: "played" | "better"; orientation: "white" | "black" }) {
  const base = useMemo(() => toLine(line), [line]);
  // Opens on the move itself, so the board shows what was played (or should have been).
  const [x, setX] = useState<Explore>(() => explore(base, Math.min(1, base.sans.length)));
  const [showEval, setShowEval] = useState(true);
  const { ply, forkAt } = x;
  const n = x.line.sans.length;
  const forked = forkAt !== null;
  const step = !forked && ply > 0 ? line.steps[ply - 1] : null;
  const fen = x.line.fens[ply];
  const next = forked ? undefined : line.steps[ply];
  const goto = (to: number) => setX((cur) => exploreGoto(cur, to));

  // This board has the live engine while it's open; the main board gets it back on close.
  useEffect(() => {
    setEvalFocus(showEval ? fen : null);
  }, [fen, showEval]);
  useEffect(() => () => setEvalFocus(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const to = { ArrowLeft: ply - 1, ArrowRight: ply + 1, Home: 0, End: n }[e.key];
      if (to === undefined) return;
      goto(to);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ply, n]);

  const shapes = useMemo<DrawShape[]>(() => {
    const out: DrawShape[] = [];
    if (forked) return out;
    // The judged move in its colour on the move itself; the next move faintly, as a hint.
    if (ply === 1 && step) out.push({ orig: step.from, dest: step.to, brush: kind === "played" ? "red" : "green" });
    if (next) out.push({ orig: next.from, dest: next.to, brush: ply === 0 ? (kind === "played" ? "red" : "green") : "paleBlue" });
    return out;
  }, [ply, step, next, kind, forked]);

  const top = orientation === "white" ? "black" : "white";
  const lastMove = ply > 0 ? x.line.lastMoves[ply - 1] : undefined;
  // The line's own moves (up to the fork), then the student's.
  const moves = x.line.sans.map((san, k) =>
    forked && k >= forkAt ? { label: moveLabel(x.line.fens[k], san), cls: "fork" } : { label: line.steps[k].label, cls: k === 0 ? kind : "" },
  );
  return (
    <div className="why-body">
      <div className={`why-board board-frame ${showEval ? "with-eval" : ""}`}>
        <button
          className={`eval-toggle ${showEval ? "on" : ""}`}
          onClick={() => setShowEval(!showEval)}
          title={showEval ? "Hide engine evaluation" : "Show engine evaluation"}
          aria-pressed={showEval}
        >
          <span className="eval-toggle-icon" />
        </button>
        {showEval && <EvalBar orientation={orientation} />}
        <MaterialStrip fen={fen} side={top} />
        <Board
          fen={fen}
          orientation={orientation}
          lastMove={lastMove}
          onMove={(from, to, promotion) => setX((cur) => exploreMove(cur, from, to, promotion) ?? cur)}
          shapes={shapes}
          className="cg-board-wrap"
        />
        <MaterialStrip fen={fen} side={orientation} />
      </div>
      <div className="why-side">
        <p className={`why-verdict ${kind}`}>{line.verdict}</p>
        <ol className="why-moves">
          {moves.map((m, k) => (
            <li key={k}>
              <button className={`${k + 1 === ply ? "current" : ""} ${m.cls}`} onClick={() => goto(k + 1)}>
                {m.label}
              </button>
            </li>
          ))}
        </ol>
        {showEval && <EvalLine />}
        <p className="why-caption">
          {forked ? (
            <>
              <strong>What if…</strong> Your own moves, for both sides. Step back to{" "}
              {forkAt === 0 ? "the start" : line.steps[forkAt - 1].label} to get the line back.
            </>
          ) : step ? (
            step.note
          ) : (
            "The position before the move. Step forward to play through the line, or play your own moves on the board."
          )}
          {!forked && ply === n && n > 0 && <span className="muted"> Eval for you here: {line.evalText}.</span>}
        </p>
        <div className="nav-buttons">
          <button onClick={() => goto(0)} disabled={ply === 0} aria-label="Start">⏮</button>
          <button onClick={() => goto(ply - 1)} disabled={ply === 0} aria-label="Back">◀</button>
          <button onClick={() => goto(ply + 1)} disabled={ply === n} aria-label="Forward">▶</button>
          <button onClick={() => goto(n)} disabled={ply === n} aria-label="End">⏭</button>
        </div>
      </div>
    </div>
  );
}
