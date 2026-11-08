import { useState } from "react";
import { useBacklog } from "../analysis/review";
import { isTauri } from "../backend";
import { importGames, useImport } from "../games/import";
import { saveSetting, useSettings } from "../settings";
import { SITE_NAME, type ImportSite } from "../store";
import { Modal } from "./GameDialogs";

const HOW_MANY = [10, 25, 50, 100];

/** Brings in the student's games from chess.com and Lichess, by username (no sign-in needed). */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const [max, setMax] = useState(25);
  const backlog = useBacklog();
  return (
    <Modal title="Import your games" onClose={onClose}>
      <p className="muted small">
        Your real games show how you really play. Each imported game gets the same review as a rated game here, its
        mistakes become drills, and it counts toward your Profile. Games stay on this computer. Daily games and variants
        are left out.
      </p>
      <SiteRow site="chesscom" user={settings.chesscomUser} max={max} />
      <SiteRow site="lichess" user={settings.lichessUser} max={max} />
      <label className="field">
        <span>Games to fetch from each site (the latest)</span>
        <div className="segmented">
          {HOW_MANY.map((n) => (
            <button key={n} className={n === max ? "on" : ""} onClick={() => setMax(n)}>
              {n}
            </button>
          ))}
        </div>
      </label>
      {isTauri && (
        <label className="toggle">
          <input type="checkbox" checked={settings.autoImport} onChange={(e) => saveSetting("autoImport", e.target.checked)} />
          <span>Check for new games when the app opens</span>
        </label>
      )}
      {backlog && (
        <p className="muted small">
          Reviewing games: {backlog.done} of {backlog.total} done. You can keep using the app meanwhile.
        </p>
      )}
    </Modal>
  );
}

function SiteRow({ site, user: saved, max }: { site: ImportSite; user: string; max: number }) {
  const [user, setUser] = useState(saved);
  const state = useImport((s) => s[site]);
  const go = () => user.trim() && importGames(site, user, max).catch(() => undefined);
  return (
    <div className="field import-row">
      <span>{SITE_NAME[site]} username</span>
      <div className="import-inputs">
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder={site === "chesscom" ? "e.g. hikaru" : "e.g. DrNykterstein"}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="primary" onClick={go} disabled={!user.trim() || state?.running}>
          {state?.running ? "Importing…" : "Import"}
        </button>
      </div>
      {state?.message && <span className={`small ${state.error ? "error" : "muted"}`}>{state.message}</span>}
    </div>
  );
}
