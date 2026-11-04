import { useState } from "react";
import { pair } from "../backend";

/** First visit from a phone: trade the code shown in Settings on the computer for a pairing cookie. */
export function Pair() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await pair(code);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="pair">
      <form className="pair-card" onSubmit={submit}>
        <h1>
          <span className="brand-mark" aria-hidden>
            ♞
          </span>{" "}
          Chess Coach
        </h1>
        <p className="muted">
          On your computer, open Settings, turn on <b>Play from my phone</b>, and enter the code shown there.
        </p>
        <input
          className="text-input pair-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
        <button className="primary" type="submit" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 8}>
          Pair this phone
        </button>
        {error && <p className="error small">{error}</p>}
      </form>
    </div>
  );
}
