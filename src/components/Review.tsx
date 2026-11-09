import { useMemo, type MouseEvent } from "react";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { isStudentMove, keyMoments, labelOf, type KeyMoment, type MoveAnnotation, type MoveLabel } from "../analysis/review";
import { gameReport, LABELS, type GameReport } from "../analysis/report";
import { sendToCoach } from "../coach/bridge";
import { goto, opponentLabel, useStore, type Color, type GameMeta } from "../store";

const MARKS: Partial<Record<MoveAnnotation["class"], string>> = { inaccuracy: "?!", mistake: "?", blunder: "??" };

const pawns = (cp: number) => (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
/** White's view; mates are stored as ±(10000 − distance). */
const evalText = (cp: number) =>
  Math.abs(cp) >= 9000 ? `${cp > 0 ? "" : "-"}#${10000 - Math.abs(cp)}` : pawns(cp);

function san(fen: string, uci: string | null) {
  if (!uci) return null;
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

// ---- Labels ----

const LABEL_INFO: Record<MoveLabel, { name: string; color: string; verdict: string }> = {
  brilliant: { name: "Brilliant", color: "#1baca6", verdict: "is brilliant" },
  great: { name: "Great", color: "#5c8bb0", verdict: "is a great move" },
  best: { name: "Best", color: "#81b64c", verdict: "is best" },
  excellent: { name: "Excellent", color: "#96bc4b", verdict: "is excellent" },
  good: { name: "Good", color: "#95b776", verdict: "is good" },
  book: { name: "Book", color: "#a88865", verdict: "is a book move" },
  inaccuracy: { name: "Inaccuracy", color: "#f0c15c", verdict: "is an inaccuracy" },
  mistake: { name: "Mistake", color: "#e6912c", verdict: "is a mistake" },
  miss: { name: "Miss", color: "#ee6b55", verdict: "is a miss" },
  blunder: { name: "Blunder", color: "#ca3431", verdict: "is a blunder" },
};

const text = (t: string, size = 56) =>
  `<text x="50" y="53" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" ` +
  `font-size="${size}" font-weight="800" letter-spacing="-4" fill="#fff">${t}</text>`;
const stroke = (d: string, w = 10) =>
  `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const GLYPHS: Record<MoveLabel, string> = {
  brilliant: text("!!", 50),
  great: text("!"),
  best: `<polygon points="50,17 59.5,39 83,40.5 65,56 71,80 50,67 29,80 35,56 17,40.5 40.5,39" fill="#fff"/>`,
  excellent:
    `<path d="M27 47h11v30H27z M42 47l10-19c2-5 10-4 10 3l-2 11h14c5 0 8 4 7 8l-4 19c-1 5-4 8-9 8H42z" fill="#fff"/>`,
  good: stroke("M29 52 L44 67 L72 35", 11),
  book: `<path d="M22 30h18c5 0 10 4 10 9v34c0-4-4-7-9-7H22z M78 30H60c-5 0-10 4-10 9v34c0-4 4-7 9-7h19z" fill="#fff"/>`,
  inaccuracy: text("?!", 48),
  mistake: text("?"),
  miss: stroke("M35 35 L65 65 M65 35 L35 65", 11),
  blunder: text("??", 48),
};

/** The label's round icon, as SVG markup in a 100×100 box. */
const iconSvg = (label: MoveLabel) =>
  `<circle cx="50" cy="50" r="48" fill="${LABEL_INFO[label].color}"/>${GLYPHS[label]}`;

export function LabelIcon({ label, size = 18 }: { label: MoveLabel; size?: number }) {
  return (
    <svg
      className="label-icon"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={LABEL_INFO[label].name}
      dangerouslySetInnerHTML={{ __html: `<title>${LABEL_INFO[label].name}</title>${iconSvg(label)}` }}
    />
  );
}

/** Labels worth an icon in the move list; the rest (best, good, book…) would only be noise. */
const LISTED: MoveLabel[] = ["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"];
export const listLabel = (a: MoveAnnotation | null | undefined): MoveLabel | null => {
  if (!a) return null;
  const l = labelOf(a);
  return LISTED.includes(l) ? l : null;
};

// ---- On the board ----

/**
 * At a position where the student is about to go wrong (key moments jump here), what they
 * played and what was better. Null elsewhere.
 */
export function useMoment() {
  const { game, gamePly, annotations, meta, active, gameFork } = useStore();
  return useMemo(() => moment(), [game, gamePly, annotations, meta, active, gameFork]);
}

function moment() {
  const { game, gamePly, annotations, meta, active, gameFork } = useStore.getState();
  // Off the game's own moves (a tangent or what-if moves), the review has nothing to say.
  if (active || gameFork || gamePly >= game.sans.length) return null;
  const a = annotations[gamePly];
  if (!a || !isStudentMove(game, meta, gamePly)) return null;
  const key = keyMoments().find((m) => m.i === gamePly);
  if (!MARKS[a.class] && !key) return null;
  const fen = game.fens[gamePly];
  const [, turn, , , , full] = fen.split(" ");
  const move = `${full}${turn === "w" ? "." : "..."}${game.sans[gamePly]}`;
  const verdict = LABEL_INFO[labelOf(a)].verdict.replace(/^is /, "");
  const played: DrawShape = { orig: game.lastMoves[gamePly][0], dest: game.lastMoves[gamePly][1], brush: MARKS[a.class] ? "red" : "green" };
  if (!MARKS[a.class]) return { shapes: [played], text: `Your move here was ${move}${GOOD_MARKS[labelOf(a)] ?? ""}, ${verdict}.`, reason: key?.reason };
  const best = san(fen, a.bestUci);
  const shapes = [played];
  if (a.bestUci && best !== game.sans[gamePly]) {
    shapes.push({ orig: a.bestUci.slice(0, 2) as Key, dest: a.bestUci.slice(2, 4) as Key, brush: "green" });
  }
  return {
    shapes,
    text: `Your move here was ${move}${MARKS[a.class]}, ${verdict}.${best ? ` Better was ${best}.` : ""}`,
    reason: key?.reason,
  };
}

const GOOD_MARKS: Partial<Record<MoveLabel, string>> = { brilliant: "!!", great: "!" };

/**
 * The review's verdict on the move that led to the position on screen: its label as a badge on
 * the square it went to, and a line for the side column. Null outside the analyzed game.
 */
export function useVerdict() {
  const { game, gamePly, annotations, active, meta, gameFork } = useStore();
  return useMemo(() => {
    const i = gamePly - 1;
    const a = annotations[i];
    if (active || gameFork || i < 0 || !a) return null;
    const label = labelOf(a);
    const fen = game.fens[i];
    const [, turn, , , , full] = fen.split(" ");
    const best = san(fen, a.bestUci);
    const better = best && best !== game.sans[i] && !["best", "book", "brilliant", "great"].includes(label);
    const badge: DrawShape = {
      orig: game.lastMoves[i][1],
      customSvg: { html: `<g transform="translate(64 -6) scale(0.42)">${iconSvg(label)}</g>` },
    };
    return {
      label,
      move: `${full}${turn === "w" ? "." : "..."}${game.sans[i]}`,
      verdict: LABEL_INFO[label].verdict,
      best: better ? best : null,
      eval: evalText(a.evalAfter),
      badge,
      /** A bad move of the student's: worth saying why. */
      explain: !!MARKS[a.class] && isStudentMove(game, meta, i),
      /** Why this move swung the game, when it's one of the key moments. */
      reason: keyMoments().find((m) => m.i === i)?.reason,
    };
  }, [game, gamePly, annotations, active, meta, gameFork]);
}

export function VerdictLine({ v }: { v: NonNullable<ReturnType<typeof useVerdict>> }) {
  return (
    <div className={`verdict l-${v.label}`}>
      <LabelIcon label={v.label} size={22} />
      <span className="verdict-text">
        <strong>{v.move}</strong> {v.verdict}
        {v.best && <span className="muted"> · best was {v.best}</span>}
      </span>
      <span className="verdict-eval">{v.eval}</span>
    </div>
  );
}

// ---- The report ----

/** The rating the game was played at: the bot's, when there was one. */
const reportAnchor = (meta: GameMeta) =>
  meta.studentColor === "both" ? null : meta.imported ? meta.imported.opponentRating : meta.opponentElo;

export function useGameReport(): GameReport | null {
  const game = useStore((s) => s.game);
  const annotations = useStore((s) => s.annotations);
  const anchor = useStore((s) => reportAnchor(s.meta));
  return useMemo(() => gameReport(game, annotations, anchor), [game, annotations, anchor]);
}

const playerName = (meta: GameMeta, side: Color) =>
  meta.studentColor === "both" ? (side === "white" ? "White" : "Black") : side === meta.studentColor ? "You" : opponentLabel(meta);

/** White's winning chances over the game; click to jump to a move. */
function EvalGraph({ report }: { report: GameReport }) {
  const { annotations, gamePly } = useStore();
  const wins = report.winPercents;
  const n = wins.length - 1;
  const x = (i: number) => (100 * i) / n;
  const area = `M0,100 ${wins.map((w, i) => `L${x(i)},${100 - w}`).join(" ")} L100,100 Z`;
  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    goto(Math.round(((e.clientX - r.left) / r.width) * n));
  };
  return (
    <div className="eval-graph" onClick={pick} title="Click to go to that move">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path d={area} className="eval-graph-white" />
        <line x1="0" y1="50" x2="100" y2="50" className="eval-graph-mid" vectorEffect="non-scaling-stroke" />
        <line x1={x(gamePly)} y1="0" x2={x(gamePly)} y2="100" className="eval-graph-now" vectorEffect="non-scaling-stroke" />
      </svg>
      {annotations.map((a, i) => {
        const l = listLabel(a);
        return (
          l && (
            <span
              key={i}
              className="eval-graph-dot"
              style={{ left: `${x(i + 1)}%`, top: `${100 - wins[i + 1]}%`, background: LABEL_INFO[l].color }}
            />
          )
        );
      })}
    </div>
  );
}

const PHASES = [
  ["opening", "Opening"],
  ["middlegame", "Middlegame"],
  ["endgame", "Endgame"],
] as const;

/** chess.com-style summary in the side column: accuracy, move counts by label, rating, phases. */
export function GameReportPanel({ report }: { report: GameReport }) {
  const meta = useStore((s) => s.meta);
  const busy = useStore((s) => s.busy);
  const sides = ["white", "black"] as const;
  const you = (s: Color) => (s === meta.studentColor ? "you" : "");
  return (
    <div className="report">
      <EvalGraph report={report} />
      <div className="report-grid">
        <span />
        {sides.map((s) => (
          <span key={s} className={`report-player ${you(s)}`} style={{ gridColumn: s === "white" ? 2 : 4 }}>
            <span className={`player-piece ${s}`} aria-hidden />
            {playerName(meta, s)}
          </span>
        ))}

        <span className="report-key">Accuracy</span>
        <span className={`report-box ${sides[0]}`}>{report.white.accuracy?.toFixed(1) ?? "–"}</span>
        <span />
        <span className={`report-box ${sides[1]}`}>{report.black.accuracy?.toFixed(1) ?? "–"}</span>

        <hr />
        {LABELS.map((l) => (
          <div key={l} className={`report-row ${report.white.counts[l] + report.black.counts[l] ? "" : "zero"}`}>
            <span className="report-key">{LABEL_INFO[l].name}</span>
            <span className="report-count" style={{ color: LABEL_INFO[l].color }}>{report.white.counts[l]}</span>
            <LabelIcon label={l} />
            <span className="report-count" style={{ color: LABEL_INFO[l].color }}>{report.black.counts[l]}</span>
          </div>
        ))}

        <hr />
        <span className="report-key" title="A rough chess.com-scale estimate from this one game's accuracy, pulled toward the opponent's rating">
          Game rating
        </span>
        <span className="report-box white">{report.white.rating ?? "–"}</span>
        <span />
        <span className="report-box black">{report.black.rating ?? "–"}</span>

        <hr />
        {PHASES.map(([p, name]) => (
          <div key={p} className="report-row">
            <span className="report-key">{name}</span>
            {sides.map((s) => {
              const v = report[s].phases[p];
              return (
                <span key={s} className="report-phase" style={{ gridColumn: s === "white" ? 2 : 4 }}>
                  {v ? <LabelIcon label={v} size={22} /> : <span className="muted">–</span>}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="report-actions">
        <button
          className="primary"
          onClick={() => {
            useStore.setState({ reportOpen: false });
            goto(1);
          }}
        >
          Start review
        </button>
        <button onClick={() => sendToCoach(reviewPrompt())} disabled={busy} title="One message with the analysis already done">
          Review with coach
        </button>
      </div>
    </div>
  );
}

/** Below the moves once a game is over: analysis progress, then the report toggle and key moments. */
export function ReviewBar() {
  const { review, annotations, gamePly, meta, active, busy, reportOpen } = useStore();
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
  const moments = keyMoments().map((m) => m.i);
  // No wrapping: past the last moment (or before the first) the arrow does nothing.
  const next = moments.find((i) => i > gamePly);
  const prev = [...moments].reverse().find((i) => i < gamePly);

  return (
    <div className="review-bar">
      <button onClick={() => useStore.setState({ reportOpen: !reportOpen })} aria-pressed={reportOpen}>
        {reportOpen ? "Moves" : "Game report"}
      </button>
      <span className="spacer" />
      {moments.length > 0 && (
        // One group, so the arrows never wrap away from their label.
        <span className="moments">
          <button onClick={() => prev !== undefined && goto(prev)} disabled={prev === undefined} title="Previous key moment" aria-label="Previous key moment">
            ◀
          </button>
          <span className="muted small">key moments</span>
          <button onClick={() => next !== undefined && goto(next)} disabled={next === undefined} title="Next key moment" aria-label="Next key moment">
            ▶
          </button>
        </span>
      )}
      {!reportOpen && (
        <button onClick={() => sendToCoach(reviewPrompt())} disabled={busy} title="One message with the analysis already done">
          Review with coach
        </button>
      )}
    </div>
  );
}

/** One message with the analysis already in it, so the coach doesn't spend turns re-analyzing. */
function reviewPrompt(): string {
  const { game, annotations, meta } = useStore.getState();
  const report = gameReport(game, annotations, reportAnchor(meta));
  const moments = keyMoments();
  const line = ({ i, reason }: KeyMoment) => {
    const a = annotations[i]!;
    const fen = game.fens[i];
    const [, turn, , , , full] = fen.split(" ");
    const sign = turn === "w" ? 1 : -1;
    const before = a.evalBefore ?? (i > 0 ? annotations[i - 1]?.evalAfter : undefined);
    const swing = before !== undefined ? `${pawns(before * sign)} → ${pawns(a.evalAfter * sign)}` : `lost ${a.cpLoss}cp`;
    const best = san(fen, a.bestUci);
    return `- ${full}${turn === "w" ? "." : "..."}${game.sans[i]}${MARKS[a.class] ?? ""} (${labelOf(a)}) ${swing} (my view)` +
      `${best && best !== game.sans[i] ? `, best ${best}` : ""}${a.tags.length ? ` [${a.tags.join(", ")}]` : ""}` +
      `\n  why it mattered: ${reason}\n  fen: ${fen}`;
  };
  const lines = moments.filter((m) => !m.good).map(line);
  const goods = moments.filter((m) => m.good).map(line);
  const mine = meta.studentColor === "both" ? null : report?.[meta.studentColor];
  const summary = mine?.accuracy
    ? `My accuracy: ${mine.accuracy.toFixed(1)}%. ` +
      LABELS.filter((l) => mine.counts[l]).map((l) => `${mine.counts[l]} ${l}`).join(", ") +
      ".\n"
    : "";
  return (
    "Let's review this game. The app already analyzed it with Stockfish; these numbers are engine output.\n" +
    summary +
    (lines.length ? `My mistakes and blunders:\n${lines.join("\n")}\n` : "I made no mistakes or blunders.\n") +
    (goods.length ? `Where I swung the game my way:\n${goods.join("\n")}\n` : "") +
    "Go through the most instructive one or two mistakes: what I missed and the idea behind the better move." +
    (goods.length ? " Then tell me briefly what made my best move work, so I'd find it again." : "")
  );
}
