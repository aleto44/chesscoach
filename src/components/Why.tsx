import { useEffect, useMemo, useState } from "react";
import type { DrawShape } from "chessground/draw";
import { explainCached, type Explanation, type ExplainedLine } from "../analysis/explain";
import { labelOf, type MoveLabel } from "../analysis/review";
import { useStore } from "../store";
import type { Key } from "chessground/types";
import { explore, exploreGoto, exploreMove, type Explore } from "../chess/explore";
import { moveLabel, type Line } from "../chess/line";
import { setEvalFocus, TOP_LINES } from "../engine/live";
import { Board } from "./Board";
import { EvalBar } from "./EvalBar";
import { EngineLines, useEngineLines } from "./Analysis";
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
  const alts = ex.alternatives ?? (ex.better ? [ex.better] : []);
  // A missed chance opens on the move that was missed: that's the lesson, not what came after.
  const [tab, setTab] = useState<"played" | "better">(ex.focus === "better" && alts.length ? "better" : "played");
  const [pick, setPick] = useState(0);
  const several = alts.length > 1;
  const line = tab === "better" && alts.length ? alts[Math.min(pick, alts.length - 1)] : ex.played;
  // With several sound moves the board opens before the move, all of them drawn as arrows.
  const options = several ? alts.map((a, k) => ({ from: a.steps[0].from, to: a.steps[0].to, on: k === pick })) : undefined;
  return (
    <>
      {alts.length > 0 && (
        <div className="why-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "played"} className={tab === "played" ? "on bad" : ""} onClick={() => setTab("played")}>
            After {playedSan}
          </button>
          <button role="tab" aria-selected={tab === "better"} className={tab === "better" ? "on good" : ""} onClick={() => setTab("better")}>
            {several ? `Better moves (${alts.length})` : `Better: ${alts[0].steps[0]?.san}`}
          </button>
        </div>
      )}
      {tab === "better" && several && (
        <div className="why-options">
          <p className="muted small">{ex.betterSummary}</p>
          <div className="why-moves">
            {alts.map((a, k) => (
              <button key={k} className={`better ${k === pick ? "current" : ""}`} onClick={() => setPick(k)}>
                {a.steps[0].san} <span className="muted">{a.evalText}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <LineViewer
        key={`${tab}-${tab === "better" ? pick : 0}`}
        line={line}
        kind={tab}
        orientation={orientation}
        options={tab === "better" ? options : undefined}
      />
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
function LineViewer({
  line,
  kind,
  orientation,
  options,
}: {
  line: ExplainedLine;
  kind: "played" | "better";
  orientation: "white" | "black";
  /** Several sound moves: drawn together on the start position, the picked one brighter. */
  options?: { from: Key; to: Key; on: boolean }[];
}) {
  const base = useMemo(() => toLine(line), [line]);
  // Opens on the move itself, so the board shows what was played (or should have been); with
  // several options, before it, so all of them show.
  const [x, setX] = useState<Explore>(() => explore(base, options ? 0 : Math.min(1, base.sans.length)));
  const [showEval, setShowEval] = useState(true);
  const { ply, forkAt } = x;
  const n = x.line.sans.length;
  const forked = forkAt !== null;
  const step = !forked && ply > 0 ? line.steps[ply - 1] : null;
  const fen = x.line.fens[ply];
  const next = forked ? undefined : line.steps[ply];
  const goto = (to: number) => setX((cur) => exploreGoto(cur, to));
  const engineLines = useEngineLines(fen);
  // An engine line's moves, played onto this board as what-if moves.
  const playLine = (uci: string[]) =>
    setX((cur) => uci.reduce((x, m) => exploreMove(x, m.slice(0, 2) as Key, m.slice(2, 4) as Key, m[4]) ?? x, cur));

  // This board has the live engine while it's open; the main board gets it back on close.
  useEffect(() => {
    setEvalFocus(showEval ? fen : null, TOP_LINES);
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
    if (ply === 0 && options) {
      for (const o of options) out.push({ orig: o.from, dest: o.to, brush: o.on ? "green" : "paleGreen" });
      return out;
    }
    // The judged move in its colour on the move itself; the next move faintly, as a hint.
    if (ply === 1 && step) out.push({ orig: step.from, dest: step.to, brush: kind === "played" ? "red" : "green" });
    if (next) out.push({ orig: next.from, dest: next.to, brush: ply === 0 ? (kind === "played" ? "red" : "green") : "paleBlue" });
    // At the end, what the verdict points at (the bishop its own pawn shuts in, doubled pawns).
    if (ply === line.steps.length) for (const mk of line.marks ?? []) out.push({ orig: mk.orig, dest: mk.dest, brush: mk.brush });
    return out;
  }, [ply, step, next, kind, forked, options, line]);

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
        {/* Above everything that changes while stepping (the eval line, the caption), so the buttons
            stay put under the pointer. */}
        <div className="nav-buttons">
          <button onClick={() => goto(0)} disabled={ply === 0} aria-label="Start">⏮</button>
          <button onClick={() => goto(ply - 1)} disabled={ply === 0} aria-label="Back">◀</button>
          <button onClick={() => goto(ply + 1)} disabled={ply === n} aria-label="Forward">▶</button>
          <button onClick={() => goto(n)} disabled={ply === n} aria-label="End">⏭</button>
        </div>
        <ol className="why-moves">
          {moves.map((m, k) => (
            <li key={k}>
              <button className={`${k + 1 === ply ? "current" : ""} ${m.cls}`} onClick={() => goto(k + 1)}>
                {m.label}
              </button>
            </li>
          ))}
        </ol>
        {showEval && <EngineLines fen={fen} lines={engineLines} orientation={orientation} onPlay={playLine} />}
        <p className="why-caption">
          {forked ? (
            <>
              <strong>What if…</strong> Your own moves, for both sides. Step back to{" "}
              {forkAt === 0 ? "the start" : line.steps[forkAt - 1].label} to get the line back.
            </>
          ) : step ? (
            step.note
          ) : options ? (
            "Green arrows: moves that would have kept the position. Step forward to see the brighter one and the reply."
          ) : (
            "The position before the move. Step forward to play through the line, or play your own moves on the board."
          )}
          {!forked && ply === n && n > 0 && <span className="muted"> Eval for you here: {line.evalText}.</span>}
        </p>
      </div>
    </div>
  );
}
