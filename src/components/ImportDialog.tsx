import { useEffect, useState } from "react";
import { useBacklog } from "../analysis/review";
import { isTauri } from "../backend";
import { accountKey, importGames, loadAccounts, refreshAccount, removeAccount, useAccounts, useImport, type ImportAccount } from "../games/import";
import { saveSetting, useSettings } from "../settings";
import { SITE_NAME, type ImportSite } from "../store";
import { askConfirm } from "./Confirm";
import { Modal } from "./GameDialogs";
import { SiteBadge } from "./ModeBadge";

const HOW_MANY = [10, 25, 50, 100];

/**
 * The hub for the student's chess.com and Lichess accounts (no sign-in, just a username): every
 * account imported so far with its games, a refresh that brings in what was played since, removal
 * of an account imported by mistake, and adding another.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const accounts = useAccounts((s) => s.list);
  const [error, setError] = useState<string | null>(null);
  const backlog = useBacklog();
  useEffect(() => {
    loadAccounts().catch((e) => setError(String(e)));
  }, []);
  const named = accounts?.filter((a): a is ImportAccount & { account: string } => a.account !== null) ?? [];
  const busy = useImport((s) => Object.values(s).some((x) => x?.running));
  const refreshAll = async () => {
    for (const a of named) await refreshAccount(a).catch(() => undefined);
  };
  return (
    <Modal title="Import games" onClose={onClose} className="import-dialog">
      <p className="muted small">
        Your real games show how you really play. Each imported game gets the same review as a rated game here, its
        mistakes become drills, and it counts toward your Profile. Games stay on this computer. Daily games and variants
        are left out.
      </p>

      <div className="import-head">
        <h3>Your accounts</h3>
        {named.length > 1 && (
          <button onClick={refreshAll} disabled={busy}>
            ↻ Get new games for all
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
      {accounts?.length === 0 && <p className="muted small">None yet. Add your chess.com or Lichess username below.</p>}
      <div className="account-list">
        {accounts?.map((a) => <AccountRow key={accountKey(a.site, a.account)} a={a} />)}
      </div>

      <h3>Add an account</h3>
      <AddAccount />

      {isTauri && (
        <label className="toggle">
          <input type="checkbox" checked={settings.autoImport} onChange={(e) => saveSetting("autoImport", e.target.checked)} />
          <span>Get new games for every account when the app opens</span>
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

function AccountRow({ a }: { a: ImportAccount }) {
  const state = useImport((s) => s[accountKey(a.site, a.account)]);
  const [removing, setRemoving] = useState(false);
  const name = a.account ?? "Earlier imports";
  const remove = async () => {
    const sure = await askConfirm({
      title: a.account ? `Remove ${a.account}?` : `Remove earlier ${SITE_NAME[a.site]} imports?`,
      body: (
        <>
          <p>
            {a.games ? (
              <>
                Its <strong>{a.games} imported game{a.games === 1 ? "" : "s"}</strong> from {SITE_NAME[a.site]}, their
                reviews and the drills made from their mistakes are deleted for good.
              </>
            ) : (
              <>It has no games here; it just leaves the list.</>
            )}
          </p>
          <p className="muted">Your other accounts and the games you played here aren't touched.</p>
        </>
      ),
      confirmLabel: "Remove",
      danger: true,
    });
    if (!sure) return;
    setRemoving(true);
    try {
      await removeAccount(a.site, a.account);
    } catch (e) {
      setRemoving(false);
      useImport.setState({ [accountKey(a.site, a.account)]: { running: false, message: String(e), error: true } });
    }
  };
  const sub = [
    `${a.games} game${a.games === 1 ? "" : "s"}`,
    a.lastGameAt && `latest ${shortDate(a.lastGameAt)}`,
    a.refreshedAt && `checked ${ago(a.refreshedAt)}`,
  ].filter(Boolean);
  return (
    <div className="account-row">
      <div className="account-main">
        <div className="account-top">
          <SiteBadge site={a.site} />
          <strong className={a.account ? "" : "muted"}>{name}</strong>
        </div>
        <div className="muted small">{sub.join(" · ")}</div>
        {!a.account && (
          <div className="muted small">
            Imported before accounts were tracked. Getting new games on your account moves the ones it finds under it.
          </div>
        )}
        {state?.message && <div className={`small ${state.error ? "error" : "muted"}`}>{state.message}</div>}
      </div>
      <div className="account-actions">
        {a.account && (
          <button
            onClick={() => refreshAccount({ ...a, account: a.account! }).catch(() => undefined)}
            disabled={state?.running || removing}
            title="Bring in the games played since the latest one here"
          >
            {state?.running ? "Getting…" : "↻ Get new games"}
          </button>
        )}
        <button className="account-remove" onClick={remove} disabled={state?.running || removing} title="Remove this account and its games">
          {removing ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}

function AddAccount() {
  const [site, setSite] = useState<ImportSite>("chesscom");
  const [user, setUser] = useState("");
  const [max, setMax] = useState(25);
  const key = accountKey(site, user);
  const state = useImport((s) => s[key]);
  const [shown, setShown] = useState<string | null>(null);
  const go = () => {
    if (!user.trim()) return;
    setShown(key);
    importGames(site, user, max)
      .then(() => setUser(""))
      .catch(() => undefined);
  };
  // After a successful add the account shows in the list with its result; errors stay here.
  const last = useImport((s) => (shown ? s[shown] : undefined));
  return (
    <div className="add-account">
      <div className="segmented">
        {(["chesscom", "lichess"] as ImportSite[]).map((s) => (
          <button key={s} className={s === site ? "on" : ""} onClick={() => setSite(s)}>
            {SITE_NAME[s]}
          </button>
        ))}
      </div>
      <div className="import-inputs">
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder={`${SITE_NAME[site]} username, e.g. ${site === "chesscom" ? "hikaru" : "DrNykterstein"}`}
          aria-label={`${SITE_NAME[site]} username`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="primary" onClick={go} disabled={!user.trim() || state?.running}>
          {state?.running ? "Importing…" : "Import"}
        </button>
      </div>
      <label className="field">
        <span>Games to fetch (the latest)</span>
        <div className="segmented">
          {HOW_MANY.map((n) => (
            <button key={n} className={n === max ? "on" : ""} onClick={() => setMax(n)}>
              {n}
            </button>
          ))}
        </div>
      </label>
      {last?.running && <span className="small muted">{last.message}</span>}
      {last?.error && <span className="small error">{last.message}</span>}
    </div>
  );
}

const fromSqlite = (t: string) => new Date(t.replace(" ", "T") + "Z");

function shortDate(t: string) {
  return fromSqlite(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ago(t: string) {
  const mins = Math.round((Date.now() - fromSqlite(t).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
