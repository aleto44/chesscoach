import { openUrl } from "../backend";
import { useState } from "react";
import { cancelLogin, startLogin, submitCode, useAuth } from "../coach/auth";

/** Shown in the chat until the Claude CLI is signed in. */
export function SignIn() {
  const { status, url, error, codeSent, output } = useAuth();
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
  const trimmed = code.trim();
  // The email verification code (6 digits) belongs on the browser page, not here.
  const looksLikeEmailCode = /^\d{4,8}$/.test(trimmed);
  const send = () => {
    if (!trimmed || looksLikeEmailCode) return;
    submitCode(trimmed);
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
        <li>If Claude emails you a short verification code, enter it on that page, not here.</li>
        <li>
          Click <strong>Authorize</strong>. The page then shows a long code (it usually contains a <code>#</code>). Copy
          all of it and paste it here.
        </li>
      </ol>
      <div className="signin-code">
        <input
          value={code}
          placeholder="Paste code"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          autoFocus
        />
        <button className="primary" onClick={send} disabled={!trimmed || looksLikeEmailCode}>
          Submit
        </button>
      </div>
      {looksLikeEmailCode && (
        <p className="error">
          That looks like the email verification code. Enter it in the browser, then paste the long code shown after
          you click Authorize.
        </p>
      )}
      {codeSent && !error && <p className="muted">Checking the code…</p>}
      {error && <p className="error">{error}</p>}
      {codeSent && output && (
        <details className="signin-output" open>
          <summary>Claude CLI output</summary>
          <pre>{output.replace(/https:\/\/\S+/g, "<sign-in link>").trim()}</pre>
        </details>
      )}
      <button onClick={cancelLogin}>Cancel</button>
    </div>
  );
}
