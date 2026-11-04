import React from "react";
import ReactDOM from "react-dom/client";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./styles.css";
import App from "./App";
import { initAuth } from "./coach/auth";
import { initBridge } from "./coach/bridge";
import { initUsage } from "./coach/usage";
import { initPersistence } from "./db";
import { initOpponent } from "./game/opponent";
import { initClock } from "./game/clock";
import { initReview } from "./analysis/review";
import { refreshDrillCounts } from "./analysis/drills";
import { bootstrap, initGameOverWatch } from "./game/session";
import { initTheme, loadSettings } from "./settings";
import { initSounds } from "./sound";
import { initLiveEval } from "./engine/live";

initTheme();
initBridge();
initAuth();
initUsage();
initPersistence();
initGameOverWatch();
initOpponent();
initClock();
initReview();
refreshDrillCounts();
initSounds();
initLiveEval();
loadSettings().catch((e) => console.error("could not load settings", e));
bootstrap().catch((e) => console.error("could not open the last game", e));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Handle for poking at the running app from devtools.
if (import.meta.env.DEV) {
  Promise.all([import("./store"), import("./game/session"), import("./coach/auth"), import("./coach/usage"), import("./sound")]).then(
    ([store, session, auth, usage, sound]) => Object.assign(window, { __cc: { store, session, auth, usage, sound } }),
  );
}
