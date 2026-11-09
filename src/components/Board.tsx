import { useEffect, useRef, useState } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import { Chess } from "chess.js";
import { legalDests, sideToMove } from "../chess/line";
import { resolveRef, useHoverSquare } from "../chess/squareRefs";
import { play } from "../sound";

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
}

const PROMO_NAMES = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" };
const WHITE_GLYPHS = { q: "♕", r: "♖", b: "♗", n: "♘" };
const BLACK_GLYPHS = { q: "♛", r: "♜", b: "♝", n: "♞" };

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
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  // A pawn just reached the last rank: the move waits for the student's choice of piece.
  const [promo, setPromo] = useState<{ from: Key; to: Key; color: "white" | "black" } | null>(null);
  const api = useRef<Api | null>(null);
  // The position Chessground has, so re-syncing the same position keeps the student's drawings.
  const shown = useRef<string | null>(null);
  const props = useRef({ fen, orientation, lastMove, onMove, viewOnly, canMove, premoveColor, shapes });
  props.current = { fen, orientation, lastMove, onMove, viewOnly, canMove, premoveColor, shapes };

  // Re-applies props; also used after a move so a rejected move snaps back.
  // A queued premove is played as soon as the student is allowed to move again.
  const sync = () => {
    const p = props.current;
    const cg = api.current;
    if (!cg) return;
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
    cg.setAutoShapes(p.shapes ?? []);
    if (live) cg.playPremove();
    else if (!premove) cg.cancelPremove();
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
      premovable: { enabled: true, showDests: true, castle: true, events: { set: () => play("premove") } },
      // Arrows go between any two squares, not just ones a piece could reach.
      drawable: { defaultSnapToValidMove: false },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (from, to) => {
            // Chessground already moved the piece: the next sync must set the position again.
            shown.current = null;
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

  // A square or move the mouse is over in the coach's chat shows here (not on thumbnails):
  // a move as an arrow from its piece, a bare square highlighted.
  const hoveredRef = useHoverSquare((s) => (preview ? null : s.ref));
  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    const hit = hoveredRef ? resolveRef(fen, hoveredRef) : null;
    const square = hit && !hit.from ? [[hit.to as Key, "chat-hover"] as const] : [];
    cg.set({ highlight: { custom: new Map(square) } });
    const arrow: DrawShape[] = hit?.from ? [{ orig: hit.from, dest: hit.to, brush: "blue" }] : [];
    cg.setAutoShapes([...(shapes ?? []), ...arrow]);
  }, [hoveredRef, fen, shapes]);

  const choose = (piece: string | null) => {
    const move = promo;
    setPromo(null);
    if (move && piece) props.current.onMove?.(move.from, move.to, piece);
    queueMicrotask(sync);
  };

  // Thumbnails can't promote; keep them a single element for their layouts.
  if (preview) return <div ref={el} className={className ?? "cg-board-wrap"} />;
  return (
    <div className="board-holder">
      <div ref={el} className={className ?? "cg-board-wrap"} />
      {promo && (
        <div className="promo-backdrop" onMouseDown={() => choose(null)}>
          <div className="promo-picker" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Promote to">
            {(["q", "r", "b", "n"] as const).map((p) => (
              <button key={p} onClick={() => choose(p)} title={PROMO_NAMES[p]} aria-label={PROMO_NAMES[p]}>
                {(promo.color === "white" ? WHITE_GLYPHS : BLACK_GLYPHS)[p]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
