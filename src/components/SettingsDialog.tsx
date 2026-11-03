import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasBackend } from "../db";
import { MODEL_CHOICES, saveSetting, useSettings } from "../settings";
import { newId, pushChat, useStore } from "../store";
import { Modal } from "./GameDialogs";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { coachModel, activeModel } = useSettings();
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
      <div className="field">
        <span>Coach model</span>
        <div className="model-choices">
          {[...MODEL_CHOICES, { value: "custom", label: "Custom", hint: "Any model name or ID claude accepts" }].map(
            (c) => (
              <label key={c.value} className={`model-choice ${choice === c.value ? "on" : ""}`}>
                <input type="radio" name="model" checked={choice === c.value} onChange={() => setChoice(c.value)} />
                <span>
                  <strong>{c.label}</strong>
                  <span className="muted"> · {c.hint}</span>
                </span>
              </label>
            ),
          )}
        </div>
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
      <footer>
        <button className="primary" onClick={save} disabled={choice === "custom" && !custom.trim()}>
          {changed ? "Save" : "Done"}
        </button>
      </footer>
    </Modal>
  );
}
