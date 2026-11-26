import { useState } from "react";
import { isShell, pair, serverUrl, setServer } from "../backend";

/**
 * A device that isn't paired with the server yet: trade the code a paired device shows in Settings
 * (or `chesscoach-server pairing-code` on the server) for the server's token. The desktop app also
 * needs the server's address; a phone opened the page from the server, so it has it.
 */
export function Pair() {
  const [code, setCode] = useState("");
  const [address, setAddress] = useState(serverUrl() || "https://laptop-server");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isShell && address.trim() !== serverUrl()) setServer(address);
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
          On a device that's already set up, open Settings and enter the code shown under <b>Server</b>.
        </p>
        {isShell && (
          <input
            className="text-input pair-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Server address"
            autoComplete="off"
            spellCheck={false}
          />
        )}
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
        <button className="primary" type="submit" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 8 || (isShell && !address.trim())}>
          Pair this device
        </button>
        {error && <p className="error small">{error}</p>}
      </form>
    </div>
  );
}
