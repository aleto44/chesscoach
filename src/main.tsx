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
import { refreshDrillCounts } from "./analysis/drills";
import { initPuzzles } from "./puzzles/puzzles";
import { bootstrap, initGameOverWatch } from "./game/session";
import { initTheme, loadSettings } from "./settings";
import { initSounds } from "./sound";
import { initNav } from "./nav";
import { initLiveEval } from "./engine/live";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

function start() {
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
  refreshDrillCounts();
  initPuzzles();
  initSounds();
  initNav();
  initLiveEval();
  loadSettings().catch((e) => console.error("could not load settings", e));
  bootstrap().catch((e) => console.error("could not open the last game", e));

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

initTheme();
registerServiceWorker();
// On a phone, nothing works until it's paired with the computer.
checkPairing().then((paired) => (paired || usePairing.getState().status !== "unpaired" ? start() : root.render(<Pair />)));

// Handle for poking at the running app from devtools.
if (import.meta.env.DEV) {
  Promise.all([import("./store"), import("./game/session"), import("./coach/auth"), import("./coach/usage"), import("./sound")]).then(
    ([store, session, auth, usage, sound]) => Object.assign(window, { __cc: { store, session, auth, usage, sound } }),
  );
}
