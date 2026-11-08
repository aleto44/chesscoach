// Opening the app: one call to the computer (app_boot in src-tauri/src/boot.rs) for the game,
// settings, drill counts and puzzle status. On a phone that came up on its snapshot this runs in
// the background and only changes the screen if the computer has something newer.
import { hasBackend, invoke, isRemote } from "./backend";
import { useDrillCounts } from "./analysis/drills";
import { holdWrites, reliably, type GameRecord } from "./db";
import { openBooted } from "./game/session";
import { mark } from "./perf";
import { autoImport } from "./games/import";
import { refreshPack } from "./offline";
import { applyPuzzleStatus, type PuzzleStatus } from "./puzzles/puzzles";
import { applySettings, type Settings } from "./settings";
import { useStore } from "./store";

interface Boot {
  game: GameRecord | null;
  settings: Partial<Settings>;
  drillCounts: { total: number; due: number };
  puzzles: PuzzleStatus | null;
}

/** `shown`: the content key of the snapshot on screen (restoreSnapshot), null if none. */
export async function boot(shown: string | null) {
  if (!hasBackend()) return;
  // A snapshot may be behind the database: game writes wait until it's settled which is right.
  const release = shown !== null ? holdWrites() : () => undefined;
  const prefer = shown !== null ? useStore.getState().gameId : null;
  let b: Boot;
  try {
    // A phone that just woke up may not reach the computer at first; keep trying.
    b = await (isRemote ? reliably("opening the app", () => invoke<Boot>("app_boot", { prefer })) : invoke<Boot>("app_boot", { prefer }));
  } catch (e) {
    release();
    throw e;
  }
  mark("computer answered");
  applySettings(b.settings);
  useDrillCounts.setState(b.drillCounts);
  if (b.puzzles) applyPuzzleStatus(b.puzzles);
  await openBooted(b.game, shown, release);
  mark("game up to date");
  autoImport();
  if (isRemote) void refreshPack();
}
