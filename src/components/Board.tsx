import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import { Chess } from "chess.js";
import { legalDests, sideToMove } from "../chess/line";

interface Props {
  fen: string;
  orientation?: "white" | "black";
  lastMove?: [Key, Key];
  onMove?: (from: Key, to: Key) => void;
  viewOnly?: boolean;
  /** False locks the pieces without making the board view-only (e.g. opponent's turn). */
  canMove?: boolean;
  /** While the student can't move, this side may queue a premove (played when its turn comes). */
  premoveColor?: "white" | "black";
  coordinates?: boolean;
  className?: string;
  /** Arrows and circles drawn by the app (best moves, the coach's draw_arrows). */
  shapes?: DrawShape[];
}

/** Thin React wrapper around Chessground; chess.js supplies legal destinations. */
export function Board({
  fen,
  orientation = "white",
  lastMove,
  onMove,
  viewOnly,
  canMove = true,
  premoveColor,
  coordinates = true,
  className,
  shapes,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const props = useRef({ fen, orientation, lastMove, onMove, viewOnly, canMove, premoveColor, shapes });
  props.current = { fen, orientation, lastMove, onMove, viewOnly, canMove, premoveColor, shapes };

  // Re-applies props; also used after a move so a rejected move snaps back.
  // A queued premove is played as soon as the student is allowed to move again.
  const sync = () => {
    const p = props.current;
    const cg = api.current;
    if (!cg) return;
    const turn = sideToMove(p.fen);
    const live = !p.viewOnly && p.canMove;
    const premove = !p.viewOnly && !p.canMove && p.premoveColor !== turn ? p.premoveColor : undefined;
    const config: Config = {
      fen: p.fen,
      orientation: p.orientation,
      lastMove: p.lastMove,
      turnColor: turn,
      check: new Chess(p.fen).inCheck(),
      movable: { color: live ? turn : premove, dests: live ? legalDests(p.fen) : new Map() },
    };
    cg.set(config);
    cg.setAutoShapes(p.shapes ?? []);
    if (live) cg.playPremove();
    else if (!premove) cg.cancelPremove();
  };

  useEffect(() => {
    api.current = Chessground(el.current!, {
      coordinates,
      viewOnly: !!viewOnly,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: true, showDests: true, castle: true },
      // Arrows go between any two squares, not just ones a piece could reach.
      drawable: { defaultSnapToValidMove: false },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (from, to) => {
            props.current.onMove?.(from, to);
            queueMicrotask(sync);
          },
        },
      },
    });
    sync();
    return () => api.current?.destroy();
  }, []);

  useEffect(sync, [fen, orientation, lastMove, viewOnly, canMove, premoveColor, shapes]);

  return <div ref={el} className={className ?? "cg-board-wrap"} />;
}
