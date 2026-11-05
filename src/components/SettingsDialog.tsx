import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { invoke, isTauri, openUrl } from "../backend";
import { hasBackend } from "../db";
import { MODEL_CHOICES, saveSetting, useSettings } from "../settings";
import { newId, pushChat, useStore } from "../store";
import { Modal } from "./GameDialogs";
import { customSounds, loadSounds, play, SOUND_NAMES, soundFailures } from "../sound";

const CHOICES = [...MODEL_CHOICES, { value: "custom", label: "Custom…", hint: "Any model name or ID claude accepts" }];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { coachModel, activeModel, sounds, showEval, theme, nudges } = useSettings();
  const preset = MODEL_CHOICES.some((c) => c.value === coachModel);
  const [choice, setChoice] = useState(preset ? coachModel : "custom");
  const [custom, setCustom] = useState(preset ? "" : coachModel);

  const model = choice === "custom" ? custom.trim() : choice;
  const changed = model !== coachModel;

  const save = async () => {
    if (changed) {
      await saveSetting("coachModel", model);
      // Restart the coach so the next message starts it on the new model (same conversation).
      if (hasBackend() && !useStore.getState().busy) await invoke("coach_reset");
      pushChat({ kind: "system", id: newId("c"), text: `Coach model set to ${model || "the default"}.` });
    }
    onClose();
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <label className="field">
        <span>Coach model</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="muted small">{CHOICES.find((c) => c.value === choice)?.hint}</span>
      </label>
      <div className="field">
        {choice === "custom" && (
          <input
            className="text-input"
            value={custom}
            placeholder="e.g. claude-sonnet-5-5"
            onChange={(e) => setCustom(e.target.value)}
            autoFocus
          />
        )}
        <span className="muted small">
          {activeModel ? `The coach last ran on ${activeModel}. ` : ""}
          Models your plan doesn't include will show an error in the chat.
        </span>
      </div>
      <label className="field">
        <span>Appearance</span>
        <select value={theme} onChange={(e) => saveSetting("theme", e.target.value as typeof theme)}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">Match Windows</option>
        </select>
      </label>
      <div className="field">
        <label className="toggle">
          <input type="checkbox" checked={sounds} onChange={(e) => saveSetting("sounds", e.target.checked)} />
          <span>Move sounds</span>
        </label>
        {sounds && <SoundOptions />}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={showEval} onChange={(e) => saveSetting("showEval", e.target.checked)} />
        <span>Show engine evaluation</span>
      </label>
      <label className="field">
        <span>Flag my mistakes in practice games</span>
        <select value={nudges} onChange={(e) => saveSetting("nudges", e.target.value as typeof nudges)}>
          <option value="blunders">Blunders only</option>
          <option value="mistakes">Mistakes and blunders</option>
          <option value="off">Off</option>
        </select>
        <span className="muted small">
          Checked on your computer right after you move. Asking the coach about it is up to you, so it costs no usage
          by itself. Never in rated games.
        </span>
      </label>
      {isTauri && <PhoneAccess />}
      <footer>
        <button className="primary" onClick={save} disabled={choice === "custom" && !custom.trim()}>
          {changed ? "Save" : "Done"}
        </button>
      </footer>
    </Modal>
  );
}

interface RemoteInfo {
  enabled: boolean;
  running: boolean;
  port: number;
  code: string;
  urls: string[];
  /** Null when Tailscale isn't installed on this computer. */
  tailscale: { state: string; url: string | null; serving: boolean } | null;
}

const TAILSCALE_DOWNLOAD = "https://tailscale.com/download";

/** Desktop only: the server phones connect to (src-tauri/src/remote.rs, tailscale.rs). */
function PhoneAccess() {
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<RemoteInfo>("remote_info").then(setInfo, (e) => setError(String(e)));
  }, []);

  const run = (cmd: string, args?: Record<string, unknown>) => {
    setBusy(true);
    return invoke<RemoteInfo>(cmd, args)
      .then(
        (i) => (setInfo(i), setError(null)),
        (e) => setError(String(e)),
      )
      .finally(() => setBusy(false));
  };

  if (!info) return error ? <span className="error small">{error}</span> : null;
  const code = (
    <code className="pair-code">
      {info.code.slice(0, 4)}-{info.code.slice(4)}
    </code>
  );
  return (
    <div className="field phone-access">
      <label className="toggle">
        <input type="checkbox" checked={info.enabled} onChange={(e) => run("remote_set_enabled", { enabled: e.target.checked })} />
        <span>Play from my phone</span>
      </label>
      {info.enabled && (
        <>
          <span className="muted small">
            {info.running ? "On. " : "Not running. "}
            Keep this app open on your computer. At home, open{" "}
            {info.urls.map((u, i) => (
              <span key={u}>
                {i > 0 && " or "}
                <code>{u}</code>
              </span>
            ))}{" "}
            on your phone and enter the code {code}.{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), run("remote_new_code"))}>
              New code
            </a>{" "}
            unpairs every phone.
          </span>
          <span className="muted small">
            <b>Anywhere: </b>
            <Anywhere info={info} busy={busy} code={code} onSetUp={() => run("remote_tailscale_serve")} onRecheck={() => run("remote_info")} />
          </span>
        </>
      )}
      {error && <Problem text={error} />}
    </div>
  );
}

/** The Tailscale steps, showing only the next one to do. */
function Anywhere({ info, busy, code, onSetUp, onRecheck }: {
  info: RemoteInfo;
  busy: boolean;
  code: React.ReactNode;
  onSetUp: () => void;
  onRecheck: () => void;
}) {
  const recheck = (
    <a href="#" onClick={(e) => (e.preventDefault(), onRecheck())}>
      Check again
    </a>
  );
  const ts = info.tailscale;
  if (!ts)
    return (
      <>
        install{" "}
        <a href="#" onClick={(e) => (e.preventDefault(), openUrl(TAILSCALE_DOWNLOAD))}>
          Tailscale
        </a>{" "}
        (free) on this computer and on your phone, and sign in with the same account on both. It joins them into a private
        network only your devices can reach, over any internet connection. {recheck}
      </>
    );
  if (ts.state !== "Running")
    return (
      <>
        Tailscale is installed but not connected ({ts.state}). Open Tailscale on this computer and sign in. {recheck}
      </>
    );
  if (!ts.serving || !ts.url)
    return (
      <>
        Tailscale is connected. One more step gives this computer a private https address for the app.{" "}
        <button onClick={onSetUp} disabled={busy}>
          {busy ? "Setting up…" : "Set up"}
        </button>
      </>
    );
  return (
    <>
      with Tailscale on in your phone, open <code>{ts.url}</code> and enter the code {code} (once per address). Then use the
      browser menu's <i>Add to Home screen</i> to install it as an app.
    </>
  );
}

/** An error, with any link in it clickable (Tailscale asks to turn on https this way). */
function Problem({ text }: { text: string }) {
  const url = text.match(/https:\/\/\S+/)?.[0];
  return (
    <span className="error small">
      {text}
      {url && (
        <>
          {" "}
          <a href="#" onClick={(e) => (e.preventDefault(), openUrl(url))}>
            Open that page
          </a>
          , approve it, then press Set up again.
        </>
      )}
    </span>
  );
}

/** Preview buttons, plus where to drop custom sound files. */
function SoundOptions() {
  const [folder, setFolder] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string[]>(customSounds());
  const [failed, setFailed] = useState<string[]>(soundFailures());

  useEffect(() => {
    if (hasBackend()) invoke<string>("sounds_folder").then(setFolder, () => setFolder(null));
  }, []);

  const reload = async () => {
    await loadSounds();
    setLoaded(customSounds());
    setFailed(soundFailures());
  };

  return (
    <div className="sound-options">
      <div className="sound-preview">
        {SOUND_NAMES.map((n) => (
          <button key={n} onClick={() => play(n)} title={`Play the ${n} sound`}>
            ▶ {n}
          </button>
        ))}
      </div>
      {folder && (
        <span className="muted small">
          Sounds play from files named {SOUND_NAMES.map((n) => `${n}.mp3`).join(", ")} (or .wav/.ogg) in{" "}
          {isTauri ? (
            <a href="#" onClick={(e) => (e.preventDefault(), revealItemInDir(folder))}>
              this folder
            </a>
          ) : (
            <code>{folder}</code>
          )}
          , then <a href="#" onClick={(e) => (e.preventDefault(), reload())}>reload sounds</a>.
          {` Found: ${loaded.join(", ") || "none"}. Missing ones use the move sound (game-end stays silent).`}
        </span>
      )}
      {failed.length > 0 && <span className="error small">Couldn't play on this device: {failed.join(", ")}</span>}
    </div>
  );
}
