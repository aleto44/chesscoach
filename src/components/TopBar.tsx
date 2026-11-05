import { useState } from "react";
import { useDrill } from "../analysis/drillSession";
import { back, go, goHome, trail, useNav, VIEW_TITLE } from "../nav";
import { usePuzzle } from "../puzzles/session";
import { NewGameDialog } from "./GameDialogs";
import { SettingsDialog } from "./SettingsDialog";

/** App-wide bar: back and home on the left, where you are, then a quick new game and settings. */
export function TopBar() {
  const [dialog, setDialog] = useState<"new" | "settings" | null>(null);
  const view = useNav((n) => n.view);
  const drilling = useDrill((d) => d !== null);
  const puzzling = usePuzzle((p) => p !== null);
  const path = trail(view).slice(1);
  // A running session is one level below the menu it was started from.
  const session = puzzling ? "Solving" : drilling ? "Drilling" : null;
  const atHome = view === "home" && !session;
  const close = () => setDialog(null);
  return (
    <>
      <header className="topbar">
        <button className="icon nav-back" onClick={back} disabled={atHome} title="Back (Esc)" aria-label="Back">
          ←
        </button>
        <button className="brand" onClick={goHome} title="Main menu">
          <span className="brand-mark" aria-hidden>
            ♞
          </span>
          <span className="brand-name">Chess Coach</span>
        </button>
        <nav className="trail" aria-label="You are here">
          {path.map((v, i) => (
            <span key={v}>
              <span className="sep">›</span>
              <button
                className={`trail-step ${i === path.length - 1 && !session ? "current" : ""}`}
                onClick={() => go(v)}
              >
                {VIEW_TITLE[v]}
              </button>
            </span>
          ))}
          {session && (
            <span>
              <span className="sep">›</span>
              <span className="trail-step current">{session}</span>
            </span>
          )}
        </nav>
        <span className="spacer" />
        <button className="primary" onClick={() => setDialog("new")}>
          New game
        </button>
        <button className="icon" onClick={() => setDialog("settings")} title="Settings" aria-label="Settings">
          ⚙
        </button>
      </header>
      {/* Outside the header, so the bar's button styles don't reach into the dialogs. */}
      {dialog === "new" && <NewGameDialog onClose={close} />}
      {dialog === "settings" && <SettingsDialog onClose={close} />}
    </>
  );
}
