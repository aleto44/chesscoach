//! Games from the student's chess.com and Lichess accounts. This side only fetches (both sites'
//! public APIs, no login) and stores; the frontend (src/games/import.ts) reads the PGN, replays it
//! and converts ratings, then saves each game here. Saved games are finished and unanalyzed, so the
//! review backlog analyzes them and turns the student's mistakes into drills.

use std::time::Duration;

use rusqlite::params;
use serde::Deserialize;
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
    match agent.get(url).header("User-Agent", USER_AGENT).header("Accept", accept).call() {
        Ok(mut res) => res.body_mut().with_config().limit(64 * 1024 * 1024).read_to_string().map_err(err),
        Err(ureq::Error::StatusCode(404)) => Err(format!("No {what} player by that name.")),
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
#[tauri::command]
pub async fn import_fetch(site: String, user: String, max: usize) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let user = check_user(&user)?.to_string();
        let max = max.clamp(1, 300);
        match site.as_str() {
            "chesscom" => fetch_chesscom(&user, max),
            "lichess" => fetch_lichess(&user, max),
            _ => Err(format!("unknown site {site}")),
        }
    })
    .await
    .map_err(err)?
}

fn fetch_chesscom(user: &str, max: usize) -> Result<Vec<Value>, String> {
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
    let mut out = Vec::new();
    for month in months.iter().rev().take(MAX_MONTHS) {
        let body: Value = serde_json::from_str(&get(&agent, month, "application/json", "chess.com")?).map_err(err)?;
        let games = body["games"].as_array().cloned().unwrap_or_default();
        // Oldest first within a month.
        for g in games.into_iter().rev() {
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

fn fetch_lichess(user: &str, max: usize) -> Result<Vec<Value>, String> {
    let url = format!(
        "https://lichess.org/api/games/user/{user}?max={max}&pgnInJson=true&clocks=true&opening=false&perfType=ultraBullet,bullet,blitz,rapid,classical"
    );
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGame {
    source: String,
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
                 time_control, source, external_id, url, opponent_name, opponent_rating, student_rating, speed)
             VALUES (?1, ?1, ?1, ?2, ?3, ?4, ?5, ?6, 'rated', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
