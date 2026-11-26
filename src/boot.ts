// Opening the app: one call to the server (app_boot in server/src/boot.rs) for the game,
// settings, drill counts and puzzle status. On a device that came up on its snapshot this runs in
// the background and only changes the screen if the server has something newer.
import { hasBackend, invoke, isRemote } from "./backend";
import { useDrillCounts } from "./analysis/drills";
import { holdWrites, reliably, type GameRecord } from "./db";
import { openBooted } from "./game/session";
import { mark } from "./perf";
import { autoImport } from "./games/import";
import { refreshPack, sendLocalGames } from "./offline";
import { isLocalGame } from "./game/local";
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
    // A device that just woke up may not reach the server at first; keep trying.
    b = await (isRemote ? reliably("opening the app", () => invoke<Boot>("app_boot", { prefer })) : invoke<Boot>("app_boot", { prefer }));
  } catch (e) {
    release();
    throw e;
  }
  mark("server answered");
  applySettings(b.settings);
  useDrillCounts.setState(b.drillCounts);
  if (b.puzzles) applyPuzzleStatus(b.puzzles);
  // A game played offline on screen stays: it's sent now and carries on under its server id.
  const playingOffline = isLocalGame(useStore.getState().gameId);
  await sendLocalGames();
  if (playingOffline) release();
  else await openBooted(b.game, shown, release);
  mark("game up to date");
  autoImport();
  if (isRemote) void refreshPack();
}
