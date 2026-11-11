import { useEffect, useRef, useState } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import { Chess } from "chess.js";
import { legalDests, sideToMove } from "../chess/line";
import { afterUci, resolveRef, samePosition, useHoverSquare } from "../chess/squareRefs";
import { play } from "../sound";
import { MOVE_CHAR, MOVE_START, legalNow, queuedPosition, readTyped, type Queued } from "../chess/typed";

interface Props {
  fen: string;
  orientation?: "white" | "black";
  lastMove?: [Key, Key];
  /** `promotion` is set ("q", "r", "b", "n") when a pawn reaches the last rank. */
  onMove?: (from: Key, to: Key, promotion?: string) => void;
  /** No moves on this board. The student can still draw on it: every board on screen takes drawings. */
  viewOnly?: boolean;
  /** A thumbnail inside a button (chat cards): no moves and no drawing, clicks go to the button. */
  preview?: boolean;
  /** False locks the pieces without making the board view-only (e.g. opponent's turn). */
  canMove?: boolean;
  /** The student's side: on the other side's turn its pieces still pick up and queue a premove (played when its turn comes). */
  premoveColor?: "white" | "black";
  coordinates?: boolean;
  className?: string;
  /** Arrows and circles drawn by the app (best moves, the coach's draw_arrows). */
  shapes?: DrawShape[];
  /** A click or tap on a square (left button / one finger), for boards that ask the student to pick squares. */
  onSquare?: (key: Key) => void;
}

const PROMO_NAMES = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" };
const WHITE_GLYPHS = { q: "♕", r: "♖", b: "♗", n: "♘" };
const BLACK_GLYPHS = { q: "♛", r: "♜", b: "♝", n: "♞" };

/**
 * Boards that take typed moves (desktop keyboard), latest mounted last: the analysis layer's board
 * wins over the screen under it. Keys go to the last one that is on screen, unless the student is
 * typing in a field (the coach's chat) or a dialog is open.
 */
const typers: { el: () => HTMLElement | null; key: (e: KeyboardEvent) => boolean }[] = [];
let listening = false;
function listenForTyping() {
  if (listening) return;
  listening = true;
  // Capture, so Escape and Enter for a typed move don't also reach the app's own shortcuts.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if ((e.target as HTMLElement | null)?.closest?.("textarea, input, select, [contenteditable]")) return;
      if (document.querySelector(".modal-backdrop, .promo-backdrop, .puzzle-settings-pop")) return;
      for (let i = typers.length - 1; i >= 0; i--) {
        const el = typers[i].el();
        if (!el?.isConnected || !el.getClientRects().length) continue;
        if (typers[i].key(e)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
    },
    true,
  );
}

/** Thin React wrapper around Chessground; chess.js supplies legal destinations. */
export function Board({
  fen,
  orientation = "white",
  lastMove,
  onMove,
  viewOnly,
  preview,
  canMove = true,
  premoveColor,
  coordinates = true,
  className,
  shapes,
  onSquare,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  // A pawn just reached the last rank: the move waits for the student's choice of piece.
  // `queued`: the pawn was typed as a premove, so the choice joins the queue instead of being played.
  const [promo, setPromo] = useState<{ from: Key; to: Key; color: "white" | "black"; queued?: boolean } | null>(null);
  const api = useRef<Api | null>(null);
  // The position Chessground has, so re-syncing the same position keeps the student's drawings.
  const shown = useRef<string | null>(null);
  /**
   * A hovered move from another position is on the board instead of `fen` (see below): which one,
   * and the student's drawings from before it, to put back on `drawnOn` when it ends.
   */
  const peek = useRef<{ fen: string | null; drawings: DrawShape[]; drawnOn: string } | null>(null);
  const [peeking, setPeeking] = useState(false);
  // A move being typed on the keyboard; `shake` counts rejected Enters so the box shakes each time.
  const [typed, setTypedState] = useState("");
  const typedRef = useRef("");
  const setTyped = (t: string) => {
    typedRef.current = t;
    setTypedState(t);
  };
  const [shake, setShake] = useState(0);
  /**
   * Moves typed on the opponent's turn, played one per turn as each of the student's turns comes.
   * If the next one isn't legal when its turn comes, the whole queue goes: the rest were planned
   * around it. `playedAt` is the position the last one was played from, so a re-sync before the
   * new position arrives doesn't play the next one there too.
   */
  const [queue, setQueueState] = useState<Queued[]>([]);
  const queueRef = useRef<Queued[]>([]);
  const setQueue = (q: Queued[]) => {
    queueRef.current = q;
    setQueueState(q);
  };
  const playedAt = useRef<string | null>(null);
  const typedShapes = useRef<DrawShape[]>([]);
  const props = useRef({ fen, orientation, lastMove, onMove, viewOnly, canMove, premoveColor, shapes, onSquare });
  props.current = { fen, orientation, lastMove, onMove, viewOnly, canMove, premoveColor, shapes, onSquare };

  // Re-applies props; also used after a move so a rejected move snaps back.
  // A queued premove is played as soon as the student is allowed to move again.
  const sync = () => {
    const p = props.current;
    const cg = api.current;
    // While a hovered move's position is shown, the board's own comes back when the hover ends.
    if (!cg || peek.current) return;
    const turn = sideToMove(p.fen);
    // On the other side's turn the student's pieces still pick up, as a premove: they often know
    // the next moves and reach for the piece before the reply lands. That holds whether or not
    // the screen calls the board movable then (drills and puzzles leave it on through the reply).
    const premove = !p.viewOnly && p.premoveColor && p.premoveColor !== turn ? p.premoveColor : undefined;
    const live = !p.viewOnly && p.canMove && !premove;
    const config: Config = {
      // Passing the fen clears the drawings, so only pass it when the position changed.
      ...(shown.current === p.fen ? {} : { fen: p.fen }),
      orientation: p.orientation,
      lastMove: p.lastMove,
      turnColor: turn,
      check: new Chess(p.fen).inCheck(),
      movable: { color: live ? turn : premove, dests: live ? legalDests(p.fen) : new Map() },
    };
    cg.set(config);
    shown.current = p.fen;
    cg.setAutoShapes([...(p.shapes ?? []), ...typedShapes.current]);
    if (live) cg.playPremove();
    else if (!premove) cg.cancelPremove();
    const next = queueRef.current[0];
    if (!next) return;
    if (!live && !premove) setQueue([]);
    else if (live && playedAt.current !== p.fen) {
      if (!legalNow(p.fen, next)) {
        setQueue([]);
        return;
      }
      setQueue(queueRef.current.slice(1));
      playedAt.current = p.fen;
      cg.move(next.from, next.to);
      shown.current = null;
      p.onMove?.(next.from, next.to, next.promotion);
    }
  };

  useEffect(() => {
    api.current = Chessground(el.current!, {
      coordinates,
      // Only thumbnails are view-only in Chessground's sense, which also turns drawing off.
      viewOnly: !!preview,
      // Every touch on the board is the board's, not only ones near a piece: a touch the page
      // doesn't claim lets the phone start its long press, which cancels the touch mid-drag.
      blockTouchScroll: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: true, showDests: true, castle: true, events: {
          set: () => {
            // A dragged premove replaces typed ones: one plan at a time.
            setQueue([]);
            play("premove");
          },
        },
      },
      // Arrows go between any two squares, not just ones a piece could reach.
      drawable: { defaultSnapToValidMove: false },
      // Chessground calls select on every left click / one-finger touch on a square, not on drawing.
      events: { select: (key) => props.current.onSquare?.(key) },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (from, to) => {
            // Chessground already moved the piece: the next sync must set the position again.
            shown.current = null;
            setTyped("");
            const piece = new Chess(props.current.fen).get(from as never);
            if (piece?.type === "p" && (to[1] === "8" || to[1] === "1")) {
              setPromo({ from, to, color: piece.color === "w" ? "white" : "black" });
              return;
            }
            props.current.onMove?.(from, to);
            queueMicrotask(sync);
          },
        },
      },
    });
    // A new Chessground starts from the initial position, whatever an earlier one showed.
    shown.current = null;
    sync();
    return () => api.current?.destroy();
  }, []);

  useEffect(sync, [fen, orientation, lastMove, viewOnly, canMove, premoveColor, shapes]);

  // Only the side to move is typed, so a board that plays both sides (analysis, what-ifs) takes both.
  const typeable = !preview && !viewOnly && !!onMove;
  const canTypeNow = () => {
    const p = props.current;
    return !p.viewOnly && p.canMove && !!p.onMove && !(p.premoveColor && p.premoveColor !== sideToMove(p.fen));
  };
  /** On the opponent's turn typed moves are premoves, read from where the queue leaves the student. */
  const premoving = (p: typeof props.current) =>
    !p.viewOnly && !!p.onMove && !!p.premoveColor && p.premoveColor !== sideToMove(p.fen);
  const typingFen = (p: typeof props.current, q: Queued[]) =>
    premoving(p) ? queuedPosition(p.fen, p.premoveColor!, q) : canTypeNow() ? p.fen : null;
  const readFen = typed ? typingFen(props.current, queue) : null;
  const reading = typed && readFen ? readTyped(readFen, typed, api.current?.state.selected) : null;

  const submit = () => {
    const p = props.current;
    const at = typingFen(p, queueRef.current);
    const r = at ? readTyped(at, typedRef.current, api.current?.state.selected) : null;
    if (r?.status !== "ok" || !r.from || !r.to) {
      play("illegal");
      setShake((n) => n + 1);
      return;
    }
    setTyped("");
    const { from, to } = r;
    if (premoving(p)) {
      // Typed premoves are kept here, not in Chessground, which holds only one.
      api.current?.cancelPremove();
      if (r.needsPromotion) setPromo({ from, to, color: p.premoveColor!, queued: true });
      else {
        setQueue([...queueRef.current, { from, to, promotion: r.promotion }]);
        play("premove");
      }
      return;
    }
    // Played on the board the way a dragged piece is, so it animates; the next sync sets the real position.
    if (!peek.current) {
      api.current?.move(from, to);
      shown.current = null;
    }
    if (r.needsPromotion) {
      setPromo({ from, to, color: sideToMove(p.fen) });
      return;
    }
    p.onMove?.(from, to, r.promotion);
    queueMicrotask(sync);
  };

  const keyRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  keyRef.current = (e) => {
    const text = typedRef.current;
    if (!text) {
      // With nothing typed, Escape drops the queued premoves and Backspace the last one.
      if (queueRef.current.length && (e.key === "Escape" || e.key === "Backspace")) {
        setQueue(e.key === "Escape" ? [] : queueRef.current.slice(0, -1));
        return true;
      }
      if (!MOVE_START.test(e.key)) return false;
      setTyped(e.key);
      return true;
    }
    if (e.key === "Escape") setTyped("");
    else if (e.key === "Backspace") setTyped(text.slice(0, -1));
    else if (e.key === "Enter") submit();
    else if (MOVE_CHAR.test(e.key)) setTyped(text.length < 10 ? text + e.key : text);
    else return false;
    return true;
  };
  useEffect(() => {
    if (!typeable) return;
    listenForTyping();
    const typer = { el: () => el.current, key: (e: KeyboardEvent) => keyRef.current(e) };
    typers.push(typer);
    return () => {
      typers.splice(typers.indexOf(typer), 1);
      setTyped("");
      setQueue([]);
    };
  }, [typeable]);

  // The typed move on the board: its piece circled once the square is typed, then the move as an arrow.
  // Queued premoves show as numbered arrows in the order they'll be played.
  useEffect(() => {
    const r = reading;
    const now: DrawShape[] =
      r?.status === "ok" && r.from && r.to
        ? [{ orig: r.from, dest: r.to, brush: "green" }]
        : r?.status === "partial" && r.from
          ? [{ orig: r.from, brush: "green" }]
          : [];
    typedShapes.current = [
      ...queue.map((m, i): DrawShape => ({ orig: m.from, dest: m.to, brush: "paleRed", label: { text: String(i + 1) } })),
      ...now,
    ];
    if (!peek.current) api.current?.setAutoShapes([...(shapes ?? []), ...typedShapes.current]);
  }, [reading?.status, reading?.from, reading?.to, shapes, queue]);

  // A square or move the mouse is over in text shows here (not on thumbnails): a move as an arrow
  // from its piece, a bare square highlighted. A move from another position (further down a line,
  // or a move the text names from before) shows that position for as long as it's hovered, with
  // the line's moves up to it as numbered arrows; the student's drawings come back afterwards.
  const hoveredRef = useHoverSquare((s) => (preview ? null : s.ref));
  const hoveredPlace = useHoverSquare((s) => (preview ? null : s.place));
  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    const place = hoveredRef ? hoveredPlace : null;
    let elsewhere: string | null = null;
    let arrows: DrawShape[] = [];
    let square: Key | null = null;
    let peekLast: [Key, Key] | undefined;
    if (place?.uci) {
      const arrow = (uci: string): DrawShape => ({ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key });
      const after = afterUci(place.fen, place.uci);
      if (samePosition(place.fen, fen) || (after && samePosition(after, fen))) {
        // The position on screen, or the move that led to it: an arrow on the board as it is.
        arrows = [{ ...arrow(place.uci), brush: "blue" }];
      } else {
        const trail = place.trail ?? [];
        elsewhere = place.fen;
        const n = trail.length ? (i: number) => ({ label: { text: String(i + 1) } }) : () => ({});
        arrows = [
          ...trail.map((u, i) => ({ ...arrow(u), brush: "paleBlue", ...n(i) })),
          { ...arrow(place.uci), brush: "blue", ...n(trail.length) },
        ];
        const lastUci = trail[trail.length - 1];
        peekLast = lastUci ? [lastUci.slice(0, 2) as Key, lastUci.slice(2, 4) as Key] : undefined;
      }
    } else if (hoveredRef) {
      const hit = resolveRef(fen, hoveredRef);
      if (hit?.from) arrows = [{ orig: hit.from, dest: hit.to, brush: "blue" }];
      else if (hit) square = hit.to;
    }

    if (elsewhere) {
      // Into a hovered position from the board's own it jumps; from one move of a line to the next it animates.
      const jump = !peek.current;
      if (!peek.current) peek.current = { fen: null, drawings: cg.state.drawable.shapes.slice(), drawnOn: props.current.fen };
      if (peek.current.fen !== elsewhere) {
        cg.set({
          animation: { enabled: !jump },
          fen: elsewhere,
          lastMove: peekLast,
          turnColor: sideToMove(elsewhere),
          check: new Chess(elsewhere).inCheck(),
          movable: { color: undefined, dests: new Map() },
        });
        cg.set({ animation: { enabled: true } });
        cg.cancelPremove();
        peek.current.fen = elsewhere;
        shown.current = elsewhere;
      }
      setPeeking(true);
      cg.set({ highlight: { custom: new Map() } });
      cg.setAutoShapes(arrows);
      return;
    }
    if (peek.current) {
      // Back to the board's own position, with the student's drawings if it's still the same one.
      const { drawings, drawnOn } = peek.current;
      peek.current = null;
      setPeeking(false);
      cg.set({ animation: { enabled: false } });
      sync();
      cg.set({ animation: { enabled: true } });
      if (drawnOn === props.current.fen) cg.setShapes(drawings);
    }
    cg.set({ highlight: { custom: new Map(square ? [[square, "chat-hover"]] : []) } });
    cg.setAutoShapes([...(shapes ?? []), ...typedShapes.current, ...arrows]);
  }, [hoveredRef, hoveredPlace, fen, shapes]);

  const choose = (piece: string | null) => {
    const move = promo;
    setPromo(null);
    if (move?.queued) {
      if (piece) {
        setQueue([...queueRef.current, { from: move.from, to: move.to, promotion: piece }]);
        play("premove");
      }
      return;
    }
    if (move && piece) props.current.onMove?.(move.from, move.to, piece);
    queueMicrotask(sync);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  /**
   * When the picker opened. A phone sends emulated mouse events for the touch that dropped the pawn
   * once the finger lifts, after the picker is up; the drop square is on the edge rank, outside the
   * centred picker, so that stale press landed on the backdrop and cancelled the promotion. Presses
   * this soon after opening are that touch, not a choice.
   */
  const promoOpened = useRef(0);
  const settled = () => performance.now() - promoOpened.current > 400;

  // Keyboard: 1–4 (or q, r, b, n) pick the piece in the picker's order, Escape cancels.
  useEffect(() => {
    if (!promo) return;
    promoOpened.current = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const piece = ({ "1": "q", "2": "r", "3": "b", "4": "n", q: "q", r: "r", b: "b", n: "n" } as Record<string, string>)[k];
      if (piece) chooseRef.current(piece);
      else if (e.key === "Escape") chooseRef.current(null);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [promo]);

  // Thumbnails can't promote; keep them a single element for their layouts.
  if (preview) return <div ref={el} className={className ?? "cg-board-wrap"} />;
  return (
    <div className={`board-holder ${peeking ? "peeking" : ""}`}>
      <div ref={el} className={className ?? "cg-board-wrap"} />
      {typed && (
        <div
          key={shake}
          className={`typed-move ${reading?.status ?? "waiting"} ${shake ? "shake" : ""}`}
          role="status"
          aria-label={`Typed move ${typed}`}
        >
          <span className="typed-text">{typed}</span>
          <span className="typed-hint">
            {reading?.status === "ok"
              ? premoving(props.current)
                ? "Enter ↵ to premove"
                : "Enter ↵"
              : reading
                ? "Esc to cancel"
                : "not your move"}
          </span>
        </div>
      )}
      {promo && (
        <div className="promo-backdrop" onMouseDown={() => settled() && choose(null)}>
          <div className="promo-picker" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Promote to">
            {(["q", "r", "b", "n"] as const).map((p, i) => (
              <button
                key={p}
                onClick={() => settled() && choose(p)}
                title={`${PROMO_NAMES[p]} (${i + 1})`}
                aria-label={PROMO_NAMES[p]}
              >
                {(promo.color === "white" ? WHITE_GLYPHS : BLACK_GLYPHS)[p]}
                <span className="promo-key">{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
