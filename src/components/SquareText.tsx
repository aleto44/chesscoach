// Squares and moves named in text show on the board on screen: a mouse shows one while over it, a
// tap shows it until the next tap (useTapAway). The coach's chat uses SquareRef through its markdown;
// any other text about a position (trainer messages, opening plans) goes through SquareText.
import { useMemo, type ComponentProps } from "react";
import { hoverSquare, sameRef, splitSquares, useHoverSquare, type RefContext, type RefPlace } from "../chess/squareRefs";
import { useSheet } from "../phone";

/**
 * One square or move. `ref` may start with the side it's for ("w:" / "b:"), see splitSquares;
 * `place` is where the move is played from, when the text says (the board then shows that position).
 */
export function SquareRef({
  squareRef,
  place,
  className,
  ...props
}: ComponentProps<"span"> & { squareRef: string; place?: RefPlace | null }) {
  const on = useHoverSquare((s) => sameRef(s, squareRef, place));
  return (
    <span
      {...props}
      className={`sq-ref ${className ?? ""} ${on ? "on" : ""}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && hoverSquare(squareRef, place)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hoverSquare(null)}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        hoverSquare(on ? null : squareRef, place);
        // The board must be in view: a full chat sheet drops to under it.
        if (!on && useSheet.getState().sheet === "full") useSheet.setState({ sheet: "half" });
      }}
    />
  );
}

/**
 * Plain text with its squares and moves made into SquareRefs. `at` is the position the text speaks
 * from, so a move it names is played from there (and a line it writes out, move after move),
 * whatever the board shows at the moment.
 */
export function SquareText({ text, at, earlier, game, played }: { text: string } & RefContext) {
  const earlierKey = earlier?.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `earlier` by value: callers build it each render.
  const parts = useMemo(() => splitSquares(text, { at, earlier, game, played }), [text, at, earlierKey, game, played]);
  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <SquareRef key={i} squareRef={part.ref} place={part.place}>
            {part.text}
          </SquareRef>
        ),
      )}
    </>
  );
}
