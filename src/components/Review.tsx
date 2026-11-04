import { useMemo } from "react";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { isStudentMove, keyMoments, type MoveAnnotation } from "../analysis/review";
import { sendToCoach } from "../coach/bridge";
import { goto, useStore } from "../store";

const MARKS: Partial<Record<MoveAnnotation["class"], string>> = { inaccuracy: "?!", mistake: "?", blunder: "??" };
export const markFor = (a: MoveAnnotation | null | undefined) => (a ? (MARKS[a.class] ?? "") : "");

const pawns = (cp: number) => (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);

function san(fen: string, uci: string | null) {
  if (!uci) return null;
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

/**
 * At a position where the student is about to go wrong (key moments jump here), what they
 * played and what was better. Null elsewhere.
 */
export function useMoment() {
  const { game, gamePly, annotations, meta, active } = useStore();
  return useMemo(() => moment(), [game, gamePly, annotations, meta, active]);
}

function moment() {
  const { game, gamePly, annotations, meta, active } = useStore.getState();
  if (active || gamePly >= game.sans.length) return null;
  const a = annotations[gamePly];
  if (!a || !MARKS[a.class] || !isStudentMove(game, meta, gamePly)) return null;
  const fen = game.fens[gamePly];
  const [, turn, , , , full] = fen.split(" ");
  const best = san(fen, a.bestUci);
  const shapes: DrawShape[] = [{ orig: game.lastMoves[gamePly][0], dest: game.lastMoves[gamePly][1], brush: "red" }];
  if (a.bestUci && best !== game.sans[gamePly]) {
    shapes.push({ orig: a.bestUci.slice(0, 2) as Key, dest: a.bestUci.slice(2, 4) as Key, brush: "green" });
  }
  return {
    shapes,
    text:
      `Here you played ${full}${turn === "w" ? "." : "..."}${game.sans[gamePly]}${MARKS[a.class]}, a${a.class === "inaccuracy" ? "n" : ""} ${a.class}` +
      `${a.cpLoss && a.cpLoss < 1000 ? ` (lost ${pawns(a.cpLoss).slice(1)})` : ""}.${best ? ` Better: ${best}.` : ""}` +
      `${a.tags.length ? ` (${a.tags.join(", ")})` : ""}`,
  };
}

/** Below the board once a game is over: analysis progress, then a summary and the key moments. */
export function ReviewBar() {
  const { review, annotations, game, gamePly, meta, active, busy } = useStore();
  if (review) {
    return (
      <div className="review-bar">
        <span className="muted">
          Analyzing the game… {review.done}/{review.total}
        </span>
        <span className="review-progress">
          <span style={{ width: `${(100 * review.done) / review.total}%` }} />
        </span>
      </div>
    );
  }
  if (!meta.result || active || !annotations.some(Boolean)) return null;
  const mine = annotations.filter((a, i) => a && isStudentMove(game, meta, i)) as MoveAnnotation[];
  const count = (c: MoveAnnotation["class"]) => mine.filter((a) => a.class === c).length;
  const avg = mine.length ? Math.round(mine.reduce((s, a) => s + a.cpLoss, 0) / mine.length) : 0;
  const moments = keyMoments();
  const next = moments.find((i) => i > gamePly) ?? moments[0];
  const prev = [...moments].reverse().find((i) => i < gamePly) ?? moments[moments.length - 1];

  return (
    <div className="review-bar">
      <span className="review-summary">
        <span className="c-inaccuracy">{count("inaccuracy")} ?!</span>
        <span className="c-mistake">{count("mistake")} ?</span>
        <span className="c-blunder">{count("blunder")} ??</span>
        <span className="muted">avg loss {avg}cp</span>
      </span>
      <span className="spacer" />
      {moments.length > 0 && (
        <>
          <button onClick={() => goto(prev)} title="Previous key moment">
            ◀
          </button>
          <span className="muted small">key moments</span>
          <button onClick={() => goto(next)} title="Next key moment">
            ▶
          </button>
        </>
      )}
      <button onClick={() => sendToCoach(reviewPrompt())} disabled={busy} title="One message with the analysis already done">
        Review with coach
      </button>
    </div>
  );
}

/** One message with the analysis already in it, so the coach doesn't spend turns re-analyzing. */
function reviewPrompt(): string {
  const { game, annotations } = useStore.getState();
  const lines = keyMoments().map((i) => {
    const a = annotations[i]!;
    const fen = game.fens[i];
    const [, turn, , , , full] = fen.split(" ");
    const sign = turn === "w" ? 1 : -1;
    const before = i > 0 ? annotations[i - 1]?.evalAfter : undefined;
    const swing = before !== undefined ? `${pawns(before * sign)} → ${pawns(a.evalAfter * sign)}` : `lost ${a.cpLoss}cp`;
    return `- ${full}${turn === "w" ? "." : "..."}${game.sans[i]}${MARKS[a.class]} ${swing} (my view), best ${san(fen, a.bestUci) ?? "?"}` +
      `${a.tags.length ? ` [${a.tags.join(", ")}]` : ""}\n  fen: ${fen}`;
  });
  return (
    "Let's review this game. The app already analyzed it with Stockfish; these numbers are engine output.\n" +
    (lines.length ? `My mistakes and blunders:\n${lines.join("\n")}\n` : "I made no mistakes or blunders.\n") +
    "Go through the most instructive one or two: what I missed and the idea behind the better move."
  );
}
