// Phones only: what was on screen, kept on the phone so reopening the app shows it straight away.
// Android drops a backgrounded page now and then; coming back used to mean a blank app until the
// computer answered over Tailscale. Now the last screen comes back at once and the boot call
// (boot.ts) brings it up to date in the background.
import { isRemote } from "./backend";
import { useAuth } from "./coach/auth";
import { useUsage } from "./coach/usage";
import { useDrillCounts } from "./analysis/drills";
import { flush, withoutSaving, writesHeld } from "./db";
import { usePuzzleDb } from "./puzzles/puzzles";
import { useSettings } from "./settings";
import { useStore } from "./store";
import { contentKey, settleChat } from "./game/session";

const KEY = "cc-snapshot";
const VERSION = 1;

const pickGame = () => {
  const s = useStore.getState();
  return {
    gameId: s.gameId,
    meta: s.meta,
    game: s.game,
    gamePly: s.gamePly,
    tangents: s.tangents,
    active: s.active,
    orientation: s.orientation,
    chat: s.chat,
    sessionId: s.sessionId,
    clocks: s.clocks,
    annotations: s.annotations,
  };
};

const pickRest = () => {
  const { activeModel: _model, ...settings } = useSettings.getState();
  const { importing: _importing, ...puzzles } = usePuzzleDb.getState();
  const auth = useAuth.getState();
  const usage = useUsage.getState();
  return {
    settings,
    drillCounts: useDrillCounts.getState(),
    puzzles,
    // Only settled sign-in states: a sign-in in progress has to start over anyway.
    auth: auth.status === "signed-in" || auth.status === "signed-out" ? { status: auth.status, email: auth.email, plan: auth.plan } : null,
    usage: { limits: usage.limits, updatedAt: usage.updatedAt },
  };
};

type Snapshot = { v: number; at: number; game: ReturnType<typeof pickGame> } & ReturnType<typeof pickRest>;

function save() {
  const { gameId } = useStore.getState();
  // Nothing worth showing yet (the boot call hasn't answered on a first launch).
  if (gameId === null) return;
  const snap: Snapshot = { v: VERSION, at: Date.now(), game: pickGame(), ...pickRest() };
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch (e) {
    // Full storage: the next launch just waits for the computer, as before.
    console.warn("snapshot not saved", e);
  }
}

/**
 * Puts the saved snapshot on screen. Returns the content key of the game it showed (to compare
 * with the database's copy, see openBooted), or null when there was nothing to show.
 */
export function restoreSnapshot(): string | null {
  if (!isRemote) return null;
  let snap: Snapshot | null = null;
  try {
    snap = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    snap = null;
  }
  if (!snap || snap.v !== VERSION || snap.game?.gameId == null) return null;
  try {
    const { game } = snap;
    withoutSaving(() =>
      useStore.setState({
        ...game,
        // An open side board may no longer exist; the game is always safe to show.
        active: game.active && game.active in game.tangents ? game.active : null,
        chat: settleChat(game.chat),
        busy: false,
        busySince: null,
        streaming: false,
        // Time spent away from the game isn't charged, same as reopening it from the database.
        turnStartedAt: Date.now(),
      }),
    );
    useSettings.setState({ ...snap.settings, loaded: true });
    useDrillCounts.setState(snap.drillCounts);
    usePuzzleDb.setState(snap.puzzles);
    if (snap.auth) useAuth.setState(snap.auth);
    useUsage.setState(snap.usage);
    return contentKey(useStore.getState());
  } catch (e) {
    console.warn("snapshot not restored", e);
    return null;
  }
}

/** Keeps the snapshot current: whenever the app goes to the background, and a little after changes. */
export function initSnapshot() {
  if (!isRemote) return;
  const away = () => {
    // Send what's still waiting to be saved while the page is still alive.
    if (!writesHeld()) flush().catch(() => undefined);
    save();
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && away());
  window.addEventListener("pagehide", away);
  let timer: number | undefined;
  const soon = () => {
    clearTimeout(timer);
    // Not while coach text streams in: that changes the chat many times a second.
    timer = window.setTimeout(() => !useStore.getState().streaming && save(), 2000);
  };
  useStore.subscribe(soon);
  useSettings.subscribe(soon);
  useDrillCounts.subscribe(soon);
}

// ---- Read-only screens (drill and puzzle history) ----

/**
 * Bump when a cached answer's shape changes: a phone showed an old copy to new code and the
 * screen crashed (the player rating before it was split into bullet, blitz and rapid).
 */
const READ_VERSION = 2;
const readKey = (key: string) => `cc-read:v${READ_VERSION}:${key}`;

/** The last answer to a read-only query, kept so the screen fills in at once next time. */
export function cachedRead<T>(key: string): T | null {
  if (!isRemote) return null;
  try {
    return JSON.parse(localStorage.getItem(readKey(key)) ?? "null");
  } catch {
    return null;
  }
}

export function keepRead(key: string, value: unknown) {
  if (!isRemote) return;
  try {
    localStorage.setItem(readKey(key), JSON.stringify(value));
  } catch {
    // Full storage: the screen just waits for the computer.
  }
}
