// App settings, saved in SQLite (settings table). The coach reads coachModel when it starts.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { hasBackend } from "./db";

export interface Settings {
  /** Passed to `claude --model`; "" = the CLI's default. */
  coachModel: string;
  sounds: boolean;
  /** Eval bar and engine line beside the board. */
  showEval: boolean;
}

const DEFAULTS: Settings = { coachModel: "", sounds: true, showEval: false };

export const MODEL_CHOICES = [
  { value: "", label: "Default", hint: "Whatever your Claude Code default is" },
  { value: "opus", label: "Opus", hint: "Strongest explanations, uses the most of your plan" },
  { value: "sonnet", label: "Sonnet", hint: "Good balance of quality and speed" },
  { value: "haiku", label: "Haiku", hint: "Fastest and lightest on usage" },
];

export const useSettings = create<Settings & { loaded: boolean; activeModel: string | null }>(() => ({
  ...DEFAULTS,
  loaded: false,
  /** The model the coach process reported when it last started. */
  activeModel: null,
}));

export async function loadSettings() {
  if (!hasBackend()) return useSettings.setState({ loaded: true });
  const saved = await invoke<Partial<Settings>>("db_get_settings");
  useSettings.setState({ ...DEFAULTS, ...saved, loaded: true });
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  useSettings.setState({ [key]: value } as Pick<Settings, K>);
  if (hasBackend()) await invoke("db_set_setting", { key, value: value === DEFAULTS[key] ? null : value });
}
