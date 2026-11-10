import { saveSetting, useSettings } from "../settings";
import { BOARD_COLORS, boardColors, COORD_SIZES, PIECE_SETS, pieceUrl } from "../visuals";
import { Board } from "./Board";

// A middlegame, so the preview shows every piece type on both square colors.
const PREVIEW_FEN = "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8";

/** Settings → Visuals: square colors, piece set and coordinate size, shown live on a small board. */
export function VisualSettings() {
  const s = useSettings();
  const { light, dark } = boardColors(s);

  return (
    <section className="field visuals">
      <span>Visuals</span>
      <div className="visuals-body">
        <div className="visuals-preview">
          <Board fen={PREVIEW_FEN} viewOnly />
        </div>
        <div className="visuals-options">
          <div className="field">
            <span className="muted small">Board</span>
            <div className="swatches">
              {BOARD_COLORS.map((b) => (
                <button
                  key={b.id}
                  className={`swatch ${s.boardColors === b.id ? "on" : ""}`}
                  style={{ "--l": b.light, "--d": b.dark } as React.CSSProperties}
                  title={b.label}
                  aria-label={`${b.label} board`}
                  onClick={() => saveSetting("boardColors", b.id)}
                />
              ))}
              <button
                className={`swatch custom ${s.boardColors === "custom" ? "on" : ""}`}
                style={{ "--l": s.boardLight, "--d": s.boardDark } as React.CSSProperties}
                title="Your own colors"
                aria-label="Custom board colors"
                onClick={() => {
                  // Start the custom colors from the board shown now.
                  if (s.boardColors !== "custom") {
                    saveSetting("boardLight", light);
                    saveSetting("boardDark", dark);
                  }
                  saveSetting("boardColors", "custom");
                }}
              />
            </div>
            {s.boardColors === "custom" && (
              <div className="custom-colors">
                <label>
                  <input type="color" value={s.boardLight} onChange={(e) => saveSetting("boardLight", e.target.value)} />
                  <span className="muted small">Light squares</span>
                </label>
                <label>
                  <input type="color" value={s.boardDark} onChange={(e) => saveSetting("boardDark", e.target.value)} />
                  <span className="muted small">Dark squares</span>
                </label>
              </div>
            )}
          </div>
          <div className="field">
            <span className="muted small">Coordinates</span>
            <div className="segmented">
              {COORD_SIZES.map((c) => (
                <button key={c.id} className={s.coordSize === c.id ? "on" : ""} onClick={() => saveSetting("coordSize", c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="field">
        <span className="muted small">Pieces</span>
        <div className="piece-sets">
          {PIECE_SETS.map((set) => (
            <button
              key={set}
              className={`piece-set ${s.pieceSet === set ? "on" : ""}`}
              style={{ "--l": light, "--d": dark } as React.CSSProperties}
              title={set[0].toUpperCase() + set.slice(1)}
              aria-label={`${set} pieces`}
              onClick={() => saveSetting("pieceSet", set)}
            >
              <img src={pieceUrl(set, "w", "N")} alt="" />
              <img src={pieceUrl(set, "b", "N")} alt="" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
