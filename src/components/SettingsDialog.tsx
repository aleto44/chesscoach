import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { invoke, isRemote, isTauri, openUrl } from "../backend";
import { useLaunches } from "../perf";
import { hasBackend } from "../db";
import { MODEL_CHOICES, RATING_KEYS, saveSetting, useSettings } from "../settings";
import { POOL_LABEL, RATING_POOLS, START_RATING, type RatingPool } from "../rating";
import { newId, pushChat, useStore } from "../store";
import { Modal } from "./GameDialogs";
import { VisualSettings } from "./VisualSettings";
import { canVibrate } from "../haptics";
import { customSounds, loadSounds, play, playableSounds, SOUND_NAMES, soundFailures, type SoundName } from "../sound";

const CHOICES = [...MODEL_CHOICES, { value: "custom", label: "Custom…", hint: "Any model name or ID claude accepts" }];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const { coachModel, activeModel, sounds, haptics, showEval, theme, nudges } = settings;
  const stored = (p: RatingPool) => settings[RATING_KEYS[p]];
  const [ratingText, setRatingText] = useState<Record<RatingPool, string>>(() => {
    const text = (p: RatingPool) => (stored(p) === null ? "" : String(stored(p)));
    return { bullet: text("bullet"), blitz: text("blitz"), rapid: text("rapid") };
  });
  const typed = (p: RatingPool) => (ratingText[p].trim() === "" ? null : Math.round(Number(ratingText[p])));
  const validRating = (p: RatingPool) => {
    const t = typed(p);
    return t === null || (Number.isFinite(t) && t >= 100 && t <= 3500);
  };
  const ratingValid = RATING_POOLS.every(validRating);
  const changedPools = RATING_POOLS.filter((p) => validRating(p) && typed(p) !== stored(p));
  const ratingChanged = changedPools.length > 0;
  const preset = MODEL_CHOICES.some((c) => c.value === coachModel);
  const [choice, setChoice] = useState(preset ? coachModel : "custom");
  const [custom, setCustom] = useState(preset ? "" : coachModel);

  const model = choice === "custom" ? custom.trim() : choice;
  const changed = model !== coachModel || ratingChanged;

  const save = async () => {
    for (const p of changedPools) await saveSetting(RATING_KEYS[p], typed(p));
    if (model !== coachModel) {
      await saveSetting("coachModel", model);
      // Restart the coach so the next message starts it on the new model (same conversation).
      if (hasBackend() && !useStore.getState().busy) await invoke("coach_reset");
      pushChat({ kind: "system", id: newId("c"), text: `Coach model set to ${model || "the default"}.` });
    }
    onClose();
  };

  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
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
      <div className="field">
        <span>Your ratings</span>
        <div className="rating-inputs">
          {RATING_POOLS.map((p) => (
            <label key={p} className="rating-input-row">
              <span className="muted small">{POOL_LABEL[p]}</span>
              <input
                className={`text-input rating-input ${validRating(p) ? "" : "invalid"}`}
                type="number"
                inputMode="numeric"
                min={100}
                max={3500}
                step={1}
                value={ratingText[p]}
                // Unset bullet and blitz start from rapid (the typed one, if any).
                placeholder={p === "rapid" ? String(START_RATING) : ratingText.rapid.trim() || String(stored("rapid") ?? START_RATING)}
                onChange={(e) => setRatingText((t) => ({ ...t, [p]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && ratingValid && save()}
              />
            </label>
          ))}
        </div>
        <span className={ratingValid ? "muted small" : "error small"}>
          {ratingValid
            ? "Your chess.com bullet, blitz and rapid ratings, or your best guesses. Rated games move the one their clock " +
              "belongs to by Elo against the bot's rating; games with no clock count as rapid. Left empty, rapid starts at " +
              `${START_RATING} and bullet and blitz start at your rapid rating.`
            : "Enter ratings between 100 and 3500."}
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
      <VisualSettings />
      <div className="field">
        <label className="toggle">
          <input type="checkbox" checked={sounds} onChange={(e) => saveSetting("sounds", e.target.checked)} />
          <span>Sounds</span>
        </label>
        {sounds && <SoundOptions />}
      </div>
      {canVibrate() && (
        <label className="toggle">
          <input type="checkbox" checked={haptics} onChange={(e) => saveSetting("haptics", e.target.checked)} />
          <span>Vibrate on moves</span>
        </label>
      )}
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
      {isRemote && <StartupTimes />}
      <footer>
        <button className="primary" onClick={save} disabled={(choice === "custom" && !custom.trim()) || !ratingValid}>
          {changed ? "Save" : "Done"}
        </button>
      </footer>
    </Modal>
  );
}

/** Phones: how long the last few launches took, step by step (perf.ts). */
function StartupTimes() {
  const launches = useLaunches();
  return (
    <details className="field startup-times">
      <summary>Startup timing</summary>
      {launches.map((l) => (
        <div key={l.at} className="startup-launch">
          <div className="muted small">
            {new Date(l.at).toLocaleString()} · {l.from === "snapshot" ? "from the saved screen" : "nothing saved yet"}
          </div>
          <table className="stat-table">
            <tbody>
              {Object.entries(l.marks)
                .sort((a, b) => a[1] - b[1])
                .map(([step, ms]) => (
                  <tr key={step}>
                    <td>{step}</td>
                    <td>{(ms / 1000).toFixed(2)} s</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </details>
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
  const [loaded, setLoaded] = useState<SoundName[]>(customSounds());
  // Built-in puzzle sounds can be previewed too.
  const [playable, setPlayable] = useState<SoundName[]>(playableSounds());
  const [failed, setFailed] = useState<string[]>(soundFailures());
  const [chosen, setPick] = useState<SoundName>("move-self");
  const pick = playable.includes(chosen) ? chosen : (playable[0] as SoundName);

  useEffect(() => {
    if (hasBackend()) invoke<string>("sounds_folder").then(setFolder, () => setFolder(null));
  }, []);

  const reload = async () => {
    await loadSounds();
    setLoaded(customSounds());
    setPlayable(playableSounds());
    setFailed(soundFailures());
  };

  return (
    <div className="sound-options">
      {playable.length > 0 && (
        <div className="sound-preview">
          <select value={pick} onChange={(e) => setPick(e.target.value as SoundName)} title="Sound to preview">
            {playable.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button onClick={() => play(pick)} title={`Play the ${pick} sound`}>
            ▶ Play
          </button>
        </div>
      )}
      {folder && (
        <span className="muted small">
          Sound files go in{" "}
          {isTauri ? (
            <a href="#" onClick={(e) => (e.preventDefault(), revealItemInDir(folder))}>
              this folder
            </a>
          ) : (
            <code>{folder}</code>
          )}
          , named after the event (e.g. <code>move-self.mp3</code>);{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), reload())}>reload sounds</a> after changing them.
          {` ${loaded.length} of ${SOUND_NAMES.length} found.`}
        </span>
      )}
      {failed.length > 0 && <span className="error small">Couldn't play on this device: {failed.join(", ")}</span>}
    </div>
  );
}
