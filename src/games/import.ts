// Importing the student's own games from chess.com and Lichess. The computer fetches them (both
// sites' public APIs, src-tauri/src/import.rs); here each one is read from its PGN, given the
// student's side and both ratings on the chess.com scale, and saved as a finished rated game. The
// review backlog then analyzes them like games played in the app, and mistakes become drills.
import { create } from "zustand";
import { invoke, isTauri } from "../backend";
import { analyzeBacklog } from "../analysis/review";
import { hasBackend, moveRows } from "../db";
import { fromLichess } from "../rating";
import { useSettings } from "../settings";
import { leaveDeletedGames } from "../game/session";
import type { Color, ImportSite } from "../store";
import { parsePgn } from "./pgn";

/** How one game looks once the site's own format is read. */
interface Candidate {
  externalId: string;
  url: string | null;
  playedAt: number;
  pgn: string;
  white: { name: string; rating: number | null };
  black: { name: string; rating: number | null };
  termination: string;
  timeControl: string | null;
  speed: string | null;
}

export interface ImportResult {
  site: ImportSite;
  fetched: number;
  added: number;
  already: number;
  skipped: number;
}

/** Per account (accountKey): an import running now, or how the last one went. */
export const useImport = create<Partial<Record<string, { running: boolean; message: string; error: boolean }>>>(() => ({}));

// ---- chess.com ----

/** The loser's (or both players') result code on chess.com → our termination. */
const CHESSCOM_END: Record<string, string> = {
  checkmated: "checkmate",
  resigned: "resignation",
  timeout: "timeout",
  abandoned: "abandoned",
  agreed: "agreement",
  repetition: "repetition",
  stalemate: "stalemate",
  insufficient: "insufficient material",
  "50move": "fifty-move rule",
  timevsinsufficient: "timeout vs insufficient material",
  kingofthehill: "king of the hill",
  threecheck: "three-check",
  bughousepartnerlose: "partner lost",
};

function fromChesscom(g: any): Candidate {
  const loser = g.white?.result === "win" ? g.black : g.white;
  const tc = typeof g.time_control === "string" && /^\d+(\+\d+)?$/.test(g.time_control) ? g.time_control : null;
  return {
    externalId: String(g.uuid ?? g.url),
    url: g.url ?? null,
    playedAt: Number(g.end_time) * 1000,
    pgn: g.pgn,
    white: { name: g.white?.username ?? "White", rating: g.white?.rating ?? null },
    black: { name: g.black?.username ?? "Black", rating: g.black?.rating ?? null },
    termination: CHESSCOM_END[loser?.result] ?? loser?.result ?? "unknown",
    timeControl: tc && (tc.includes("+") ? tc : `${tc}+0`),
    speed: g.time_class ?? null,
  };
}

// ---- Lichess ----

const LICHESS_END: Record<string, string> = {
  mate: "checkmate",
  resign: "resignation",
  outoftime: "timeout",
  timeout: "abandoned",
  draw: "agreement",
  stalemate: "stalemate",
  cheat: "cheat detected",
  noStart: "no start",
  variantEnd: "variant end",
};

/** Lichess game ratings are on Lichess's scale: shown and stored as chess.com numbers. */
const lichessRating = (r: unknown) => (typeof r === "number" ? fromLichess(r) : null);

function lichessName(p: any, side: string): string {
  if (p?.user?.name) return p.user.name;
  if (p?.aiLevel) return `Lichess AI level ${p.aiLevel}`;
  return `Anonymous (${side})`;
}

function fromLichessGame(g: any): Candidate {
  const clock = g.clock ? `${g.clock.initial}+${g.clock.increment}` : null;
  return {
    externalId: String(g.id),
    url: `https://lichess.org/${g.id}`,
    playedAt: Number(g.lastMoveAt ?? g.createdAt),
    pgn: g.pgn,
    white: { name: lichessName(g.players?.white, "white"), rating: lichessRating(g.players?.white?.rating) },
    black: { name: lichessName(g.players?.black, "black"), rating: lichessRating(g.players?.black?.rating) },
    termination: LICHESS_END[g.status] ?? g.status ?? "unknown",
    timeControl: clock,
    speed: g.speed === "ultraBullet" ? "bullet" : (g.speed ?? null),
  };
}

// ---- Saving ----

const sqliteTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const fromSqlite = (t: string) => Date.parse(t.replace(" ", "T") + "Z");

/** Games that never got going (aborted, or a move or two) teach nothing. */
const MIN_PLIES = 6;

/** A refresh looks back this far before the account's latest game, in case one ended late. */
const REFRESH_OVERLAP_MS = 24 * 3600_000;

/** How many games a refresh may bring in at most (the backend's cap). */
const REFRESH_MAX = 300;

/** Fetches `user`'s games from `site` (the latest `max`, or all since `since`) and saves the new ones. */
async function runImport(site: ImportSite, user: string, max: number, since: number | null): Promise<ImportResult> {
  user = user.trim();
  const key = accountKey(site, user);
  const set = (running: boolean, message: string, error = false) =>
    useImport.setState({ [key]: { running, message, error } });
  set(true, "Fetching games…");
  try {
    const raw = await invoke<any[]>("import_fetch", { site, user, max, since });
    const known = new Set(await invoke<string[]>("db_import_known", { site }));
    const result: ImportResult = { site, fetched: raw.length, added: 0, already: 0, skipped: 0 };
    const me = user.toLowerCase();
    // The site's own spelling of the username, as its games have it.
    let account = user;
    const seen: string[] = [];
    for (const [i, g] of raw.entries()) {
      set(true, `Reading game ${i + 1} of ${raw.length}…`);
      const c = site === "chesscom" ? fromChesscom(g) : fromLichessGame(g);
      const color: Color | null = c.white.name.toLowerCase() === me ? "white" : c.black.name.toLowerCase() === me ? "black" : null;
      if (color) account = (color === "white" ? c.white : c.black).name;
      if (known.has(c.externalId)) {
        seen.push(c.externalId);
        result.already++;
        continue;
      }
      let parsed;
      try {
        parsed = parsePgn(c.pgn);
      } catch (e) {
        console.warn(`skipping ${site} game ${c.externalId}`, e);
        result.skipped++;
        continue;
      }
      const res = parsed.headers.Result;
      if (!color || parsed.line.sans.length < MIN_PLIES || !(res === "1-0" || res === "0-1" || res === "1/2-1/2")) {
        result.skipped++;
        continue;
      }
      const me_ = color === "white" ? c.white : c.black;
      const them = color === "white" ? c.black : c.white;
      const id = await invoke<number | null>("db_import_game", {
        game: {
          source: site,
          account: me_.name,
          externalId: c.externalId,
          url: c.url,
          playedAt: sqliteTime(c.playedAt),
          startFen: parsed.line.startFen,
          studentColor: color,
          opponentName: them.name,
          opponentRating: them.rating,
          studentRating: me_.rating,
          result: res,
          termination: c.termination,
          timeControl: c.timeControl,
          speed: c.speed,
        },
        moves: moveRows(parsed.line, color, parsed.clocks),
      });
      if (id === null) result.already++;
      else result.added++;
    }
    await invoke("db_import_finish", { site, account, seen });
    set(false, summary(result, since !== null));
    localStorage.setItem(lastKey(site, account), String(Date.now()));
    if (result.added) analyzeBacklog();
    await loadAccounts();
    return result;
  } catch (e) {
    set(false, String(e).replace(/^Error: /, ""), true);
    throw e;
  }
}

/** Adds an account (or re-reads one): its latest `max` games. */
export const importGames = (site: ImportSite, user: string, max: number) => runImport(site, user, max, null);

/** New games on an account since its latest one here; the latest few if it has none yet. */
export function refreshAccount(a: ImportAccount & { account: string }) {
  const since = a.lastGameAt ? fromSqlite(a.lastGameAt) - REFRESH_OVERLAP_MS : null;
  return runImport(a.site, a.account, since === null ? 25 : REFRESH_MAX, since);
}

function summary(r: ImportResult, refresh: boolean): string {
  if (r.fetched === 0) return refresh ? "No new games since the last one here." : "No games found on that account.";
  const parts = [r.added ? `Added ${r.added} new game${r.added > 1 ? "s" : ""}` : "No new games"];
  if (r.already) parts.push(`${r.already} already here`);
  if (r.skipped) parts.push(`${r.skipped} skipped (too short or unfinished)`);
  return parts.join(", ") + ".";
}

// ---- Accounts ----

/** One account the student imported from; `account` null = games from before accounts were recorded. */
export interface ImportAccount {
  site: ImportSite;
  account: string | null;
  games: number;
  /** SQLite datetimes, UTC. */
  lastGameAt: string | null;
  refreshedAt: string | null;
}

export const useAccounts = create<{ list: ImportAccount[] | null }>(() => ({ list: null }));

export async function loadAccounts() {
  if (!hasBackend()) return;
  useAccounts.setState({ list: await invoke<ImportAccount[]>("db_import_accounts") });
}

/** Where useImport keeps an account's progress: usernames are the same in any case. */
export const accountKey = (site: ImportSite, account: string | null) => `${site}:${account?.trim().toLowerCase() ?? ""}`;

/**
 * Deletes an account's games, their reviews and the drills made from them, and forgets the
 * account. Returns how many games went.
 */
export async function removeAccount(site: ImportSite, account: string | null): Promise<number> {
  const ids = await invoke<number[]>("db_import_remove", { site, account });
  await leaveDeletedGames(ids);
  useImport.setState({ [accountKey(site, account)]: undefined });
  if (account) localStorage.removeItem(lastKey(site, account));
  await loadAccounts();
  return ids.length;
}

const lastKey = (site: ImportSite, account: string) => `cc-last-import-${accountKey(site, account)}`;
const AUTO_EVERY_MS = 6 * 3600_000;

/** Desktop: picks up new games on every account when the app opens, at most every few hours. */
export async function autoImport() {
  if (!isTauri || !hasBackend()) return;
  if (!useSettings.getState().autoImport) return;
  try {
    await loadAccounts();
  } catch (e) {
    return console.warn("could not list the import accounts", e);
  }
  for (const a of useAccounts.getState().list ?? []) {
    if (!a.account) continue;
    const last = Number(localStorage.getItem(lastKey(a.site, a.account)) ?? 0);
    if (Date.now() - last < AUTO_EVERY_MS) continue;
    await refreshAccount({ ...a, account: a.account }).catch((e) => console.warn(`auto-import of ${a.account} failed`, e));
  }
}
