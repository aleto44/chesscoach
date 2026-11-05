import { createElement } from "react";
import { imbalance, PIECE_NAMES } from "../chess/material";
import type { Color } from "../store";

/**
 * A strip by the board for one side: the pieces it is up (drawn as the opponent's pieces it
 * has won) and its lead in points, so who is ahead is clear at a glance. Empty when level.
 * The pieces are chessground `piece` elements, so they use the board's own piece set.
 */
export function MaterialStrip({ fen, side }: { fen: string; side: Color }) {
  const { pieces, lead } = imbalance(fen)[side];
  const theirs = side === "white" ? "black" : "white";
  const label = pieces.length ? `${side} is up: ${pieces.map((p) => PIECE_NAMES[p]).join(", ")}` : undefined;
  return (
    <div className="material cg-wrap" aria-label={label} title={label}>
      {pieces.map((p, i) =>
        // Pieces of one type overlap a little, like a stack.
        createElement("piece", { key: i, className: `${theirs} ${PIECE_NAMES[p]} ${pieces[i - 1] === p ? "stacked" : ""}` }),
      )}
      {lead > 0 && <span className="material-lead">+{lead}</span>}
    </div>
  );
}
