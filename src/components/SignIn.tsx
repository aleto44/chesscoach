import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cancelLogin, startLogin, submitCode, useAuth } from "../coach/auth";

/** Shown in the chat until the Claude CLI is signed in. */
export function SignIn() {
  const { status, url, error, codeSent } = useAuth();
  const [code, setCode] = useState("");

  if (status === "checking") return <div className="signin muted">Checking your Claude sign-in…</div>;

  if (status === "signed-out") {
    return (
      <div className="signin">
        <strong>Sign in to Claude to use the coach</strong>
        <p className="muted">
          The coach runs on your Claude subscription. Signing in opens your browser; this is the same login as running{" "}
          <code>claude</code> in a terminal.
        </p>
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={startLogin}>
          Sign in with Claude
        </button>
      </div>
    );
  }

  // signing-in
  const send = () => {
    if (!code.trim()) return;
    submitCode(code);
    setCode("");
  };
  return (
    <div className="signin">
      <strong>Finish signing in in your browser</strong>
      <ol className="muted">
        <li>
          Sign in on the page that opened
          {url && (
            <>
              {" "}
              (didn't open?{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), openUrl(url))}>
                open it again
              </a>
              )
            </>
          )}
          .
        </li>
        <li>Copy the code the page shows and paste it here.</li>
      </ol>
      <div className="signin-code">
        <input
          value={code}
          placeholder="Paste code"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          autoFocus
        />
        <button className="primary" onClick={send} disabled={!code.trim()}>
          Submit
        </button>
      </div>
      {codeSent && !error && <p className="muted">Checking the code…</p>}
      {error && <p className="error">{error}</p>}
      <button onClick={cancelLogin}>Cancel</button>
    </div>
  );
}
