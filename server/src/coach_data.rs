//! The coach's read-only window on the student's data (`query_data`): one SELECT at a time over the
//! app's database, with the puzzle file attached as `pz`. It runs on a connection of its own opened
//! read-only, so nothing the coach writes can reach the student's games, whatever the SQL says.

use std::time::Duration;

use rusqlite::functions::FunctionFlags;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};
use crate::ctx::State;

use crate::db::Db;

/// Rows returned at most; the coach is told when there were more.
const MAX_ROWS: usize = 200;
/// Long text (FENs are fine; chat JSON, lessons) is cut so one cell can't swamp the answer.
const MAX_TEXT: usize = 1500;
/// A runaway query (a cross join over the moves) is interrupted after this.
const TIMEOUT: Duration = Duration::from_secs(10);

/// chess.com rapid next to the Lichess rating of about the same strength: `LICHESS_SCALE` in src/rating.ts.
const LICHESS_SCALE: [(f64, f64); 5] = [(400.0, 900.0), (1000.0, 1400.0), (1500.0, 1750.0), (2000.0, 2100.0), (2500.0, 2500.0)];

/// A Lichess rating on the chess.com scale (`fromLichess` in src/rating.ts), as SQL's `chesscom(x)`.
fn from_lichess(lichess: f64) -> i64 {
    let s = LICHESS_SCALE;
    let mut i = 1;
    while i < s.len() - 1 && lichess > s[i].1 {
        i += 1;
    }
    let (a, b) = (s[i - 1], s[i]);
    (a.0 + (lichess - a.1) / (b.1 - a.1) * (b.0 - a.0)).round() as i64
}

fn open(main: &str) -> Result<Connection, String> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(main, flags).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "query_only", true).map_err(|e| e.to_string())?;
    if let Some(dir) = std::path::Path::new(main).parent() {
        let pz = dir.join(crate::puzzles::FILE);
        if pz.exists() {
            // A read-only connection attaches read-only too.
            let _ = conn.execute("ATTACH DATABASE ?1 AS pz", [pz.to_string_lossy()]);
        }
    }
    conn.create_scalar_function("chesscom", 1, FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC, |ctx| {
        Ok(ctx.get::<Option<f64>>(0)?.map(from_lichess))
    })
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn cell(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => {
            let s = String::from_utf8_lossy(t);
            if s.chars().count() > MAX_TEXT {
                json!(format!("{}… ({} chars)", s.chars().take(MAX_TEXT).collect::<String>(), s.chars().count()))
            } else {
                json!(s)
            }
        }
        ValueRef::Blob(b) => json!(format!("<blob, {} bytes>", b.len())),
    }
}

/// Every table and view with its CREATE statement, the main database's and the puzzle file's.
fn schema(conn: &Connection) -> Result<Value, String> {
    let mut out = Vec::new();
    for db in ["main", "pz"] {
        let sql = format!("SELECT type, name, sql FROM {db}.sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
        let Ok(mut stmt) = conn.prepare(&sql) else { continue };
        let rows = stmt
            .query_map([], |r| {
                let name: String = r.get(1)?;
                Ok(json!({ "type": r.get::<_, String>(0)?, "name": if db == "main" { name } else { format!("pz.{name}") }, "sql": r.get::<_, Option<String>>(2)? }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(json!({ "tables": out }))
}

fn run(conn: &Connection, sql: &str) -> Result<Value, String> {
    // prepare compiles one statement and refuses a second after it.
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    if !stmt.readonly() {
        return Err("Only reading is allowed: use a single SELECT (or WITH ... SELECT).".into());
    }
    let columns: Vec<String> = stmt.column_names().map(|c| c.to_string()).collect();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut more = false;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if out.len() == MAX_ROWS {
            more = true;
            break;
        }
        let mut obj = Map::new();
        for (i, c) in columns.iter().enumerate() {
            obj.insert(c.clone(), cell(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(Value::Object(obj));
    }
    Ok(json!({ "columns": columns, "rows": out, "truncated": more }))
}

/// `query_data`: one read-only SELECT, or the schema when `sql` is empty.
pub async fn db_coach_query(db: State<'_, Db>, sql: Option<String>) -> Result<Value, String> {
    let path = db.conn().path().map(str::to_string).ok_or("the database has no file")?;
    tokio::task::spawn_blocking(move || {
        let conn = open(&path)?;
        let sql = sql.unwrap_or_default();
        if sql.trim().is_empty() {
            return schema(&conn);
        }
        let handle = conn.get_interrupt_handle();
        let (done, wait) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            if wait.recv_timeout(TIMEOUT).is_err() {
                handle.interrupt();
            }
        });
        let result = run(&conn, &sql);
        let _ = done.send(());
        result.map_err(|e| if e.contains("interrupted") { format!("The query took over {}s and was stopped: narrow it down.", TIMEOUT.as_secs()) } else { e })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lichess_scale_matches_rating_ts() {
        assert_eq!(from_lichess(1400.0), 1000);
        assert_eq!(from_lichess(1750.0), 1500);
        assert_eq!(from_lichess(900.0), 400);
        assert_eq!(from_lichess(1575.0), 1250);
    }

    #[test]
    fn writes_are_refused() {
        let dir = std::env::temp_dir().join(format!("cc-coach-data-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("t.db");
        let _ = std::fs::remove_file(&file);
        Connection::open(&file).unwrap().execute_batch("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);").unwrap();
        let conn = open(file.to_str().unwrap()).unwrap();
        assert!(run(&conn, "DELETE FROM t").is_err());
        assert!(run(&conn, "SELECT 1; DELETE FROM t").is_err());
        assert!(run(&conn, "INSERT INTO t VALUES (2)").is_err());
        let ok = run(&conn, "SELECT x, chesscom(1750) AS r FROM t").unwrap();
        assert_eq!(ok["rows"][0]["x"], 1);
        assert_eq!(ok["rows"][0]["r"], 1500);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
