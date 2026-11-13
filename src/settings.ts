// App settings, saved in SQLite (settings table). The coach reads coachModel when it starts.
import { invoke } from "./backend";
import { create } from "zustand";
import { hasBackend } from "./db";
import type { RatingPool } from "./rating";

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
   * The student's game ratings, chess.com scale, one per clock (RATING_KEYS); null = not set
   * (rapid starts at START_RATING, bullet and blitz at the rapid rating). Rated games move the
   * one their clock belongs to by Elo against the bot's rating; the computer updates it as each
   * one ends (db.rs rate_game). Rapid keeps the key from when there was one rating.
   */
  playerRating: number | null;
  playerRatingBlitz: number | null;
  playerRatingBullet: number | null;
  /** Desktop: look for new games on the student's import accounts (games/import.ts) when the app opens (every few hours at most). */
  autoImport: boolean;
  /** Puzzles: go on to the next one by itself shortly after a solve (a miss always waits). */
  puzzleAutoNext: boolean;
  /** Phones: a short buzz on every move on a board, and on puzzle solves (where the browser can vibrate). */
  haptics: boolean;
  /** Desktop: the coach column's width in px (dragged by its left edge) and whether it's tucked away into a side tab. */
  chatWidth: number;
  chatCollapsed: boolean;
  /** Visuals (visuals.ts): a BOARD_COLORS id or "custom" (boardLight / boardDark), a PIECE_SETS id, a COORD_SIZES id. */
  boardColors: string;
  boardLight: string;
  boardDark: string;
  pieceSet: string;
  coordSize: "off" | "small" | "medium" | "large";
  /**
   * Voice moves (src/voice/): when a heard move waits for a yes. "rated": in rated games and
   * whenever the words didn't name the move exactly; "unsure": only then; "always": every move.
   */
  voiceConfirm: "rated" | "unsure" | "always";
  /** Phrases that play a waiting move, and ones that drop it. */
  voiceConfirmWords: string[];
  voiceCancelWords: string[];
  /** Microphone level (0..1 RMS) below which sound counts as the room, not the student; 0 = off. Set by the mic test. */
  voiceGate: number;
  /** Listen only while Space (desktop) or the mic button (phones) is held: best in a noisy room. */
  voicePushToTalk: boolean;
}

const DEFAULTS: Settings = {
  coachModel: "",
  sounds: true,
  showEval: false,
  theme: "dark",
  nudges: "blunders",
  playerRating: null,
  playerRatingBlitz: null,
  playerRatingBullet: null,
  autoImport: true,
  puzzleAutoNext: true,
  haptics: true,
  chatWidth: 420,
  chatCollapsed: false,
  boardColors: "brown",
  boardLight: "#f0d9b5",
  boardDark: "#b58863",
  pieceSet: "cburnett",
  coordSize: "medium",
  voiceConfirm: "rated",
  voiceConfirmWords: ["yes", "confirm"],
  voiceCancelWords: ["no", "cancel"],
  voiceGate: 0,
  voicePushToTalk: false,
};

/** The setting each rating pool lives in (rating_key in src-tauri/src/db.rs). */
export const RATING_KEYS = {
  bullet: "playerRatingBullet",
  blitz: "playerRatingBlitz",
  rapid: "playerRating",
} as const satisfies Record<RatingPool, keyof Settings>;

/** A pool's rating as the settings have it: bullet and blitz fall back to rapid until set. */
export function settingRating(s: Settings, pool: RatingPool): number | null {
  return s[RATING_KEYS[pool]] ?? (pool === "rapid" ? null : s.playerRating);
}

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
