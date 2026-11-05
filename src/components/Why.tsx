import { useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { explainCached, type Explanation, type ExplainedLine } from "../analysis/explain";
import { labelOf, type MoveLabel } from "../analysis/review";
import { useStore } from "../store";
import { Board } from "./Board";
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
  const [tab, setTab] = useState<"played" | "better">("played");

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

  const line = ex && (tab === "better" && ex.better ? ex.better : ex.played);
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
          {ex.better && (
            <div className="why-tabs" role="tablist">
              <button role="tab" aria-selected={tab === "played"} className={tab === "played" ? "on bad" : ""} onClick={() => setTab("played")}>
                After {game.sans[i]}
              </button>
              <button role="tab" aria-selected={tab === "better"} className={tab === "better" ? "on good" : ""} onClick={() => setTab("better")}>
                Better: {ex.better.steps[0]?.san}
              </button>
            </div>
          )}
          {line && <LineViewer key={tab} line={line} kind={tab} orientation={orientation} />}
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

/** One line on a board of its own: step through it, a caption per move, the verdict at the end. */
function LineViewer({ line, kind, orientation }: { line: ExplainedLine; kind: "played" | "better"; orientation: "white" | "black" }) {
  // Opens on the move itself, so the board shows what was played (or should have been).
  const [ply, setPly] = useState(Math.min(1, line.steps.length));
  const n = line.steps.length;
  const step = ply > 0 ? line.steps[ply - 1] : null;
  const fen = step?.fen ?? line.startFen;
  const next = line.steps[ply];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const to = { ArrowLeft: ply - 1, ArrowRight: ply + 1, Home: 0, End: n }[e.key];
      if (to === undefined) return;
      setPly(Math.max(0, Math.min(n, to)));
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ply, n]);

  const shapes = useMemo<DrawShape[]>(() => {
    const out: DrawShape[] = [];
    // The judged move in its colour on the move itself; the next move faintly, as a hint.
    if (ply === 1 && step) out.push({ orig: step.from, dest: step.to, brush: kind === "played" ? "red" : "green" });
    if (next) out.push({ orig: next.from, dest: next.to, brush: ply === 0 ? (kind === "played" ? "red" : "green") : "paleBlue" });
    return out;
  }, [ply, step, next, kind]);

  const top = orientation === "white" ? "black" : "white";
  return (
    <div className="why-body">
      <div className="why-board">
        <MaterialStrip fen={fen} side={top} />
        <Board fen={fen} orientation={orientation} lastMove={step ? [step.from, step.to] : undefined} viewOnly shapes={shapes} className="cg-board-wrap" />
        <MaterialStrip fen={fen} side={orientation} />
      </div>
      <div className="why-side">
        <p className={`why-verdict ${kind}`}>{line.verdict}</p>
        <ol className="why-moves">
          {line.steps.map((s, k) => (
            <li key={k}>
              <button className={`${k + 1 === ply ? "current" : ""} ${k === 0 ? kind : ""}`} onClick={() => setPly(k + 1)}>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        <p className="why-caption">
          {step ? step.note : "The position before the move. Step forward to play through the line."}
          {ply === n && n > 0 && <span className="muted"> Eval for you here: {line.evalText}.</span>}
        </p>
        <div className="nav-buttons">
          <button onClick={() => setPly(0)} disabled={ply === 0} aria-label="Start">⏮</button>
          <button onClick={() => setPly(ply - 1)} disabled={ply === 0} aria-label="Back">◀</button>
          <button onClick={() => setPly(ply + 1)} disabled={ply === n} aria-label="Forward">▶</button>
          <button onClick={() => setPly(n)} disabled={ply === n} aria-label="End">⏭</button>
        </div>
      </div>
    </div>
  );
}
