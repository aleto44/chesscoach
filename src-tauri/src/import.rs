//! Games from the student's chess.com and Lichess accounts. This side only fetches (both sites'
//! public APIs, no login) and stores; the frontend (src/games/import.ts) reads the PGN, replays it
//! and converts ratings, then saves each game here. Saved games are finished and unanalyzed, so the
//! review backlog analyzes them and turns the student's mistakes into drills.

use std::time::Duration;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::db::{err, Db, MoveRow};

/// Both sites ask API clients to say who they are.
const USER_AGENT: &str = "ChessCoach/0.1 (desktop chess training app)";

/// How many monthly chess.com archives to look through for enough games.
const MAX_MONTHS: usize = 24;

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(60)))
        .build()
        .into()
}

fn get(agent: &ureq::Agent, url: &str, accept: &str, what: &str) -> Result<String, String> {
    get_found(agent, url, accept, what)?.ok_or_else(|| format!("No {what} player by that name."))
}

/// Like `get`, but a 404 is None rather than an error.
fn get_found(agent: &ureq::Agent, url: &str, accept: &str, what: &str) -> Result<Option<String>, String> {
    match agent.get(url).header("User-Agent", USER_AGENT).header("Accept", accept).call() {
        Ok(mut res) => res.body_mut().with_config().limit(64 * 1024 * 1024).read_to_string().map(Some).map_err(err),
        Err(ureq::Error::StatusCode(404)) => Ok(None),
        Err(ureq::Error::StatusCode(429)) => Err(format!("{what} is limiting requests right now. Try again in a minute.")),
        Err(ureq::Error::StatusCode(code)) => Err(format!("{what} answered with error {code}.")),
        Err(e) => Err(format!("Couldn't reach {what}: {e}")),
    }
}

/// Usernames on both sites are letters, digits, '_' and '-'; anything else can't be one.
fn check_user(user: &str) -> Result<&str, String> {
    let user = user.trim();
    if user.is_empty() || user.len() > 30 || !user.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("That doesn't look like a username.".into());
    }
    Ok(user)
}

/// The site's own game objects (each with its PGN), newest first, at most `max`. Daily /
/// correspondence games and variants are left out: they aren't the student's over-the-board play.
/// `since` (ms since the epoch) leaves out games that ended before it, for a refresh.
#[tauri::command]
pub async fn import_fetch(site: String, user: String, max: usize, since: Option<i64>) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let user = check_user(&user)?.to_string();
        let max = max.clamp(1, 300);
        match site.as_str() {
            "chesscom" => fetch_chesscom(&user, max, since),
            "lichess" => fetch_lichess(&user, max, since),
            _ => Err(format!("unknown site {site}")),
        }
    })
    .await
    .map_err(err)?
}

/// "YYYY/MM" of a time in ms, the way chess.com's archive URLs end.
fn month_of(ms: i64) -> String {
    // Days since the epoch to a civil date (Howard Hinnant's algorithm).
    let z = ms.div_euclid(86_400_000) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}/{m:02}")
}

fn fetch_chesscom(user: &str, max: usize, since: Option<i64>) -> Result<Vec<Value>, String> {
    let agent = agent();
    let lower = user.to_lowercase();
    let archives: Value = serde_json::from_str(&get(
        &agent,
        &format!("https://api.chess.com/pub/player/{lower}/games/archives"),
        "application/json",
        "chess.com",
    )?)
    .map_err(err)?;
    let months: Vec<String> = archives["archives"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let first_month = since.map(month_of);
    let mut out = Vec::new();
    for month in months.iter().rev().take(MAX_MONTHS) {
        // Archive URLs end in /YYYY/MM, so months before `since` aren't fetched at all.
        if let Some(first) = &first_month {
            if month.len() >= 7 && month[month.len() - 7..] < first[..] {
                break;
            }
        }
        // chess.com lists the current month before it has an archive, and answers 404 for it.
        let Some(body) = get_found(&agent, month, "application/json", "chess.com")? else { continue };
        let body: Value = serde_json::from_str(&body).map_err(err)?;
        let games = body["games"].as_array().cloned().unwrap_or_default();
        // Oldest first within a month.
        for g in games.into_iter().rev() {
            if since.is_some_and(|s| g["end_time"].as_i64().unwrap_or(0) * 1000 < s) {
                continue;
            }
            if g["rules"] == "chess" && g["time_class"] != "daily" && g["pgn"].is_string() {
                out.push(g);
                if out.len() >= max {
                    return Ok(out);
                }
            }
        }
    }
    Ok(out)
}

fn fetch_lichess(user: &str, max: usize, since: Option<i64>) -> Result<Vec<Value>, String> {
    let mut url = format!(
        "https://lichess.org/api/games/user/{user}?max={max}&pgnInJson=true&clocks=true&opening=false&perfType=ultraBullet,bullet,blitz,rapid,classical"
    );
    if let Some(since) = since {
        url.push_str(&format!("&since={since}"));
    }
    let body = get(&agent(), &url, "application/x-ndjson", "Lichess")?;
    body.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str::<Value>(l).map_err(err))
        .filter(|g| g.as_ref().map_or(true, |g| g["variant"] == "standard" || g["variant"] == "fromPosition"))
        .collect()
}

/// Ids of the games already imported from `site`, so they aren't read again.
#[tauri::command]
pub fn db_import_known(db: State<Db>, site: String) -> Result<Vec<String>, String> {
    let conn = db.conn();
    let mut stmt = conn.prepare("SELECT external_id FROM games WHERE source = ?1").map_err(err)?;
    let ids = stmt.query_map([site], |r| r.get(0)).map_err(err)?.collect::<Result<Vec<String>, _>>().map_err(err);
    ids
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAccount {
    site: String,
    /// None: games imported before accounts were recorded.
    account: Option<String>,
    games: i64,
    /// SQLite datetimes, UTC.
    last_game_at: Option<String>,
    refreshed_at: Option<String>,
}

/// The student's accounts, each with its games; then, per site, the games imported before
/// accounts were recorded, while any are left.
#[tauri::command]
pub fn db_import_accounts(db: State<Db>) -> Result<Vec<ImportAccount>, String> {
    import_accounts(&db.conn())
}

pub(crate) fn import_accounts(conn: &rusqlite::Connection) -> Result<Vec<ImportAccount>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT site, account, games, last_game_at, refreshed_at FROM (
                SELECT a.site AS site, a.account AS account, count(g.id) AS games, max(g.ended_at) AS last_game_at,
                       a.refreshed_at AS refreshed_at
                FROM import_accounts a
                LEFT JOIN games g ON g.source = a.site AND g.account = a.account COLLATE NOCASE
                GROUP BY a.site, a.account
                UNION ALL
                SELECT source, NULL, count(*), max(ended_at), NULL
                FROM games WHERE source IS NOT NULL AND account IS NULL GROUP BY source
             ) ORDER BY account IS NULL, site, account COLLATE NOCASE",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ImportAccount {
                site: r.get(0)?,
                account: r.get(1)?,
                games: r.get(2)?,
                last_game_at: r.get(3)?,
                refreshed_at: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    rows
}

/// After an import or refresh went through: remembers the account (in the site's own spelling),
/// stamps the refresh, and claims the games in `seen` that were imported before accounts were
/// recorded, now that it's known whose they are.
#[tauri::command]
pub fn db_import_finish(db: State<Db>, site: String, account: String, seen: Vec<String>) -> Result<(), String> {
    import_finish(&mut db.conn(), &site, &account, &seen)
}

pub(crate) fn import_finish(conn: &mut rusqlite::Connection, site: &str, account: &str, seen: &[String]) -> Result<(), String> {
    let account = check_user(account)?;
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO import_accounts (site, account, refreshed_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT (site, account) DO UPDATE SET account = excluded.account, refreshed_at = excluded.refreshed_at",
        params![site, account],
    )
    .map_err(err)?;
    // One spelling for the account and its games.
    tx.execute(
        "UPDATE games SET account = ?2 WHERE source = ?1 AND account = ?2 COLLATE NOCASE AND account <> ?2",
        params![site, account],
    )
    .map_err(err)?;
    {
        let mut claim = tx
            .prepare("UPDATE games SET account = ?2 WHERE source = ?1 AND external_id = ?3 AND account IS NULL")
            .map_err(err)?;
        for id in seen {
            claim.execute(params![site, account, id]).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

/// Removes an account: its games (moves and chat go with them), the drills made from their
/// mistakes, and the coach's notes on them, since none of it is the student's play if the account
/// was the wrong one. `account` None removes the games imported before accounts were recorded.
/// Returns the ids of the deleted games.
#[tauri::command]
pub fn db_import_remove(db: State<Db>, site: String, account: Option<String>) -> Result<Vec<i64>, String> {
    import_remove(&mut db.conn(), &site, account.as_deref())
}

pub(crate) fn import_remove(conn: &mut rusqlite::Connection, site: &str, account: Option<&str>) -> Result<Vec<i64>, String> {
    let tx = conn.transaction().map_err(err)?;
    let ids: Vec<i64> = {
        let mut stmt = tx
            .prepare(
                "SELECT id FROM games WHERE source = ?1
                   AND CASE WHEN ?2 IS NULL THEN account IS NULL ELSE account = ?2 COLLATE NOCASE END",
            )
            .map_err(err)?;
        let ids = stmt.query_map(params![site, account], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
        ids
    };
    for sql in [
        "DELETE FROM drills WHERE source_game_id = ?1",
        "DELETE FROM observations WHERE game_id = ?1",
        "DELETE FROM games WHERE id = ?1",
    ] {
        let mut del = tx.prepare(sql).map_err(err)?;
        for id in &ids {
            del.execute([id]).map_err(err)?;
        }
    }
    if let Some(account) = account {
        tx.execute("DELETE FROM import_accounts WHERE site = ?1 AND account = ?2", params![site, account]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(ids)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGame {
    source: String,
    /// The student's username on that site.
    account: Option<String>,
    external_id: String,
    url: Option<String>,
    /// SQLite datetime, UTC: when the game ended.
    played_at: String,
    start_fen: String,
    student_color: String,
    opponent_name: String,
    opponent_rating: Option<i64>,
    student_rating: Option<i64>,
    result: String,
    termination: String,
    time_control: Option<String>,
    speed: Option<String>,
}

/// Saves one imported game with its moves. None when it was already there.
#[tauri::command]
pub fn db_import_game(db: State<Db>, game: ImportedGame, moves: Vec<MoveRow>) -> Result<Option<i64>, String> {
    import_game(&mut db.conn(), game, moves)
}

pub(crate) fn import_game(conn: &mut rusqlite::Connection, game: ImportedGame, moves: Vec<MoveRow>) -> Result<Option<i64>, String> {
    if game.source != "chesscom" && game.source != "lichess" {
        return Err(format!("unknown source {}", game.source));
    }
    if game.student_color != "white" && game.student_color != "black" {
        return Err("an imported game needs the student's side".into());
    }
    let tx = conn.transaction().map_err(err)?;
    let added = tx
        .execute(
            "INSERT OR IGNORE INTO games
                (started_at, updated_at, ended_at, start_fen, student_color, opponent, result, termination, mode,
                 time_control, source, external_id, url, opponent_name, opponent_rating, student_rating, speed, account)
             VALUES (?1, ?1, ?1, ?2, ?3, ?4, ?5, ?6, 'rated', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                game.played_at,
                game.start_fen,
                game.student_color,
                format!("{}:{}", game.source, game.opponent_name),
                game.result,
                game.termination,
                game.time_control,
                game.source,
                game.external_id,
                game.url,
                game.opponent_name,
                game.opponent_rating,
                game.student_rating,
                game.speed,
                game.account,
            ],
        )
        .map_err(err)?;
    if added == 0 {
        return Ok(None);
    }
    let id = tx.last_insert_rowid();
    {
        let mut insert = tx
            .prepare(
                "INSERT INTO moves (game_id, ply, san, uci, fen_before, fen_after, by_student, clock_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(err)?;
        for m in &moves {
            insert
                .execute(params![id, m.ply, m.san, m.uci, m.fen_before, m.fen_after, m.by_student, m.clock_ms])
                .map_err(err)?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(Some(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imported_games_feed_the_profile() {
        let path = std::env::temp_dir().join(format!("cc-import-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        let mut conn = db.conn();
        let game = |id: &str| ImportedGame {
            source: "chesscom".into(),
            account: None,
            external_id: id.into(),
            url: None,
            played_at: "2026-10-01 12:00:00".into(),
            start_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
            student_color: "white".into(),
            opponent_name: "someone".into(),
            opponent_rating: Some(1400),
            student_rating: Some(1350),
            result: "1-0".into(),
            termination: "resignation".into(),
            time_control: Some("600+0".into()),
            speed: Some("rapid".into()),
        };
        let mv = || MoveRow {
            ply: 1,
            san: "e4".into(),
            uci: "e2e4".into(),
            fen_before: "x".into(),
            fen_after: "y".into(),
            by_student: true,
            clock_ms: Some(599_000),
            analysis: None,
        };
        let id = import_game(&mut conn, game("a"), vec![mv()]).unwrap();
        assert!(id.is_some());
        // The same game again is skipped.
        assert_eq!(import_game(&mut conn, game("a"), vec![mv()]).unwrap(), None);
        // Imported games never move the in-app rating.
        assert_eq!(crate::db::player_rating(&conn).unwrap().1, 0);
        conn.execute(
            "UPDATE moves SET class = 'blunder', cp_loss = 400, phase = 'opening', tags = '[\"hung-piece\"]'", [],
        )
        .unwrap();
        conn.execute("UPDATE games SET analyzed_at = datetime('now')", []).unwrap();
        let w = crate::stats::weakness(&conn, "all", 50).unwrap();
        assert_eq!(w["summary"]["games"], 1);
        assert_eq!(w["summary"]["blunders"], 1);
        assert_eq!(w["tags"][0]["tag"], "hung-piece");
        assert_eq!(crate::stats::weakness(&conn, "app", 50).unwrap()["summary"]["games"], 0);
        let h = crate::stats::rating_history(&conn).unwrap();
        assert_eq!(h["imported"][0]["speed"], "rapid");
        assert_eq!(h["imported"][0]["points"][0][1], 1350);

        // Game "a" was imported before accounts were recorded: it shows as an unknown account
        // until a refresh of the right account sees it again.
        let accounts = import_accounts(&conn).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!((accounts[0].account.as_deref(), accounts[0].games), (None, 1));
        import_finish(&mut conn, "chesscom", "Me", &["a".into()]).unwrap();
        let tagged = |id: &str, account: &str| ImportedGame { account: Some(account.into()), ..game(id) };
        import_game(&mut conn, tagged("b", "me"), vec![mv()]).unwrap().unwrap();
        // A second account, imported by mistake, with a drill made from its game.
        let wrong = import_game(&mut conn, tagged("c", "SomeoneElse"), vec![mv()]).unwrap().unwrap();
        import_finish(&mut conn, "chesscom", "SomeoneElse", &[]).unwrap();
        conn.execute(
            "INSERT INTO drills (kind, title, fen, color, source_game_id) VALUES ('mistake', 't', 'f', 'white', ?1)",
            [wrong],
        )
        .unwrap();
        let accounts = import_accounts(&conn).unwrap();
        let summary: Vec<_> = accounts.iter().map(|a| (a.account.clone().unwrap_or_default(), a.games)).collect();
        assert_eq!(summary, vec![("Me".to_string(), 2), ("SomeoneElse".to_string(), 1)]);

        // Removing it takes its game and drill, and nothing of the right account's.
        assert_eq!(import_remove(&mut conn, "chesscom", Some("someoneelse")).unwrap(), vec![wrong]);
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(count("SELECT count(*) FROM drills"), 0);
        assert_eq!(count("SELECT count(*) FROM games"), 2);
        assert_eq!(import_accounts(&conn).unwrap().len(), 1);

        // Refresh only reads chess.com's archives from the month of the last game on.
        assert_eq!(month_of(0), "1970/01");
        assert_eq!(month_of(1_793_000_000_000), "2026/10");
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
