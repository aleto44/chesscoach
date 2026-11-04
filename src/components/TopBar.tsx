import { useState } from "react";
import { startDrills, useDrill } from "../analysis/drillSession";
import { useDrillCounts } from "../analysis/drills";
import { isLocked, useStore } from "../store";
import { GamesDialog, NewGameDialog } from "./GameDialogs";
import { SettingsDialog } from "./SettingsDialog";

/** App-wide bar: starting, finding and drilling games on the left, settings on the right. */
export function TopBar() {
  const [dialog, setDialog] = useState<"new" | "games" | "settings" | null>(null);
  const meta = useStore((s) => s.meta);
  const started = useStore((s) => s.game.sans.length > 0);
  const drills = useDrillCounts();
  const drilling = useDrill((d) => d !== null);
  // Drilling mid-game would let a rated game's clock (or the position) sit while the engine talks.
  const drillsBlocked = !meta.result && (isLocked(meta) || (meta.timeControl !== null && started));
  const close = () => setDialog(null);
  return (
    <>
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden>
            ♞
          </span>
          Chess Coach
        </span>
        <button className="primary" onClick={() => setDialog("new")}>
          New game
        </button>
        <button onClick={() => setDialog("games")}>Games</button>
        <button
          className={drilling ? "on" : ""}
          onClick={() => startDrills()}
          disabled={drillsBlocked || drilling}
          title={drillsBlocked ? "Finish this game first" : `${drills.due} due of ${drills.total}`}
        >
          Drills{drills.due ? <span className="count">{drills.due}</span> : null}
        </button>
        <span className="spacer" />
        <button className="icon" onClick={() => setDialog("settings")} title="Settings" aria-label="Settings">
          ⚙
        </button>
      </header>
      {/* Outside the header, so the bar's button styles don't reach into the dialogs. */}
      {dialog === "new" && <NewGameDialog onClose={close} />}
      {dialog === "games" && <GamesDialog onClose={close} />}
      {dialog === "settings" && <SettingsDialog onClose={close} />}
    </>
  );
}
