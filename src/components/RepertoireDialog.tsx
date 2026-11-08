import { useEffect, useState } from "react";
import { OPENINGS } from "../openings/book";
import { addToRepertoire, getRepertoire, removeFromRepertoire, useRepertoire } from "../openings/repertoire";
import type { Color } from "../store";
import { Modal } from "./GameDialogs";

const key = (moves: string[]) => moves.join(" ");

function numbered(moves: string[]): string {
  return moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");
}

/** Pick an opening for the computer to steer toward: the student's repertoire first, then the book. */
export function OpeningSelect({
  color,
  value,
  onChange,
}: {
  color: Color | null;
  value: string[] | null;
  onChange: (moves: string[] | null) => void;
}) {
  const repertoire = useRepertoire();
  useEffect(() => {
    getRepertoire().catch(() => undefined);
  }, []);
  const mine = repertoire.filter((r) => !color || r.color === color);
  return (
    <select value={value ? key(value) : ""} onChange={(e) => onChange(e.target.value ? e.target.value.split(" ") : null)}>
      <option value="">Any (computer's choice)</option>
      {mine.length > 0 && (
        <optgroup label="Your repertoire">
          {mine.map((r) => (
            <option key={r.id} value={key(r.moves)}>
              ★ {r.name} ({r.color}): {numbered(r.moves)}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Openings">
        {OPENINGS.filter((o) => o.moves.length >= 2).map((o) => (
          <option key={key(o.moves)} value={key(o.moves)}>
            {o.name}: {numbered(o.moves)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/** The student's repertoire per color. Each line is also an opening drill. */
export function RepertoireDialog({ onClose, initialColor = "white" }: { onClose: () => void; initialColor?: Color }) {
  const repertoire = useRepertoire();
  const [color, setColor] = useState<Color>(initialColor);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getRepertoire().catch((e) => setError(String(e)));
  }, []);

  const add = async () => {
    const opening = OPENINGS.find((o) => key(o.moves) === pick);
    if (!opening) return;
    try {
      await addToRepertoire(color, opening.name, opening.moves);
      setPick("");
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Modal title="Repertoire" onClose={onClose}>
      <p className="muted small">
        The openings you want to play. Each one becomes a drill (play it from memory), and you can pick it when starting
        a game so the computer plays into it.
      </p>
      {error && <p className="error">{error}</p>}
      {(["white", "black"] as const).map((c) => (
        <div key={c} className="field">
          <span>As {c}</span>
          {repertoire.filter((r) => r.color === c).length === 0 && <span className="muted small">Nothing yet.</span>}
          {repertoire
            .filter((r) => r.color === c)
            .map((r) => (
              <div key={r.id} className="rep-row">
                <span>
                  <strong>{r.name}</strong> <span className="muted">{numbered(r.moves)}</span>
                </span>
                <button onClick={() => removeFromRepertoire(r.id)} title="Remove" aria-label={`Remove ${r.name}`}>
                  ✕
                </button>
              </div>
            ))}
        </div>
      ))}
      <div className="field">
        <span>Add a line</span>
        <div className="rep-add">
          <div className="segmented">
            {(["white", "black"] as const).map((c) => (
              <button key={c} className={color === c ? "on" : ""} onClick={() => setColor(c)}>
                {c === "white" ? "White" : "Black"}
              </button>
            ))}
          </div>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose an opening…</option>
            {OPENINGS.filter((o) => o.moves.length >= 2).map((o) => (
              <option key={key(o.moves)} value={key(o.moves)}>
                {o.name}: {numbered(o.moves)}
              </option>
            ))}
          </select>
          <button className="primary" onClick={add} disabled={!pick}>
            Add
          </button>
        </div>
      </div>
    </Modal>
  );
}
