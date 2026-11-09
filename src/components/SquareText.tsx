// Squares and moves named in text show on the board on screen: a mouse shows one while over it, a
// tap shows it until the next tap (useTapAway). The coach's chat uses SquareRef through its markdown;
// any other text about a position (trainer messages, opening plans) goes through SquareText.
import { type ComponentProps } from "react";
import { hoverSquare, splitSquares, useHoverSquare } from "../chess/squareRefs";
import { useSheet } from "../phone";

/** One square or move. `ref` may start with the side it's for ("w:" / "b:"), see splitSquares. */
export function SquareRef({ squareRef, className, ...props }: ComponentProps<"span"> & { squareRef: string }) {
  const on = useHoverSquare((s) => s.ref === squareRef);
  return (
    <span
      {...props}
      className={`sq-ref ${className ?? ""} ${on ? "on" : ""}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && hoverSquare(squareRef)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hoverSquare(null)}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        hoverSquare(on ? null : squareRef);
        // The board must be in view: a full chat sheet drops to under it.
        if (!on && useSheet.getState().sheet === "full") useSheet.setState({ sheet: "half" });
      }}
    />
  );
}

/** Plain text with its squares and moves made into SquareRefs. */
export function SquareText({ text }: { text: string }) {
  return (
    <>
      {splitSquares(text).map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <SquareRef key={i} squareRef={part.ref}>
            {part.text}
          </SquareRef>
        ),
      )}
    </>
  );
}
