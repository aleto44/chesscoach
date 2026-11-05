// Keeping the student's devices on the same game. Whichever device saves a change (a move, a
// coach message) announces it; the others reread the game from the database and become
// followers: they show the game but leave the opponent's moves to the device being played on,
// until the student touches them.
import { clientId, hasBackend, listen } from "../backend";
import { useStore } from "../store";
import { loadGame, reloadGame } from "./session";

let following = false;
/** True while another device is the one being played on; the opponent engine waits. */
export const isFollowing = () => following;

let timer: number | undefined;

export function initSync() {
  if (!hasBackend()) return;
  listen<{ gameId: number; from: string }>("game-changed", ({ payload }) => {
    if (payload.from === clientId) return;
    following = true;
    // Coach replies are saved in bursts; reload once they settle.
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const open = useStore.getState().gameId;
      (payload.gameId === open ? reloadGame(payload.gameId) : loadGame(payload.gameId)).catch((e) =>
        console.error("could not follow the other device", e),
      );
    }, 250);
  });
  // Touching this device makes it the one being played on again.
  const lead = () => (following = false);
  window.addEventListener("pointerdown", lead, true);
  window.addEventListener("keydown", lead, true);
}
