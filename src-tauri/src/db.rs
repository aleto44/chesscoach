//! SQLite storage: games and their moves, plus the tangents and chat that belong to each game.
//! Eval / cp-loss columns on `moves` are filled in later by game analysis (review mode).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

pub struct Db(Mutex<Connection>);

impl Db {
    pub(crate) fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap()
    }
}

/// Append-only; each entry runs once and bumps `user_version`.
const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE games (
    id               INTEGER PRIMARY KEY,
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at         TEXT,
    start_fen        TEXT NOT NULL,
    student_color    TEXT NOT NULL,          -- 'white' | 'black' | 'both' (free play)
    opponent         TEXT,                   -- e.g. 'stockfish-cc:1500' (chess.com-scale); NULL = free play
    result           TEXT,                   -- '1-0' | '0-1' | '1/2-1/2'; NULL = in progress
    termination      TEXT,                   -- 'checkmate', 'resignation', 'stalemate', ...
    coach_session_id TEXT
);

CREATE TABLE moves (
    game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    ply           INTEGER NOT NULL,          -- 1-based
    san           TEXT NOT NULL,
    uci           TEXT NOT NULL,
    fen_before    TEXT NOT NULL,
    fen_after     TEXT NOT NULL,
    by_student    INTEGER NOT NULL,
    eval_before   INTEGER,                   -- centipawns, White's view
    eval_after    INTEGER,
    cp_loss       INTEGER,
    PRIMARY KEY (game_id, ply)
);

CREATE TABLE tangents (
    id         TEXT PRIMARY KEY,
    game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    parent_id  TEXT,
    title      TEXT NOT NULL,
    author     TEXT NOT NULL,                -- 'coach' | 'student'
    start_fen  TEXT NOT NULL,
    sans       TEXT NOT NULL,                -- JSON array of SAN
    notes      TEXT NOT NULL,                -- JSON array, parallel to sans
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX tangents_game ON tangents(game_id);

CREATE TABLE chat_items (
    id         TEXT PRIMARY KEY,
    game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    data       TEXT NOT NULL,                -- JSON of the frontend ChatItem
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX chat_items_game ON chat_items(game_id, seq);
"#, r#"
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL                     -- JSON
);
"#, r#"
-- How a game was played, fixed when it starts. Analysis of the student's real strength uses
-- rated games only.
--   'rated':    no engine, no coach and no takebacks until the game is over: unaided play.
--   'practice': engine, coach and takebacks allowed. Not evidence of unaided strength.
ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'practice' CHECK (mode IN ('rated', 'practice'));
ALTER TABLE games ADD COLUMN takebacks INTEGER NOT NULL DEFAULT 0;

-- A rated game may be downgraded to practice (the student asked for help), never the reverse.
CREATE TRIGGER games_mode_one_way BEFORE UPDATE OF mode ON games
WHEN OLD.mode = 'practice' AND NEW.mode = 'rated'
BEGIN
    SELECT RAISE(ABORT, 'a practice game cannot become rated');
END;

CREATE VIEW rated_games AS SELECT * FROM games WHERE mode = 'rated';
"#, r#"
-- PGN-style 'seconds+increment', e.g. '180+2' for 3+2 blitz; NULL = no clock.
ALTER TABLE games ADD COLUMN time_control TEXT;
-- The mover's clock right after the move (increment included), in ms; NULL without a clock.
ALTER TABLE moves ADD COLUMN clock_ms INTEGER;

-- rated_games was SELECT * when created, so it doesn't see new columns until it's recreated.
DROP VIEW rated_games;
CREATE VIEW rated_games AS SELECT * FROM games WHERE mode = 'rated';
"#, r#"
-- Post-game analysis (local Stockfish), filled in once a game is over. Evals are centipawns from
-- White's view, mates clamped to +-10000. cp_loss is from the mover's view, capped at 1000.
ALTER TABLE moves ADD COLUMN best_uci TEXT;
ALTER TABLE moves ADD COLUMN class TEXT;        -- 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
ALTER TABLE moves ADD COLUMN phase TEXT;        -- 'opening' | 'middlegame' | 'endgame'
ALTER TABLE moves ADD COLUMN tags TEXT;         -- JSON array, e.g. ["time-trouble", "hung-piece"]
ALTER TABLE games ADD COLUMN analyzed_at TEXT;
ALTER TABLE games ADD COLUMN opening_name TEXT; -- from the app's opening book, e.g. 'Sicilian Defense: Najdorf'

-- Notes the coach makes about the student ("keeps missing back-rank threats").
CREATE TABLE observations (
    id         INTEGER PRIMARY KEY,
    game_id    INTEGER REFERENCES games(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    tag        TEXT NOT NULL,
    note       TEXT NOT NULL,
    fen        TEXT
);

-- Spaced-repetition cards. Separate from games: drill answers are never counted as game moves.
--   'mistake': a position from one of the student's games where they went wrong; find a good move.
--   'opening': a repertoire line to play from memory (line holds the SAN moves from fen).
--   'coach':   a position the coach set as an exercise.
CREATE TABLE drills (
    id             INTEGER PRIMARY KEY,
    kind           TEXT NOT NULL CHECK (kind IN ('mistake', 'opening', 'coach')),
    title          TEXT NOT NULL,
    fen            TEXT NOT NULL,           -- the position the drill starts from
    color          TEXT NOT NULL,           -- the side the student plays
    answer_uci     TEXT,                    -- best move ('mistake' / 'coach')
    line           TEXT NOT NULL DEFAULT '', -- JSON array of SAN ('opening')
    note           TEXT,
    source_game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
    source_ply     INTEGER,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    due_at         TEXT NOT NULL DEFAULT (datetime('now')),
    interval_days  REAL NOT NULL DEFAULT 0,
    ease           REAL NOT NULL DEFAULT 2.5,
    reps           INTEGER NOT NULL DEFAULT 0,
    lapses         INTEGER NOT NULL DEFAULT 0,
    retired        INTEGER NOT NULL DEFAULT 0,
    UNIQUE (kind, fen, line)
);
CREATE INDEX drills_due ON drills(retired, due_at);

CREATE TABLE drill_attempts (
    id         INTEGER PRIMARY KEY,
    drill_id   INTEGER NOT NULL REFERENCES drills(id) ON DELETE CASCADE,
    at         TEXT NOT NULL DEFAULT (datetime('now')),
    correct    INTEGER NOT NULL,
    played     TEXT NOT NULL,               -- SAN the student played (the first wrong one, if any)
    ms         INTEGER                      -- thinking time
);

-- The openings the student wants to play, per color.
CREATE TABLE repertoire (
    id         INTEGER PRIMARY KEY,
    color      TEXT NOT NULL CHECK (color IN ('white', 'black')),
    name       TEXT NOT NULL,
    moves      TEXT NOT NULL,               -- JSON array of SAN from the start position
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (color, moves)
);
"#, r#"
-- The opening the student chose to practice: the opponent follows this line (JSON array of SAN
-- from the start) while the game stays in it. NULL = the opponent chose freely from move one.
ALTER TABLE games ADD COLUMN opening_focus TEXT;
DROP VIEW rated_games;
CREATE VIEW rated_games AS SELECT * FROM games WHERE mode = 'rated';
"#, r#"
-- Lichess puzzles the student tried (the puzzles themselves are in puzzles.db, attached as pz).
-- Only the first try at a puzzle is rated; rating_after is the student's puzzle rating after it.
CREATE TABLE puzzle_attempts (
    id            INTEGER PRIMARY KEY,
    puzzle_id     TEXT NOT NULL,            -- Lichess puzzle id
    at            TEXT NOT NULL DEFAULT (datetime('now')),
    correct       INTEGER NOT NULL,
    ms            INTEGER,
    puzzle_rating INTEGER NOT NULL,
    rated         INTEGER NOT NULL,
    rating_after  INTEGER NOT NULL,
    themes        TEXT NOT NULL             -- space-separated copy, so stats don't need puzzles.db
);
CREATE INDEX puzzle_attempts_puzzle ON puzzle_attempts(puzzle_id);

-- A fourth drill kind, 'puzzle': a missed Lichess puzzle (line holds the solution in SAN from fen,
-- the opponent's replies included). SQLite can't alter a CHECK, so the table is rebuilt.
CREATE TABLE drills_new (
    id             INTEGER PRIMARY KEY,
    kind           TEXT NOT NULL CHECK (kind IN ('mistake', 'opening', 'coach', 'puzzle')),
    title          TEXT NOT NULL,
    fen            TEXT NOT NULL,
    color          TEXT NOT NULL,
    answer_uci     TEXT,
    line           TEXT NOT NULL DEFAULT '',
    note           TEXT,
    source_game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
    source_ply     INTEGER,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    due_at         TEXT NOT NULL DEFAULT (datetime('now')),
    interval_days  REAL NOT NULL DEFAULT 0,
    ease           REAL NOT NULL DEFAULT 2.5,
    reps           INTEGER NOT NULL DEFAULT 0,
    lapses         INTEGER NOT NULL DEFAULT 0,
    retired        INTEGER NOT NULL DEFAULT 0,
    UNIQUE (kind, fen, line)
);
INSERT INTO drills_new SELECT * FROM drills;
DROP TABLE drills;
ALTER TABLE drills_new RENAME TO drills;
CREATE INDEX drills_due ON drills(retired, due_at);
"#, r#"
-- The review's chess.com-style verdict on an analyzed move, finer than class: 'brilliant' |
-- 'great' | 'best' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder'.
ALTER TABLE moves ADD COLUMN label TEXT;
"#, r#"
-- Move grading changed (centipawns lost count in positions that aren't won, so hanging pieces
-- while behind are blunders again): re-analyze every game on the next launch. Drills are unique
-- per position, so existing ones aren't duplicated.
UPDATE games SET analyzed_at = NULL;
"#, r#"
-- The student's game rating (chess.com scale) before and after each rated game that counted.
-- NULL = the game didn't count (practice, unfinished, or finished before ratings existed).
ALTER TABLE games ADD COLUMN rating_before INTEGER;
ALTER TABLE games ADD COLUMN rating_after INTEGER;
"#, r#"
-- Games imported from the student's chess.com and Lichess accounts (src-tauri/src/import.rs).
-- They're stored as rated games (real play, no help) but never move the in-app rating: their
-- opponent key is 'chesscom:<name>' / 'lichess:<name>', which rate_game ignores.
ALTER TABLE games ADD COLUMN source TEXT;            -- 'chesscom' | 'lichess'; NULL = played in this app
ALTER TABLE games ADD COLUMN external_id TEXT;       -- the site's game id
ALTER TABLE games ADD COLUMN url TEXT;
ALTER TABLE games ADD COLUMN opponent_name TEXT;
ALTER TABLE games ADD COLUMN opponent_rating INTEGER; -- chess.com scale (Lichess converted on import)
ALTER TABLE games ADD COLUMN student_rating INTEGER;  -- the student's own rating in that game, chess.com scale
ALTER TABLE games ADD COLUMN speed TEXT;             -- 'bullet' | 'blitz' | 'rapid' | 'classical'
CREATE UNIQUE INDEX games_external ON games(source, external_id) WHERE source IS NOT NULL;
DROP VIEW rated_games;
CREATE VIEW rated_games AS SELECT * FROM games WHERE mode = 'rated';
"#, r#"
-- Which of the student's accounts an imported game came from, so a whole account can be
-- refreshed or removed (src-tauri/src/import.rs). NULL on games imported before this: an
-- account's refresh claims the ones it sees again.
ALTER TABLE games ADD COLUMN account TEXT;
CREATE INDEX games_account ON games(source, account) WHERE source IS NOT NULL;
-- Every account the student has imported from, even one whose games were all skipped.
CREATE TABLE import_accounts (
    site         TEXT NOT NULL,              -- 'chesscom' | 'lichess'
    account      TEXT NOT NULL COLLATE NOCASE, -- the site's own spelling of the username
    added_at     TEXT NOT NULL DEFAULT (datetime('now')),
    refreshed_at TEXT,
    PRIMARY KEY (site, account)
);
-- The one username per site the app used to keep in settings.
INSERT OR IGNORE INTO import_accounts (site, account)
    SELECT CASE key WHEN 'chesscomUser' THEN 'chesscom' ELSE 'lichess' END, json_extract(value, '$')
    FROM settings
    WHERE key IN ('chesscomUser', 'lichessUser') AND json_type(value) = 'text' AND json_extract(value, '$') <> '';
DELETE FROM settings WHERE key IN ('chesscomUser', 'lichessUser');
DROP VIEW rated_games;
CREATE VIEW rated_games AS SELECT * FROM games WHERE mode = 'rated';
"#];

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // Off while migrating, so rebuilding a table (drop + rename) doesn't cascade deletes.
        conn.pragma_update(None, "foreign_keys", false)?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (i + 1) as i64)?;
            tx.commit()?;
        }
        conn.pragma_update(None, "foreign_keys", true)?;
        if let Some(dir) = path.parent() {
            crate::puzzles::attach(&conn, dir)?;
        }
        Ok(Self(Mutex::new(conn)))
    }

    pub fn setting(&self, key: &str) -> Option<serde_json::Value> {
        let conn = self.0.lock().unwrap();
        let raw: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        raw.and_then(|v| serde_json::from_str(&v).ok())
    }
}

#[tauri::command]
pub fn db_get_settings(db: State<Db>) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    let mut out = serde_json::Map::new();
    for row in rows {
        let (key, value) = row.map_err(err)?;
        out.insert(key, serde_json::from_str(&value).unwrap_or(serde_json::Value::Null));
    }
    Ok(out)
}

/// A null value deletes the setting (back to the default).
#[tauri::command]
pub fn db_set_setting(db: State<Db>, key: String, value: serde_json::Value) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    if value.is_null() {
        conn.execute("DELETE FROM settings WHERE key = ?1", [key]).map_err(err)?;
    } else {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value.to_string()],
        )
        .map_err(err)?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGame {
    start_fen: String,
    student_color: String,
    opponent: Option<String>,
    mode: String,
    time_control: Option<String>,
    #[serde(default)]
    opening_focus: Vec<String>,
}

/// Fields left as None are unchanged. Setting `result` also stamps `ended_at`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePatch {
    coach_session_id: Option<String>,
    result: Option<String>,
    termination: Option<String>,
    mode: Option<String>,
    takebacks: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRow {
    pub(crate) ply: i64,
    pub(crate) san: String,
    pub(crate) uci: String,
    pub(crate) fen_before: String,
    pub(crate) fen_after: String,
    pub(crate) by_student: bool,
    #[serde(default)]
    pub(crate) clock_ms: Option<i64>,
    /// Read-only here; written by `stats::db_save_analysis`.
    #[serde(default, skip_deserializing)]
    pub(crate) analysis: Option<MoveAnalysis>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MoveAnalysis {
    pub eval_before: Option<i64>,
    pub eval_after: Option<i64>,
    pub cp_loss: Option<i64>,
    pub best_uci: Option<String>,
    pub class: String,
    pub label: Option<String>,
    pub phase: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TangentRow {
    id: String,
    parent_id: Option<String>,
    title: String,
    author: String,
    start_fen: String,
    sans: Vec<String>,
    notes: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRow {
    id: String,
    seq: i64,
    kind: String,
    data: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSummary {
    pub(crate) id: i64,
    started_at: String,
    updated_at: String,
    ended_at: Option<String>,
    start_fen: String,
    student_color: String,
    opponent: Option<String>,
    result: Option<String>,
    termination: Option<String>,
    coach_session_id: Option<String>,
    mode: String,
    takebacks: i64,
    time_control: Option<String>,
    analyzed: bool,
    opening_name: Option<String>,
    opening_focus: Option<Vec<String>>,
    plies: i64,
    opening: String,
    rating_before: Option<i64>,
    rating_after: Option<i64>,
    /// Imported games: where from, and who the student played.
    source: Option<String>,
    url: Option<String>,
    opponent_name: Option<String>,
    opponent_rating: Option<i64>,
    student_rating: Option<i64>,
    speed: Option<String>,
}

#[derive(Serialize)]
pub struct GameRecord {
    game: GameSummary,
    moves: Vec<MoveRow>,
    tangents: Vec<TangentRow>,
    chat: Vec<ChatRow>,
}

const SUMMARY_SQL: &str = "
    SELECT g.id, g.started_at, g.updated_at, g.ended_at, g.start_fen, g.student_color, g.opponent,
           g.result, g.termination, g.coach_session_id, g.mode, g.takebacks, g.time_control,
           g.analyzed_at IS NOT NULL, g.opening_name, g.opening_focus,
           (SELECT count(*) FROM moves m WHERE m.game_id = g.id),
           (SELECT coalesce(group_concat(san, ' '), '')
              FROM (SELECT san FROM moves m WHERE m.game_id = g.id ORDER BY ply LIMIT 10)),
           g.rating_before, g.rating_after,
           g.source, g.url, g.opponent_name, g.opponent_rating, g.student_rating, g.speed
    FROM games g";

fn summary(r: &Row) -> rusqlite::Result<GameSummary> {
    Ok(GameSummary {
        id: r.get(0)?,
        started_at: r.get(1)?,
        updated_at: r.get(2)?,
        ended_at: r.get(3)?,
        start_fen: r.get(4)?,
        student_color: r.get(5)?,
        opponent: r.get(6)?,
        result: r.get(7)?,
        termination: r.get(8)?,
        coach_session_id: r.get(9)?,
        mode: r.get(10)?,
        takebacks: r.get(11)?,
        time_control: r.get(12)?,
        analyzed: r.get(13)?,
        opening_name: r.get(14)?,
        opening_focus: r.get::<_, Option<String>>(15)?.and_then(|f| serde_json::from_str(&f).ok()),
        plies: r.get(16)?,
        opening: r.get(17)?,
        rating_before: r.get(18)?,
        rating_after: r.get(19)?,
        source: r.get(20)?,
        url: r.get(21)?,
        opponent_name: r.get(22)?,
        opponent_rating: r.get(23)?,
        student_rating: r.get(24)?,
        speed: r.get(25)?,
    })
}

pub(crate) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn db_create_game(db: State<Db>, game: NewGame) -> Result<i64, String> {
    if game.mode == "rated" && (game.opponent.is_none() || game.student_color == "both") {
        return Err("a rated game needs an opponent".into());
    }
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO games (start_fen, student_color, opponent, mode, time_control, opening_focus)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            game.start_fen,
            game.student_color,
            game.opponent,
            game.mode,
            game.time_control,
            (!game.opening_focus.is_empty()).then(|| serde_json::to_string(&game.opening_focus).unwrap_or_default()),
        ],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn db_update_game(db: State<Db>, id: i64, patch: GamePatch) -> Result<(), String> {
    update_game(&mut db.0.lock().unwrap(), id, patch)
}

fn update_game(conn: &mut Connection, id: i64, patch: GamePatch) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    let was_over: bool = tx
        .query_row("SELECT result IS NOT NULL FROM games WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(err)?
        .ok_or_else(|| format!("game {id} no longer exists"))?;
    tx.execute(
        "UPDATE games SET
            coach_session_id = coalesce(?2, coach_session_id),
            result           = coalesce(?3, result),
            termination      = coalesce(?4, termination),
            mode             = coalesce(?5, mode),
            takebacks        = coalesce(?6, takebacks),
            ended_at         = CASE WHEN ?3 IS NOT NULL THEN datetime('now') ELSE ended_at END,
            updated_at       = datetime('now')
         WHERE id = ?1",
        params![id, patch.coach_session_id, patch.result, patch.termination, patch.mode, patch.takebacks],
    )
    .map_err(err)?;
    // Rated once, when the result first arrives: a second device saving the same result
    // (both saw the game end) finds it already over.
    if !was_over && patch.result.is_some() {
        rate_game(&tx, id)?;
    }
    tx.commit().map_err(err)
}

/// Where a player's rating starts until they set their own (Settings), chess.com scale.
pub const START_RATING: i64 = 1200;

/// The student's game rating (the `playerRating` setting, chess.com scale) and how many rated
/// games have changed it.
pub fn player_rating(conn: &Connection) -> Result<(i64, i64), String> {
    let rating = conn
        .query_row("SELECT value FROM settings WHERE key = 'playerRating'", [], |r| r.get::<_, String>(0))
        .optional()
        .map_err(err)?
        .and_then(|v| v.parse::<f64>().ok())
        .map_or(START_RATING, |v| v.round() as i64);
    let games = conn
        .query_row("SELECT count(*) FROM games WHERE rating_after IS NOT NULL", [], |r| r.get(0))
        .map_err(err)?;
    Ok((rating, games))
}

/// Elo against the opponent's rating (the bot's chess.com-scale strength), stored on the game and
/// in the setting. Mirrors `eloChange` in src/rating.ts, which previews it before a game.
fn rate_game(conn: &Connection, id: i64) -> Result<(), String> {
    let (mode, color, opponent, result): (String, String, Option<String>, Option<String>) = conn
        .query_row("SELECT mode, student_color, opponent, result FROM games WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(err)?;
    // Only "stockfish-cc:" keys are on the chess.com scale (older "stockfish:" games never get here).
    let opp = opponent.as_deref().and_then(|o| o.strip_prefix("stockfish-cc:")).and_then(|r| r.parse::<i64>().ok());
    let (Some(opp), Some(result)) = (opp, result) else { return Ok(()) };
    if mode != "rated" || color == "both" {
        return Ok(());
    }
    let score = match (result.as_str(), color.as_str()) {
        ("1/2-1/2", _) => 0.5,
        ("1-0", "white") | ("0-1", "black") => 1.0,
        _ => 0.0,
    };
    let (before, games) = player_rating(conn)?;
    let after = before + elo_change(before, opp, score, games);
    conn.execute("UPDATE games SET rating_before = ?2, rating_after = ?3 WHERE id = ?1", params![id, before, after])
        .map_err(err)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('playerRating', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [after.to_string()],
    )
    .map_err(err)?;
    Ok(())
}

/// Bigger steps for the first games, so a rating that was set wrong settles quickly.
fn elo_change(player: i64, opponent: i64, score: f64, games_so_far: i64) -> i64 {
    let expected = 1.0 / (1.0 + 10f64.powf((opponent - player) as f64 / 400.0));
    let k = if games_so_far < 10 { 32.0 } else { 16.0 };
    (k * (score - expected)).round() as i64
}

/// For the games menu and the new-game dialog: the rating, how many games it rests on, and the
/// rating after each of the last 100 rated games (oldest first), each with the one before it.
#[tauri::command]
pub fn db_player_rating(db: State<Db>) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().unwrap();
    let (rating, games) = player_rating(&conn)?;
    let history = conn
        .prepare(
            "SELECT rating_before, rating_after FROM
                (SELECT rating_before, rating_after, ended_at, id FROM games WHERE rating_after IS NOT NULL
                 ORDER BY ended_at DESC, id DESC LIMIT 100)
             ORDER BY ended_at, id",
        )
        .map_err(err)?
        .query_map([], |r| Ok([r.get::<_, i64>(0)?, r.get::<_, i64>(1)?]))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let set = conn
        .query_row("SELECT 1 FROM settings WHERE key = 'playerRating'", [], |_| Ok(()))
        .optional()
        .map_err(err)?
        .is_some();
    Ok(serde_json::json!({ "rating": rating, "games": games, "set": set, "history": history }))
}

/// Makes the stored move list match `moves` (takebacks truncate it). A move's analysis survives
/// only while that ply still holds the same move from the same position.
#[tauri::command]
pub fn db_set_moves(db: State<Db>, game_id: i64, moves: Vec<MoveRow>) -> Result<(), String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM moves WHERE game_id = ?1 AND ply > ?2", params![game_id, moves.len() as i64])
        .map_err(err)?;
    {
        let same = "(moves.uci = excluded.uci AND moves.fen_before = excluded.fen_before)";
        let mut insert = tx
            .prepare(&format!(
                "INSERT INTO moves (game_id, ply, san, uci, fen_before, fen_after, by_student, clock_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT (game_id, ply) DO UPDATE SET
                    eval_before = CASE WHEN {same} THEN eval_before END,
                    eval_after  = CASE WHEN {same} THEN eval_after END,
                    cp_loss     = CASE WHEN {same} THEN cp_loss END,
                    best_uci    = CASE WHEN {same} THEN best_uci END,
                    class       = CASE WHEN {same} THEN class END,
                    label       = CASE WHEN {same} THEN label END,
                    phase       = CASE WHEN {same} THEN phase END,
                    tags        = CASE WHEN {same} THEN tags END,
                    san = excluded.san, uci = excluded.uci, fen_before = excluded.fen_before,
                    fen_after = excluded.fen_after, by_student = excluded.by_student,
                    clock_ms = excluded.clock_ms"
            ))
            .map_err(err)?;
        for m in &moves {
            insert
                .execute(params![game_id, m.ply, m.san, m.uci, m.fen_before, m.fen_after, m.by_student, m.clock_ms])
                .map_err(err)?;
        }
    }
    tx.execute("UPDATE games SET updated_at = datetime('now') WHERE id = ?1", [game_id])
        .map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn db_upsert_tangent(db: State<Db>, game_id: i64, tangent: TangentRow) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute(
            "INSERT INTO tangents (id, game_id, parent_id, title, author, start_fen, sans, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, sans = excluded.sans, notes = excluded.notes",
            params![
                tangent.id,
                game_id,
                tangent.parent_id,
                tangent.title,
                tangent.author,
                tangent.start_fen,
                serde_json::to_string(&tangent.sans).map_err(err)?,
                serde_json::to_string(&tangent.notes).map_err(err)?,
            ],
        )
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub fn db_upsert_chat(db: State<Db>, game_id: i64, item: ChatRow) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute(
            "INSERT INTO chat_items (id, game_id, seq, kind, data) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            params![item.id, game_id, item.seq, item.kind, item.data.to_string()],
        )
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub fn db_list_games(db: State<Db>, limit: Option<i64>) -> Result<Vec<GameSummary>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!("{SUMMARY_SQL} ORDER BY g.updated_at DESC, g.id DESC LIMIT ?1"))
        .map_err(err)?;
    let rows = stmt
        .query_map([limit.unwrap_or(100)], summary)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn db_load_game(db: State<Db>, id: i64) -> Result<Option<GameRecord>, String> {
    let conn = db.0.lock().unwrap();
    let Some(game) = conn
        .query_row(&format!("{SUMMARY_SQL} WHERE g.id = ?1"), [id], summary)
        .optional()
        .map_err(err)?
    else {
        return Ok(None);
    };

    let moves = conn
        .prepare(
            "SELECT ply, san, uci, fen_before, fen_after, by_student, clock_ms,
                    eval_after, cp_loss, best_uci, class, phase, tags, eval_before, label
             FROM moves WHERE game_id = ?1 ORDER BY ply",
        )
        .map_err(err)?
        .query_map([id], |r| {
            Ok(MoveRow {
                ply: r.get(0)?,
                san: r.get(1)?,
                uci: r.get(2)?,
                fen_before: r.get(3)?,
                fen_after: r.get(4)?,
                by_student: r.get(5)?,
                clock_ms: r.get(6)?,
                analysis: match r.get::<_, Option<String>>(10)? {
                    None => None,
                    Some(class) => Some(MoveAnalysis {
                        eval_before: r.get(13)?,
                        eval_after: r.get(7)?,
                        cp_loss: r.get(8)?,
                        best_uci: r.get(9)?,
                        class,
                        label: r.get(14)?,
                        phase: r.get(11)?,
                        tags: r
                            .get::<_, Option<String>>(12)?
                            .and_then(|t| serde_json::from_str(&t).ok())
                            .unwrap_or_default(),
                    }),
                },
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let tangents = conn
        .prepare(
            "SELECT id, parent_id, title, author, start_fen, sans, notes FROM tangents
             WHERE game_id = ?1 ORDER BY created_at, rowid",
        )
        .map_err(err)?
        .query_map([id], |r| {
            let sans: String = r.get(5)?;
            let notes: String = r.get(6)?;
            Ok(TangentRow {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                title: r.get(2)?,
                author: r.get(3)?,
                start_fen: r.get(4)?,
                sans: serde_json::from_str(&sans).unwrap_or_default(),
                notes: serde_json::from_str(&notes).unwrap_or_default(),
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let chat = conn
        .prepare("SELECT id, seq, kind, data FROM chat_items WHERE game_id = ?1 ORDER BY seq")
        .map_err(err)?
        .query_map([id], |r| {
            let data: String = r.get(3)?;
            Ok(ChatRow {
                id: r.get(0)?,
                seq: r.get(1)?,
                kind: r.get(2)?,
                data: serde_json::from_str(&data).unwrap_or(serde_json::Value::Null),
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    Ok(Some(GameRecord { game, moves, tangents, chat }))
}

/// Deletes a game and (via ON DELETE CASCADE) its moves, tangents and chat.
#[tauri::command]
pub fn db_delete_game(db: State<Db>, id: i64) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute("DELETE FROM games WHERE id = ?1", [id])
        .map(|_| ())
        .map_err(err)
}

/// Deletes games the student never took part in: no move of theirs and nothing said to the
/// coach. `keep` spares the game currently open. Returns how many were deleted.
///
/// Games touched in the last half hour are spared too: one may have just been started on the
/// other device (phone or desktop), where the student hasn't moved yet. Deleting it there left
/// that device playing into a game the database no longer had, and nothing it did was saved.
#[tauri::command]
pub fn db_prune_empty_games(db: State<Db>, keep: Option<i64>) -> Result<usize, String> {
    db.0.lock()
        .unwrap()
        .execute(
            "DELETE FROM games
             WHERE id IS NOT ?1
               AND updated_at < datetime('now', '-30 minutes')
               AND NOT EXISTS (SELECT 1 FROM moves m WHERE m.game_id = games.id AND m.by_student = 1)
               AND NOT EXISTS (SELECT 1 FROM chat_items c WHERE c.game_id = games.id AND c.kind = 'user')",
            [keep],
        )
        .map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finish(conn: &mut Connection, id: i64, result: &str) {
        let patch = GamePatch { coach_session_id: None, result: Some(result.into()), termination: Some("checkmate".into()), mode: None, takebacks: None };
        update_game(conn, id, patch).unwrap();
    }

    fn game(conn: &Connection, mode: &str, color: &str, opponent: &str) -> i64 {
        conn.execute(
            "INSERT INTO games (start_fen, student_color, opponent, mode) VALUES ('x', ?1, ?2, ?3)",
            params![color, opponent, mode],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn rated_games_move_the_rating_once() {
        let path = std::env::temp_dir().join(format!("cc-rating-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        let mut conn = db.conn();
        assert_eq!(player_rating(&conn).unwrap(), (START_RATING, 0));

        // A win against an equal bot: +16 while the rating is new.
        let g = game(&conn, "rated", "white", "stockfish-cc:1200");
        finish(&mut conn, g, "1-0");
        assert_eq!(player_rating(&conn).unwrap(), (1216, 1));
        // The same result saved again (a second device) changes nothing.
        finish(&mut conn, g, "1-0");
        assert_eq!(player_rating(&conn).unwrap(), (1216, 1));

        // Practice games don't count.
        let p = game(&conn, "practice", "black", "stockfish-cc:1800");
        finish(&mut conn, p, "0-1");
        assert_eq!(player_rating(&conn).unwrap(), (1216, 1));

        // A set rating is the starting point; a loss as Black to a much weaker bot costs a lot.
        conn.execute("UPDATE settings SET value = '1500' WHERE key = 'playerRating'", []).unwrap();
        let l = game(&conn, "rated", "black", "stockfish-cc:1100");
        finish(&mut conn, l, "1-0");
        let (before, after): (i64, i64) =
            conn.query_row("SELECT rating_before, rating_after FROM games WHERE id = ?1", [l], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((before, after), (1500, 1500 - 29));
        assert_eq!(elo_change(1500, 1500, 0.5, 20), 0);
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
