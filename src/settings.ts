// App settings, saved in SQLite (settings table). The coach reads coachModel when it starts.
import { clientId, invoke, listen } from "./backend";
import { create } from "zustand";
import { hasBackend } from "./db";
import type { RatingPool } from "./rating";
import { pendingCourse } from "./offline";

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
  /** Opening trainer: the chance (0..1) a line gets one of the opponent's stored mistakes (openings/blunders.ts). */
  openingBlunders: number;
  /** Opening courses (openings/progress.ts): how well the student knows each decision, by node id. */
  openingCourse: Record<string, import("./openings/progress").NodeProgress>;
  /** The coach's closer look at decisions the student keeps missing (openings/courseMemo.ts), by node id. */
  openingCourseMemos: Record<string, import("./openings/courseMemo").CourseMemo>;
  /** Endgame trainer results (endgames/session.ts), by position id. */
  endgameRecords: Record<string, import("./endgames/session").EndgameRecord>;
  /** Guess the move: the best score (percent) per game id (guess/session.ts). */
  guessBest: Record<string, number>;
  /** Legacy opening trainer: how many times each line has come up, by its moves (openings/training.ts). */
  openingSeen: Record<string, number>;
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
  openingBlunders: 0.2,
  openingCourse: {},
  openingCourseMemos: {},
  endgameRecords: {},
  guessBest: {},
  openingSeen: {},
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
  useSettings.setState({ ...withPending({ ...DEFAULTS, ...saved }), loaded: true });
  adoptDeviceProgress();
}

/**
 * Endgame results, guess-the-move best scores and the legacy trainer's seen counts used to be kept
 * in each device's localStorage, so the phone and the computer each had their own. Whatever a device
 * still has is merged into the shared setting once (counts added, best scores the higher), then dropped.
 */
const DEVICE_PROGRESS = [
  { key: "endgameRecords", local: "cc-endgames" },
  { key: "guessBest", local: "cc-guess-best" },
  { key: "openingSeen", local: "cc-opening-seen" },
] as const;
let adopted = false;
function adoptDeviceProgress() {
  if (adopted) return;
  adopted = true;
  for (const { key, local } of DEVICE_PROGRESS) {
    let kept: Record<string, unknown> | null = null;
    try {
      kept = JSON.parse(localStorage.getItem(local) ?? "null");
    } catch {
      // Unreadable: nothing to bring over.
    }
    if (!kept || typeof kept !== "object") continue;
    const merged: Record<string, unknown> = { ...useSettings.getState()[key] };
    for (const [id, v] of Object.entries(kept)) merged[id] = mergeProgress(key, merged[id], v);
    // No computer to keep it (a plain browser): show it, and leave the device's copy where it is.
    if (!hasBackend()) {
      useSettings.setState({ [key]: merged } as Partial<Settings>);
      continue;
    }
    saveSetting(key, merged as never).then(
      () => localStorage.removeItem(local),
      (e) => console.error("could not bring over", local, e),
    );
  }
}
function mergeProgress(key: (typeof DEVICE_PROGRESS)[number]["key"], a: unknown, b: unknown): unknown {
  if (a === undefined) return b;
  if (key === "guessBest") return Math.max(Number(a), Number(b));
  if (key === "openingSeen") return Number(a) + Number(b);
  const x = a as { tries: number; wins: number; last: unknown };
  const y = b as typeof x;
  return { tries: x.tries + y.tries, wins: x.wins + y.wins, last: y.last ?? x.last };
}

/** The computer's copy, with the course answers this phone gave offline and hasn't sent yet on top. */
function withPending<T extends Partial<Settings>>(s: T): T {
  if (!s.openingCourse) return s;
  const pending = pendingCourse();
  return Object.keys(pending).length ? { ...s, openingCourse: { ...s.openingCourse, ...pending } } : s;
}

/**
 * Takes the settings other devices save (the phone's course progress, say) as they're saved. Without
 * it a device keeps what it loaded at startup, and its next save of a whole map (openingCourse) would
 * write the stale copy over the other device's progress.
 */
export function initSettingsSync() {
  if (!hasBackend()) return;
  listen<{ key: keyof Settings; value: unknown; from: string }>("setting-changed", ({ payload }) => {
    if (payload.from === clientId || !(payload.key in DEFAULTS)) return;
    useSettings.setState(withPending({ [payload.key]: payload.value ?? DEFAULTS[payload.key] } as Partial<Settings>));
  });
  // A phone that missed announcements (backend.ts resync) reads them all again.
  listen("resync", () => {
    invoke<Partial<Settings>>("db_get_settings").then(
      (saved) => useSettings.setState(withPending({ ...DEFAULTS, ...saved })),
      () => {}, // Out of reach: the next resync tries again.
    );
  });
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  useSettings.setState({ [key]: value } as Pick<Settings, K>);
  if (hasBackend()) await invoke("db_set_setting", { key, value: value === DEFAULTS[key] ? null : value });
}
