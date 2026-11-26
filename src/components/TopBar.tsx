import { useState } from "react";
import { useDrill } from "../analysis/drillSession";
import { back, go, goHome, trail, useNav, VIEW_TITLE } from "../nav";
import { usePuzzle } from "../puzzles/session";
import { useEndgame } from "../endgames/session";
import { useOpening } from "../openings/session";
import { useGuess } from "../guess/session";
import { usePlan } from "../plans/session";
import { NewGameDialog } from "./GameDialogs";
import { API_VERSION, isPhone, isRemote, useConnection, useServerVersion } from "../backend";
import { useOutbox } from "../offline";
import { SettingsDialog } from "./SettingsDialog";
import { AnalysisButton } from "./Analysis";
import { VoiceButton } from "./Voice";
import { DrawButton } from "./DrawMode";
import { useAnalysis } from "../analysis/layer";

/** App-wide bar: back and home on the left, where you are, then a quick new game and settings. */
export function TopBar() {
  const [dialog, setDialog] = useState<"new" | "settings" | null>(null);
  const view = useNav((n) => n.view);
  const drilling = useDrill((d) => d !== null);
  const puzzling = usePuzzle((p) => p !== null);
  const path = trail(view).slice(1);
  // A running session is one level below the menu it was started from.
  const endgame = useEndgame((e) => e !== null);
  const guessing = useGuess((g) => g !== null);
  const planning = usePlan((p) => p !== null);
  const opening = useOpening((o) => o !== null);
  const analyzing = useAnalysis((a) => a !== null);
  const session = analyzing ? "Analysis" : puzzling ? "Solving" : drilling ? "Drilling" : endgame ? "Endgame" : opening ? "Opening" : guessing ? "Guessing" : planning ? "Planning" : null;
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
        <OfflineChip />
        <VersionChip />
        <VoiceButton />
        {/* Desktop draws with right-click drag; only the phone app needs the pencil. */}
        {isPhone && <DrawButton />}
        <AnalysisButton />
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

/**
 * Whether the server is there, always on screen (a green dot while it is), plus how
 * many results wait to sync.
 */
function OfflineChip() {
  const reachable = useConnection((c) => c.reachable);
  const pending = useOutbox((o) => o.pending);
  if (!isRemote) return null;
  if (reachable && !pending)
    return <span className="online-dot" role="status" aria-label="Connected to the server" title="Connected to the server." />;
  const label = reachable ? `Syncing ${pending}…` : pending ? `Offline · ${pending} to sync` : "Offline";
  const chip = (
    <span
      className={`offline-chip ${reachable ? "syncing" : ""}`}
      title={
        reachable
          ? "Sending what you did offline to the server."
          : "Can't reach the server. Games against the computer, puzzles, drills and the trainers still work; results sync when it's back. The coach needs the server."
      }
    >
      {label}
    </span>
  );
  if (reachable) return chip;
  return (
    <>
      {chip}
      <TailscaleHint />
    </>
  );
}

/**
 * The desktop app carries its own copy of the frontend. One built for another server version
 * could write what the server doesn't expect, so it says so (deploy and rebuild to fix).
 */
function VersionChip() {
  const server = useServerVersion((v) => v.apiVersion);
  if (server === null || server === API_VERSION) return null;
  return (
    <span className="offline-chip" role="status" title={`This app speaks version ${API_VERSION} and the server ${server}. Update the one that's older.`}>
      Update needed
    </span>
  );
}

/**
 * Next to "Offline": the usual reason is that Android stopped the phone's Tailscale VPN (an app
 * update, a restart). On Android it opens the Tailscale app.
 */
function TailscaleHint() {
  const title = "Is Tailscale on? Devices reach the server through it.";
  if (!/Android/i.test(navigator.userAgent))
    return <span className="tail-chip" title={title}>Tail?</span>;
  return (
    <a className="tail-chip" href="intent://#Intent;package=com.tailscale.ipn;end" title={`${title} Tap to open it.`}>
      Tail?
    </a>
  );
}
