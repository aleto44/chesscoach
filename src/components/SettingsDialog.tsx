import { useEffect, useState } from "react";
import { invoke, isShell, pair, serverUrl, setServer } from "../backend";
import { useLaunches } from "../perf";
import { hasBackend } from "../db";
import { MODEL_CHOICES, RATING_KEYS, saveSetting, useSettings } from "../settings";
import { POOL_LABEL, RATING_POOLS, START_RATING, type RatingPool } from "../rating";
import { newId, pushChat, useStore } from "../store";
import { Modal } from "./GameDialogs";
import { VisualSettings } from "./VisualSettings";
import { VoiceSettings } from "./VoiceSettings";
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
      <VoiceSettings />
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
          Checked on this device right after you move. Asking the coach about it is up to you, so it costs no usage
          by itself. Never in rated games.
        </span>
      </label>
      <ServerAccess />
      <StartupTimes />
      <footer>
        <button className="primary" onClick={save} disabled={(choice === "custom" && !custom.trim()) || !ratingValid}>
          {changed ? "Save" : "Done"}
        </button>
      </footer>
    </Modal>
  );
}

/** How long the last few launches took, step by step (perf.ts). */
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

interface ServerInfo {
  apiVersion: number;
  version: string;
  /** The https address phones open (CHESSCOACH_PUBLIC_URL on the server), if it's set. */
  publicUrl: string | null;
}

/**
 * The server every device talks to: its address (the desktop app can change it), and the code
 * that pairs another device with it.
 */
function ServerAccess() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [address, setAddress] = useState(serverUrl());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ServerInfo>("server_info").then(setInfo, (e) => setError(String(e)));
    invoke<string>("pairing_code").then(setCode, () => setCode(null));
  }, []);

  const newCode = async () => {
    if (!confirm("A new code unpairs every other device; each has to enter the new code. Go ahead?")) return;
    try {
      const fresh = await invoke<string>("pairing_new_code");
      // This device pairs again straight away with the new code.
      await pair(fresh);
      setCode(fresh);
    } catch (e) {
      setError(String(e));
    }
  };

  const connect = () => {
    setServer(address);
    location.reload();
  };

  const shown = code && (
    <code className="pair-code">
      {code.slice(0, 4)}-{code.slice(4)}
    </code>
  );
  return (
    <div className="field phone-access">
      <span>Server</span>
      {isShell ? (
        <span className="server-address">
          <input className="text-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://laptop-server…" spellCheck={false} />
          <button onClick={connect} disabled={!address.trim() || address.trim() === serverUrl()}>
            Connect
          </button>
        </span>
      ) : null}
      <span className="muted small">
        Your games, ratings, drills and the coach live on the server; every device shows the same thing.
        {info && ` Server version ${info.version}.`}
      </span>
      {shown && (
        <span className="muted small">
          To add a device, open {info?.publicUrl ? <code>{info.publicUrl}</code> : "the server's address"} there (with Tailscale on)
          and enter {shown}.{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), newCode())}>
            New code
          </a>{" "}
          unpairs every other device.
        </span>
      )}
      {error && <span className="error small">{error}</span>}
    </div>
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
          Sound files go in <code>{folder}</code> on the server, named after the event (e.g. <code>move-self.mp3</code>);{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), reload())}>reload sounds</a> after changing them.
          {` ${loaded.length} of ${SOUND_NAMES.length} found.`}
        </span>
      )}
      {failed.length > 0 && <span className="error small">Couldn't play on this device: {failed.join(", ")}</span>}
    </div>
  );
}
