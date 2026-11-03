import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";
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
  coordinates?: boolean;
  className?: string;
}

/** Thin React wrapper around Chessground; chess.js supplies legal destinations. */
export function Board({
  fen,
  orientation = "white",
  lastMove,
  onMove,
  viewOnly,
  canMove = true,
  coordinates = true,
  className,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const props = useRef({ fen, orientation, lastMove, onMove, viewOnly, canMove });
  props.current = { fen, orientation, lastMove, onMove, viewOnly, canMove };

  // Re-applies props; also used after a move so a rejected move snaps back.
  const sync = () => {
    const p = props.current;
    const turn = sideToMove(p.fen);
    const config: Config = {
      fen: p.fen,
      orientation: p.orientation,
      lastMove: p.lastMove,
      turnColor: turn,
      check: new Chess(p.fen).inCheck(),
      movable: {
        color: p.viewOnly || !p.canMove ? undefined : turn,
        dests: p.viewOnly || !p.canMove ? new Map() : legalDests(p.fen),
      },
    };
    api.current?.set(config);
  };

  useEffect(() => {
    api.current = Chessground(el.current!, {
      coordinates,
      viewOnly: !!viewOnly,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
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

  useEffect(sync, [fen, orientation, lastMove, viewOnly, canMove]);

  return <div ref={el} className={className ?? "cg-board-wrap"} />;
}
