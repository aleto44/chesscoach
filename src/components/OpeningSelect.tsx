import { OPENINGS } from "../openings/book";

const key = (moves: string[]) => moves.join(" ");

function numbered(moves: string[]): string {
  return moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");
}

/** Pick a book opening for the computer to steer a new game toward. */
export function OpeningSelect({ value, onChange }: { value: string[] | null; onChange: (moves: string[] | null) => void }) {
  return (
    <select value={value ? key(value) : ""} onChange={(e) => onChange(e.target.value ? e.target.value.split(" ") : null)}>
      <option value="">Any (computer's choice)</option>
      {OPENINGS.filter((o) => o.moves.length >= 2).map((o) => (
        <option key={key(o.moves)} value={key(o.moves)}>
          {o.name}: {numbered(o.moves)}
        </option>
      ))}
    </select>
  );
}
