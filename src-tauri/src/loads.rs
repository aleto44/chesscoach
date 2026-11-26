//! Utility › Load game's history: every game or position the student loaded (text or a picture),
//! kept here so the computer and the phone share one list and the phone stores nothing.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{err, Db};

/// Older loads beyond this are dropped.
const KEEP: i64 = 50;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadEntry {
    id: i64,
    /// Last loaded or opened, unix ms.
    at: i64,
    kind: String,
    title: String,
    start_fen: String,
    sans: Vec<String>,
    orientation: String,
    /// A small copy of the picture for the list (the full one comes from `db_load_image`).
    thumb: Option<String>,
    has_image: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLoad {
    kind: String,
    title: String,
    start_fen: String,
    sans: Vec<String>,
    orientation: String,
    thumb: Option<String>,
    image: Option<String>,
}

/// Now in unix ms, but always after the newest entry, so the order holds within one millisecond.
fn next_at(conn: &Connection) -> Result<i64, String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let last: i64 = conn.query_row("SELECT COALESCE(MAX(at), 0) FROM loads", [], |r| r.get(0)).map_err(err)?;
    Ok(now.max(last + 1))
}

pub(crate) fn list(conn: &Connection, limit: i64) -> Result<Vec<LoadEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, at, kind, title, start_fen, sans, orientation, thumb, image IS NOT NULL
             FROM loads ORDER BY at DESC, id DESC LIMIT ?1",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(LoadEntry {
                id: r.get(0)?,
                at: r.get(1)?,
                kind: r.get(2)?,
                title: r.get(3)?,
                start_fen: r.get(4)?,
                sans: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
                orientation: r.get(6)?,
                thumb: r.get(7)?,
                has_image: r.get(8)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Records a load and returns its id. The same game or position loaded again moves to the top
/// (keeping its picture unless a new one came with it) instead of being listed twice.
pub(crate) fn save(conn: &Connection, l: NewLoad) -> Result<i64, String> {
    let sans = serde_json::to_string(&l.sans).map_err(err)?;
    let at = next_at(conn)?;
    let same: Option<i64> = conn
        .query_row("SELECT id FROM loads WHERE start_fen = ?1 AND sans = ?2", params![l.start_fen, sans], |r| r.get(0))
        .optional()
        .map_err(err)?;
    let id = match same {
        Some(id) => {
            conn.execute(
                "UPDATE loads SET at = ?2, kind = ?3, title = ?4, orientation = ?5,
                    thumb = COALESCE(?6, thumb), image = COALESCE(?7, image) WHERE id = ?1",
                params![id, at, l.kind, l.title, l.orientation, l.thumb, l.image],
            )
            .map_err(err)?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO loads (at, kind, title, start_fen, sans, orientation, thumb, image)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![at, l.kind, l.title, l.start_fen, sans, l.orientation, l.thumb, l.image],
            )
            .map_err(err)?;
            conn.last_insert_rowid()
        }
    };
    conn.execute(
        "DELETE FROM loads WHERE id NOT IN (SELECT id FROM loads ORDER BY at DESC, id DESC LIMIT ?1)",
        [KEEP],
    )
    .map_err(err)?;
    Ok(id)
}

#[tauri::command]
pub fn db_loads(db: State<Db>, limit: Option<i64>) -> Result<Vec<LoadEntry>, String> {
    list(&db.conn(), limit.unwrap_or(KEEP))
}

#[tauri::command]
pub fn db_save_load(db: State<Db>, load: NewLoad) -> Result<i64, String> {
    save(&db.conn(), load)
}

/// A fix made on the preview board (a misread square, the side to move, the orientation).
#[tauri::command]
pub fn db_update_load(db: State<Db>, id: i64, start_fen: String, sans: Vec<String>, orientation: String) -> Result<(), String> {
    let sans = serde_json::to_string(&sans).map_err(err)?;
    db.conn()
        .execute("UPDATE loads SET start_fen = ?2, sans = ?3, orientation = ?4 WHERE id = ?1", params![id, start_fen, sans, orientation])
        .map_err(err)?;
    Ok(())
}

/// Opening an entry again moves it to the top; returns its full picture, if it has one.
#[tauri::command]
pub fn db_open_load(db: State<Db>, id: i64) -> Result<Option<String>, String> {
    let conn = db.conn();
    let at = next_at(&conn)?;
    conn.execute("UPDATE loads SET at = ?2 WHERE id = ?1", params![id, at]).map_err(err)?;
    conn.query_row("SELECT image FROM loads WHERE id = ?1", [id], |r| r.get(0)).optional().map(Option::flatten).map_err(err)
}

/// One entry, or all of them with no id.
#[tauri::command]
pub fn db_remove_load(db: State<Db>, id: Option<i64>) -> Result<(), String> {
    let conn = db.conn();
    match id {
        Some(id) => conn.execute("DELETE FROM loads WHERE id = ?1", [id]),
        None => conn.execute("DELETE FROM loads", []),
    }
    .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(LOADS_TABLE).unwrap();
        c
    }

    fn load(fen: &str, sans: &[&str], image: Option<&str>) -> NewLoad {
        NewLoad {
            kind: "PGN".into(),
            title: "t".into(),
            start_fen: fen.into(),
            sans: sans.iter().map(|s| s.to_string()).collect(),
            orientation: "white".into(),
            thumb: image.map(str::to_string),
            image: image.map(str::to_string),
        }
    }

    #[test]
    fn same_load_moves_up_and_keeps_its_picture() {
        let c = conn();
        let a = save(&c, load("x", &["e4"], Some("pic"))).unwrap();
        let b = save(&c, load("x", &["d4"], None)).unwrap();
        assert_ne!(a, b);
        assert_eq!(save(&c, load("x", &["e4"], None)).unwrap(), a);
        let l = list(&c, 10).unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].id, a);
        assert!(l[0].has_image);
        assert_eq!(l[0].sans, vec!["e4"]);
    }

    #[test]
    fn keeps_the_newest() {
        let c = conn();
        for i in 0..KEEP + 5 {
            save(&c, load(&format!("f{i}"), &[], None)).unwrap();
        }
        assert_eq!(list(&c, 1000).unwrap().len() as i64, KEEP);
    }
}

/// The table, as its migration in db.rs creates it (here too for the tests).
pub(crate) const LOADS_TABLE: &str = "
CREATE TABLE loads (
    id          INTEGER PRIMARY KEY,
    at          INTEGER NOT NULL,            -- unix ms, last loaded or opened
    kind        TEXT NOT NULL,               -- 'FEN' | 'PGN' | 'Moves' | 'Image'
    title       TEXT NOT NULL,
    start_fen   TEXT NOT NULL,
    sans        TEXT NOT NULL,               -- JSON array of SAN moves from start_fen
    orientation TEXT NOT NULL,               -- 'white' | 'black'
    thumb       TEXT,                        -- small JPEG data URL of the picture, for the list
    image       TEXT                         -- the picture as read, to compare against the board
);
CREATE INDEX loads_at ON loads(at);
";
