//! SQLite storage: games and their moves, plus the tangents and chat that belong to each game.
//! Eval / cp-loss columns on `moves` are filled in later by game analysis (review mode).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

pub struct Db(Mutex<Connection>);

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
"#];

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", true)?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (i + 1) as i64)?;
            tx.commit()?;
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
    ply: i64,
    san: String,
    uci: String,
    fen_before: String,
    fen_after: String,
    by_student: bool,
    #[serde(default)]
    clock_ms: Option<i64>,
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
    id: i64,
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
    plies: i64,
    opening: String,
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
           (SELECT count(*) FROM moves m WHERE m.game_id = g.id),
           (SELECT coalesce(group_concat(san, ' '), '')
              FROM (SELECT san FROM moves m WHERE m.game_id = g.id ORDER BY ply LIMIT 10))
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
        plies: r.get(13)?,
        opening: r.get(14)?,
    })
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn db_create_game(db: State<Db>, game: NewGame) -> Result<i64, String> {
    if game.mode == "rated" && (game.opponent.is_none() || game.student_color == "both") {
        return Err("a rated game needs an opponent".into());
    }
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO games (start_fen, student_color, opponent, mode, time_control) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![game.start_fen, game.student_color, game.opponent, game.mode, game.time_control],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn db_update_game(db: State<Db>, id: i64, patch: GamePatch) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute(
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
        .map(|_| ())
        .map_err(err)
}

/// Replaces the game's whole move list (takebacks truncate it, so this is the simplest truth).
#[tauri::command]
pub fn db_set_moves(db: State<Db>, game_id: i64, moves: Vec<MoveRow>) -> Result<(), String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM moves WHERE game_id = ?1", [game_id]).map_err(err)?;
    {
        let mut insert = tx
            .prepare(
                "INSERT INTO moves (game_id, ply, san, uci, fen_before, fen_after, by_student, clock_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
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
            "SELECT ply, san, uci, fen_before, fen_after, by_student, clock_ms FROM moves
             WHERE game_id = ?1 ORDER BY ply",
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
#[tauri::command]
pub fn db_prune_empty_games(db: State<Db>, keep: Option<i64>) -> Result<usize, String> {
    db.0.lock()
        .unwrap()
        .execute(
            "DELETE FROM games
             WHERE id IS NOT ?1
               AND NOT EXISTS (SELECT 1 FROM moves m WHERE m.game_id = games.id AND m.by_student = 1)
               AND NOT EXISTS (SELECT 1 FROM chat_items c WHERE c.game_id = games.id AND c.kind = 'user')",
            [keep],
        )
        .map_err(err)
}
