// App settings, saved in SQLite (settings table). The coach reads coachModel when it starts.
import { invoke } from "./backend";
import { create } from "zustand";
import { hasBackend } from "./db";

export interface Settings {
  /** Passed to `claude --model`; "" = the CLI's default. */
  coachModel: string;
  sounds: boolean;
  /** Eval bar and engine line beside the board. */
  showEval: boolean;
  theme: "dark" | "light" | "system";
  /** Practice games: flag the student's mistakes right after they play them (local engine, no AI). */
  nudges: "off" | "blunders" | "mistakes";
  /**
   * The student's game rating, chess.com scale; null = not set (START_RATING). Rated games move
   * it by Elo against the bot's rating; the computer updates it as each one ends (db.rs rate_game).
   */
  playerRating: number | null;
  /** Desktop: look for new games on the student's import accounts (games/import.ts) when the app opens (every few hours at most). */
  autoImport: boolean;
  /** Puzzles: go on to the next one by itself shortly after a solve (a miss always waits). */
  puzzleAutoNext: boolean;
  /** Phones: a short buzz on puzzle moves and solves (where the browser can vibrate). */
  haptics: boolean;
  /** Desktop: the coach column's width in px (dragged by its left edge) and whether it's tucked away into a side tab. */
  chatWidth: number;
  chatCollapsed: boolean;
}

const DEFAULTS: Settings = {
  coachModel: "",
  sounds: true,
  showEval: false,
  theme: "dark",
  nudges: "blunders",
  playerRating: null,
  autoImport: true,
  puzzleAutoNext: true,
  haptics: true,
  chatWidth: 420,
  chatCollapsed: false,
};

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

/** Keeps <html data-theme> in step with the setting (index.html starts it dark to avoid a flash). */
export function initTheme() {
  const apply = () => (document.documentElement.dataset.theme = useSettings.getState().theme);
  useSettings.subscribe(apply);
  apply();
}

export async function loadSettings() {
  if (!hasBackend()) return useSettings.setState({ loaded: true });
  applySettings(await invoke<Partial<Settings>>("db_get_settings"));
}

/** The settings as the database has them (absent = default). */
export function applySettings(saved: Partial<Settings>) {
  useSettings.setState({ ...DEFAULTS, ...saved, loaded: true });
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  useSettings.setState({ [key]: value } as Pick<Settings, K>);
  if (hasBackend()) await invoke("db_set_setting", { key, value: value === DEFAULTS[key] ? null : value });
}
