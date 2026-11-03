import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasBackend } from "../db";
import { MODEL_CHOICES, saveSetting, useSettings } from "../settings";
import { newId, pushChat, useStore } from "../store";
import { Modal } from "./GameDialogs";

const CHOICES = [...MODEL_CHOICES, { value: "custom", label: "Custom…", hint: "Any model name or ID claude accepts" }];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { coachModel, activeModel, sounds, showEval } = useSettings();
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
      <label className="toggle">
        <input type="checkbox" checked={sounds} onChange={(e) => saveSetting("sounds", e.target.checked)} />
        <span>Move sounds</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={showEval} onChange={(e) => saveSetting("showEval", e.target.checked)} />
        <span>Show engine evaluation</span>
      </label>
      <footer>
        <button className="primary" onClick={save} disabled={choice === "custom" && !custom.trim()}>
          {changed ? "Save" : "Done"}
        </button>
      </footer>
    </Modal>
  );
}
