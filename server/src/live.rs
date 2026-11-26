//! What's in progress right now, shared by every device (docs/server-migration.md, phase 3): one
//! record per activity kind (game, puzzle, drill, opening, endgame, guess, plan, trainer chat).
//! A device sends its session's state after every step; the server keeps it, numbers it, and
//! tells the other devices (`live-changed`), which mirror it. An update made from an older version
//! than the server's is refused and answered with the current record, so two devices acting at
//! once can't split the board: the slower one takes the server's state.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ctx::AppHandle;
use crate::db::Db;

/// Kept in the database so it survives a restart of the server.
pub const LIVE_TABLE: &str = r#"
CREATE TABLE live (
    kind    TEXT PRIMARY KEY,              -- 'game', 'puzzle', 'drill', 'opening', ...
    id      TEXT,                          -- what the session is about (game id, puzzle id, ...)
    state   TEXT NOT NULL,                 -- the session store's snapshot, JSON
    version INTEGER NOT NULL,
    device  TEXT NOT NULL,                 -- client id of the last change
    at      INTEGER NOT NULL               -- server time of the last change, ms
);
"#;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub kind: String,
    pub id: Option<String>,
    /// None once the session ended (the record is gone).
    pub state: Option<Value>,
    pub version: i64,
    pub device: String,
    pub at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub ok: bool,
    /// After a refused update: what the server has, for the device to take.
    pub current: Option<Record>,
    pub version: i64,
    pub at: i64,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn read(conn: &rusqlite::Connection, kind: &str) -> Result<Option<Record>, String> {
    use rusqlite::OptionalExtension;
    conn.query_row("SELECT kind, id, state, version, device, at FROM live WHERE kind = ?1", [kind], |r| {
        let state: String = r.get(2)?;
        Ok(Record {
            kind: r.get(0)?,
            id: r.get(1)?,
            state: serde_json::from_str::<Value>(&state).ok().filter(|v| !v.is_null()),
            version: r.get(3)?,
            device: r.get(4)?,
            at: r.get(5)?,
        })
    })
    .optional()
    .map_err(|e| e.to_string())
}

/// Every session in progress, for a device that just opened (the home screen's "Continue").
pub fn live_get(db: &Db) -> Result<Vec<Record>, String> {
    let conn = db.conn();
    let mut stmt = conn.prepare("SELECT kind FROM live ORDER BY at DESC").map_err(|e| e.to_string())?;
    let kinds: Vec<String> = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    let all: Result<Vec<_>, _> = kinds.iter().filter_map(|k| read(&conn, k).transpose()).collect();
    Ok(all?.into_iter().filter(|r| r.state.is_some()).collect())
}

/// Saves `state` as the new live state of `kind` if `base` is the version the device started from
/// (0 or None: it started a new session, which always wins, like pressing "New game" does).
/// `state: None` ends the session.
/// The version a fresh start builds on is the stored one, so it never repeats an old number.
pub fn live_update(
    app: &AppHandle,
    client: &str,
    kind: &str,
    id: Option<String>,
    state: Option<Value>,
    base: Option<i64>,
) -> Result<Outcome, String> {
    let db = app.state::<Db>();
    let at = now_ms();
    let record = {
        let conn = db.conn();
        let current = read(&conn, kind)?;
        let version = current.as_ref().map_or(0, |c| c.version);
        let fresh = base.is_none_or(|b| b == 0);
        if !fresh && base != Some(version) {
            return Ok(Outcome { ok: false, version, at: current.as_ref().map_or(at, |c| c.at), current });
        }
        let record = Record { kind: kind.into(), id, state, version: version + 1, device: client.into(), at };
        // An ended session keeps its row (state null), so versions never repeat for a kind.
        let json = record.state.as_ref().map_or_else(|| "null".to_string(), Value::to_string);
        conn.execute(
            "INSERT INTO live (kind, id, state, version, device, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(kind) DO UPDATE SET id = ?2, state = ?3, version = ?4, device = ?5, at = ?6",
            rusqlite::params![kind, record.id, json, record.version, client, at],
        )
        .map_err(|e| e.to_string())?;
        record
    };
    crate::relay::emit_all(app, "live-changed", &record);
    Ok(Outcome { ok: true, current: None, version: record.version, at })
}
