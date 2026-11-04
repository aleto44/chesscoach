import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { invoke, isTauri } from "../backend";
import { hasBackend } from "../db";
import { MODEL_CHOICES, saveSetting, useSettings } from "../settings";
import { newId, pushChat, useStore } from "../store";
import { Modal } from "./GameDialogs";
import { customSounds, loadSounds, play, SOUND_NAMES } from "../sound";

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
}

/** Desktop only: the home server phones connect to (src-tauri/src/remote.rs). */
function PhoneAccess() {
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<RemoteInfo>("remote_info").then(setInfo, (e) => setError(String(e)));
  }, []);

  const run = (cmd: string, args?: Record<string, unknown>) =>
    invoke<RemoteInfo>(cmd, args).then(
      (i) => (setInfo(i), setError(null)),
      (e) => setError(String(e)),
    );

  if (!info) return error ? <span className="error small">{error}</span> : null;
  return (
    <div className="field phone-access">
      <label className="toggle">
        <input type="checkbox" checked={info.enabled} onChange={(e) => run("remote_set_enabled", { enabled: e.target.checked })} />
        <span>Play from my phone</span>
      </label>
      {info.enabled && (
        <span className="muted small">
          {info.running ? "On. " : "Not running. "}
          Keep this app open on your computer, then open {info.urls.map((u, i) => (
            <span key={u}>
              {i > 0 && " or "}
              <code>{u}</code>
            </span>
          ))}{" "}
          on your phone and enter the code <code className="pair-code">{info.code.slice(0, 4)}-{info.code.slice(4)}</code>.
          Away from home, or to install it as an app, use Tailscale (docs/phone.md).{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), run("remote_new_code"))}>
            New code
          </a>{" "}
          unpairs every phone.
        </span>
      )}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

/** Preview buttons, plus where to drop custom sound files. */
function SoundOptions() {
  const [folder, setFolder] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string[]>(customSounds());

  useEffect(() => {
    if (hasBackend()) invoke<string>("sounds_folder").then(setFolder, () => setFolder(null));
  }, []);

  const reload = async () => {
    await loadSounds();
    setLoaded(customSounds());
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
    </div>
  );
}
