import React from "react";
import ReactDOM from "react-dom/client";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./styles.css";
import "./features.css";
import App from "./App";
import { checkPairing, usePairing } from "./backend";
import { Pair } from "./components/Pair";
import { CrashScreen } from "./components/Crash";
import { registerServiceWorker } from "./pwa";
import { initAuth } from "./coach/auth";
import { initBridge } from "./coach/bridge";
import { initUsage } from "./coach/usage";
import { initPersistence } from "./db";
import { initOpponent } from "./game/opponent";
import { initClock } from "./game/clock";
import { initSync } from "./game/sync";
import { initReview } from "./analysis/review";
import { initQuiz } from "./coach/quiz";
import { initNudges } from "./coach/nudge";
import { initPuzzles } from "./puzzles/puzzles";
import { initGameOverWatch } from "./game/session";
import { initTheme } from "./settings";
import { initVisuals } from "./visuals";
import { initSounds } from "./sound";
import { initNav } from "./nav";
import { initPuzzleSession } from "./puzzles/session";
import { initDrillSession } from "./analysis/drillSession";
import { initLiveEval } from "./engine/live";
import { boot } from "./boot";
import { launchedFrom, mark } from "./perf";
import { initSnapshot, restoreSnapshot } from "./snapshot";
import { initOffline } from "./offline";
import { resumeOpponent } from "./game/opponent";
import { backfillLessons } from "./analysis/drills";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

mark("script running");
// Tells index.html's watchdog the code loaded, so it doesn't show "can't load".
(window as { __CC_STARTED__?: boolean }).__CC_STARTED__ = true;

function start() {
  // Phones: the last screen first (from the phone itself), the computer's copy after.
  const shown = restoreSnapshot();
  launchedFrom(shown !== null ? "snapshot" : "cold");
  initBridge();
  initAuth();
  initUsage();
  initPersistence();
  initGameOverWatch();
  initOpponent();
  initSync();
  initClock();
  initReview();
  initQuiz();
  initNudges();
  initPuzzles();
  initPuzzleSession();
  initDrillSession();
  initSounds();
  initNav();
  initLiveEval();
  initSnapshot();
  initOffline();
  boot(shown)
    .then(resumeOpponent)
    .catch((e) => console.error("could not open the app", e));
  // Drills made before lessons get theirs, in the background once the app has settled (computer only).
  window.setTimeout(() => void backfillLessons(), 30_000);

  root.render(
    <React.StrictMode>
      <CrashScreen>
        <App />
      </CrashScreen>
    </React.StrictMode>,
  );
  requestAnimationFrame(() => mark("first screen"));
}

initTheme();
initVisuals();
registerServiceWorker();
// On a phone, nothing works until it's paired with the computer. A phone that was paired before
// starts the app straight away (waiting for the computer to answer first kept a phone that had
// just come back to the app on a blank page) and only shows pairing if the computer says no.
const PAIRED = "cc-paired";
const pairedBefore = (() => {
  try {
    return localStorage.getItem(PAIRED) === "1";
  } catch {
    return false;
  }
})();
let started = false;
const startOnce = () => {
  if (!started) (started = true), start();
};
usePairing.subscribe(({ status }) => {
  try {
    if (status === "paired") localStorage.setItem(PAIRED, "1");
    if (status === "unpaired") localStorage.removeItem(PAIRED);
  } catch {
    // Private mode: pairing is just checked every time.
  }
  if (status === "unpaired") root.render(<Pair />);
});
if (pairedBefore) startOnce();
checkPairing().then((paired) => (paired || usePairing.getState().status !== "unpaired" ? startOnce() : root.render(<Pair />)));

// Handle for poking at the running app from devtools.
if (import.meta.env.DEV) {
  Promise.all([import("./store"), import("./game/session"), import("./coach/auth"), import("./coach/usage"), import("./sound")]).then(
    ([store, session, auth, usage, sound]) => Object.assign(window, { __cc: { store, session, auth, usage, sound } }),
  );
}
