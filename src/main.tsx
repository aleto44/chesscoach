import React from "react";
import ReactDOM from "react-dom/client";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./styles.css";
import App from "./App";
import { initAuth } from "./coach/auth";
import { initBridge } from "./coach/bridge";
import { initPersistence } from "./db";
import { initOpponent } from "./game/opponent";
import { bootstrap, initGameOverWatch } from "./game/session";
import { loadSettings } from "./settings";

initBridge();
initAuth();
initPersistence();
initGameOverWatch();
initOpponent();
loadSettings().catch((e) => console.error("could not load settings", e));
bootstrap().catch((e) => console.error("could not open the last game", e));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Handle for poking at the running app from devtools.
if (import.meta.env.DEV) {
  Promise.all([import("./store"), import("./game/session")]).then(([store, session]) => {
    Object.assign(window, { __cc: { store, session } });
  });
}
