//! Lichess puzzles (database.lichess.org, CC0). Downloaded once into their own SQLite file, which
//! is attached to the main connection as `pz`. The student's attempts live in the main database
//! (`puzzle_attempts`), so downloading a newer puzzle set never loses them.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::db::Db;
use crate::relay;

const URL: &str = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
pub const FILE: &str = "puzzles.db";

// Of the ~6M puzzles, keep the ones with a settled rating that players liked: roughly 1.45M (a 400 MB file).
const MAX_RD: i64 = 80;
const MIN_POPULARITY: i64 = 85;
const MIN_PLAYS: i64 = 1000;

/// Tags that say how long or how winning a puzzle is, not what it's about. Kept in `themes` but
/// not indexed, which keeps the tag table a third smaller.
const UNINDEXED: &[&str] = &["short", "long", "veryLong", "oneMove", "crushing", "advantage", "equality"];

const SCHEMA: &str = r#"
CREATE TABLE puzzles (
    id         INTEGER PRIMARY KEY,
    lichess_id TEXT NOT NULL,
    fen        TEXT NOT NULL,              -- before the opponent's move
    moves      TEXT NOT NULL,              -- UCI, space-separated; the first is the opponent's
    rating     INTEGER NOT NULL,
    plays      INTEGER NOT NULL,
    themes     TEXT NOT NULL,              -- space-separated Lichess themes
    openings   TEXT NOT NULL,              -- space-separated Lichess opening tags (family first)
    game       TEXT NOT NULL               -- the source game's path on lichess.org, e.g. 'game/787zsVup/black#48'
);
-- Themes and opening tags (only set for puzzles before move 20), for filtering by tag and rating.
CREATE TABLE puzzle_tags (
    tag    TEXT NOT NULL,
    rating INTEGER NOT NULL,
    puzzle INTEGER NOT NULL,
    PRIMARY KEY (tag, rating, puzzle)
) WITHOUT ROWID;
-- kind: 'theme' | 'family' (an opening, e.g. Caro-Kann_Defense) | 'variation'.
CREATE TABLE tag_counts (tag TEXT PRIMARY KEY, kind TEXT NOT NULL, count INTEGER NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"#;

/// Attaches the puzzle file if it has been downloaded. Safe to call again after a new download.
pub fn attach(conn: &Connection, dir: &Path) -> rusqlite::Result<bool> {
    let _ = conn.execute_batch("DETACH DATABASE pz");
    let path = dir.join(FILE);
    if !path.exists() {
        return Ok(false);
    }
    conn.execute("ATTACH DATABASE ?1 AS pz", [path.to_string_lossy()])?;
    Ok(true)
}

fn attached(conn: &Connection) -> bool {
    conn.query_row("SELECT 1 FROM pragma_database_list WHERE name = 'pz'", [], |_| Ok(()))
        .is_ok()
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---- Download ----

#[derive(Default)]
pub struct Import {
    running: AtomicBool,
    cancel: Arc<AtomicBool>,
    /// The latest progress, for a phone that opens the puzzle screen mid-download.
    last: Mutex<Option<Progress>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// 'download' | 'index' | 'done' | 'error' | 'cancelled'
    phase: &'static str,
    /// Compressed bytes read so far, of `total`.
    done: u64,
    total: u64,
    kept: u64,
    error: Option<String>,
}

/// Counts the compressed bytes as they come off the network, for the progress bar.
struct Counting<R> {
    inner: R,
    count: Arc<AtomicU64>,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

/// Streams the Lichess file into `dest` (a fresh SQLite file): decompress, filter, insert, index.
/// `progress(phase, kept)` is called every few thousand rows; returning false cancels.
pub fn build(compressed: impl Read, dest: &Path, mut progress: impl FnMut(&'static str, u64) -> bool) -> Result<u64, String> {
    let _ = std::fs::remove_file(dest);
    let mut conn = Connection::open(dest).map_err(err)?;
    conn.execute_batch("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;").map_err(err)?;
    conn.execute_batch(SCHEMA).map_err(err)?;

    let decoder = zstd::stream::read::Decoder::new(compressed).map_err(err)?;
    let mut csv = csv::Reader::from_reader(decoder);
    let mut kept = 0u64;
    let tx = conn.transaction().map_err(err)?;
    {
        let mut puzzle = tx
            .prepare(
                "INSERT INTO puzzles (lichess_id, fen, moves, rating, plays, themes, openings, game)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(err)?;
        let mut tag = tx.prepare("INSERT OR IGNORE INTO puzzle_tags (tag, rating, puzzle) VALUES (?1, ?2, ?3)").map_err(err)?;
        let mut record = csv::StringRecord::new();
        // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
        while csv.read_record(&mut record).map_err(err)? {
            let num = |i: usize| record.get(i).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
            let (rating, rd, popularity, plays) = (num(3), num(4), num(5), num(6));
            if rd > MAX_RD || popularity < MIN_POPULARITY || plays < MIN_PLAYS {
                continue;
            }
            let themes = record.get(7).unwrap_or("");
            let openings = record.get(9).unwrap_or("");
            let game = record.get(8).unwrap_or("").trim_start_matches("https://lichess.org/");
            puzzle
                .execute(params![&record[0], &record[1], &record[2], rating, plays, themes, openings, game])
                .map_err(err)?;
            let id = tx.last_insert_rowid();
            for t in themes.split(' ').chain(openings.split(' ')) {
                if !t.is_empty() && !UNINDEXED.contains(&t) {
                    tag.execute(params![t, rating, id]).map_err(err)?;
                }
            }
            kept += 1;
            if kept % 5000 == 0 && !progress("download", kept) {
                return Err("cancelled".into());
            }
        }
    }
    progress("index", kept);
    tx.execute_batch(
        "CREATE INDEX puzzles_rating ON puzzles(rating);
         CREATE INDEX puzzles_lichess ON puzzles(lichess_id);
         INSERT INTO tag_counts (tag, kind, count)
             SELECT tag, CASE WHEN tag GLOB '[a-z]*' THEN 'theme' ELSE 'variation' END, count(*)
             FROM puzzle_tags GROUP BY tag;
         UPDATE tag_counts SET kind = 'family' WHERE tag IN
             (SELECT DISTINCT substr(openings, 1, instr(openings || ' ', ' ') - 1) FROM puzzles WHERE openings != '');",
    )
    .map_err(err)?;
    tx.execute("INSERT INTO meta (key, value) VALUES ('imported_at', datetime('now')), ('count', ?1)", [kept as i64])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    conn.execute_batch("PRAGMA journal_mode = DELETE; ANALYZE;").map_err(err)?;
    Ok(kept)
}

/// Starts downloading the puzzle set in the background. Progress arrives as `puzzle-import` events.
#[tauri::command]
pub fn puzzle_import_start(app: AppHandle, import: State<Import>) -> Result<(), String> {
    if import.running.swap(true, Ordering::SeqCst) {
        return Err("already downloading".into());
    }
    import.cancel.store(false, Ordering::SeqCst);
    let cancel = import.cancel.clone();
    std::thread::spawn(move || {
        // Through the relay, so a phone that started the download sees its progress too.
        let emit = |p: Progress| {
            *app.state::<Import>().last.lock().unwrap() = Some(p.clone());
            relay::emit_all(&app, "puzzle-import", p);
        };
        let result = download(&app, &cancel, &emit);
        let state = app.state::<Import>();
        state.running.store(false, Ordering::SeqCst);
        match result {
            Ok(kept) => emit(Progress { phase: "done", done: 0, total: 0, kept, error: None }),
            Err(_) if cancel.load(Ordering::SeqCst) => {
                emit(Progress { phase: "cancelled", done: 0, total: 0, kept: 0, error: None })
            }
            Err(e) => emit(Progress { phase: "error", done: 0, total: 0, kept: 0, error: Some(e) }),
        }
    });
    Ok(())
}

fn download(app: &AppHandle, cancel: &AtomicBool, emit: &dyn Fn(Progress)) -> Result<u64, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    let part: PathBuf = dir.join(format!("{FILE}.part"));
    let response = ureq::get(URL).call().map_err(err)?;
    let total = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let count = Arc::new(AtomicU64::new(0));
    let body = Counting { inner: response.into_body().into_reader(), count: count.clone() };
    let built = build(body, &part, |phase, kept| {
        emit(Progress { phase, done: count.load(Ordering::Relaxed), total, kept, error: None });
        !cancel.load(Ordering::SeqCst)
    });
    let kept = match built {
        Ok(kept) => kept,
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
    };
    // Swap the new file in while nothing else uses the connection.
    let db = app.state::<Db>();
    let conn = db.conn();
    let _ = conn.execute_batch("DETACH DATABASE pz");
    std::fs::rename(&part, dir.join(FILE)).map_err(err)?;
    attach(&conn, &dir).map_err(err)?;
    Ok(kept)
}

/// The download's latest progress (or its last outcome), if one has run since the app started.
#[tauri::command]
pub fn puzzle_import_progress(import: State<Import>) -> Option<Value> {
    import.last.lock().unwrap().as_ref().and_then(|p| serde_json::to_value(p).ok())
}

#[tauri::command]
pub fn puzzle_import_cancel(import: State<Import>) {
    import.cancel.store(true, Ordering::SeqCst);
}

// ---- Puzzles ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Puzzle {
    id: String,
    fen: String,
    moves: Vec<String>,
    rating: i64,
    plays: i64,
    themes: Vec<String>,
    openings: Vec<String>,
    game: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    /// Any of these themes (and/or opening tags).
    #[serde(default)]
    themes: Vec<String>,
    /// An opening tag, e.g. 'Caro-Kann_Defense' or 'Caro-Kann_Defense_Advance_Variation'.
    opening: Option<String>,
    min_rating: i64,
    max_rating: i64,
    limit: i64,
    /// Lichess ids to leave out (already queued).
    #[serde(default)]
    exclude: Vec<String>,
}

/// What's downloaded, the student's puzzle rating and the tags to filter by.
#[tauri::command]
pub fn puzzle_status(db: State<Db>) -> Result<Value, String> {
    let conn = db.conn();
    let (rating, attempts) = student_rating(&conn)?;
    if !attached(&conn) {
        return Ok(json!({ "installed": false, "rating": rating, "attempts": attempts }));
    }
    let count: i64 = conn
        .query_row("SELECT CAST(value AS INTEGER) FROM pz.meta WHERE key = 'count'", [], |r| r.get(0))
        .map_err(err)?;
    let imported: String = conn
        .query_row("SELECT value FROM pz.meta WHERE key = 'imported_at'", [], |r| r.get(0))
        .map_err(err)?;
    let mut stmt = conn.prepare("SELECT tag, kind, count FROM pz.tag_counts ORDER BY count DESC").map_err(err)?;
    let tags = stmt
        .query_map([], |r| Ok(json!({ "tag": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?, "count": r.get::<_, i64>(2)? })))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(json!({ "installed": true, "count": count, "importedAt": imported, "rating": rating, "attempts": attempts, "tags": tags }))
}

/// Random unseen puzzles in the rating window matching the filter.
#[tauri::command]
pub fn puzzle_find(db: State<Db>, filter: Filter) -> Result<Vec<Puzzle>, String> {
    let conn = db.conn();
    if !attached(&conn) {
        return Err("The puzzle set isn't downloaded yet.".into());
    }
    let limit = filter.limit.clamp(1, 50);
    let exclude = serde_json::to_string(&filter.exclude).map_err(err)?;
    // Shuffle ids straight from an index (the opening's or themes' tag rows, else the rating index)
    // and only then read the rows: sorting whole rows by random() takes seconds. The pick is
    // oversampled since the rest of the filter drops some.
    let tags: Vec<String> = match (&filter.opening, filter.themes.is_empty()) {
        (Some(o), _) => vec![o.clone()],
        (None, false) => filter.themes.clone(),
        (None, true) => vec![],
    };
    // Unused clauses still mention their parameter: rusqlite wants every bound value used.
    let pick = if tags.is_empty() {
        "SELECT id FROM pz.puzzles WHERE rating BETWEEN ?1 AND ?2 AND ?5 IS NOT NULL"
    } else {
        "SELECT puzzle AS id FROM pz.puzzle_tags WHERE tag IN (SELECT value FROM json_each(?5)) AND rating BETWEEN ?1 AND ?2"
    };
    // With an opening, the themes still have to match: one of them must be in the puzzle's themes.
    let theme_clause = if filter.opening.is_some() && !filter.themes.is_empty() {
        "EXISTS (SELECT 1 FROM json_each(?6) j WHERE instr(' ' || p.themes || ' ', ' ' || j.value || ' '))"
    } else {
        "?6 IS NOT NULL"
    };
    let sql = format!(
        "WITH pick AS ({pick} ORDER BY random() LIMIT ?3 * 20)
         SELECT DISTINCT p.lichess_id, p.fen, p.moves, p.rating, p.plays, p.themes, p.openings, p.game
         FROM pick JOIN pz.puzzles p ON p.id = pick.id
         WHERE {theme_clause}
           AND p.lichess_id NOT IN (SELECT value FROM json_each(?4))
           AND NOT EXISTS (SELECT 1 FROM puzzle_attempts a WHERE a.puzzle_id = p.lichess_id)
         LIMIT ?3"
    );
    let split = |s: String| s.split(' ').filter(|t| !t.is_empty()).map(String::from).collect::<Vec<_>>();
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let themes = serde_json::to_string(&filter.themes).map_err(err)?;
    let puzzles = stmt
        .query_map(
            params![filter.min_rating, filter.max_rating, limit, exclude, serde_json::to_string(&tags).map_err(err)?, themes],
            |r| {
                Ok(Puzzle {
                    id: r.get(0)?,
                    fen: r.get(1)?,
                    moves: split(r.get(2)?),
                    rating: r.get(3)?,
                    plays: r.get(4)?,
                    themes: split(r.get(5)?),
                    openings: split(r.get(6)?),
                    game: r.get(7)?,
                })
            },
        )
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(puzzles)
}

/// One puzzle by its Lichess id (a missed-puzzle drill replays the opponent's move that set it up).
#[tauri::command]
pub fn puzzle_get(db: State<Db>, id: String) -> Result<Option<Puzzle>, String> {
    let conn = db.conn();
    if !attached(&conn) {
        return Ok(None);
    }
    let split = |s: String| s.split(' ').filter(|t| !t.is_empty()).map(String::from).collect::<Vec<_>>();
    conn.query_row(
        "SELECT lichess_id, fen, moves, rating, plays, themes, openings, game FROM pz.puzzles WHERE lichess_id = ?1",
        [&id],
        |r| {
            Ok(Puzzle {
                id: r.get(0)?,
                fen: r.get(1)?,
                moves: split(r.get(2)?),
                rating: r.get(3)?,
                plays: r.get(4)?,
                themes: split(r.get(5)?),
                openings: split(r.get(6)?),
                game: r.get(7)?,
            })
        },
    )
    .optional()
    .map_err(err)
}

/// The student's puzzle rating (Lichess scale; 1500 before any attempt) and rated attempts so far.
fn student_rating(conn: &Connection) -> Result<(i64, i64), String> {
    conn.query_row(
        "SELECT coalesce((SELECT rating_after FROM puzzle_attempts WHERE rated = 1 ORDER BY id DESC LIMIT 1), 1500),
                (SELECT count(*) FROM puzzle_attempts WHERE rated = 1)",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(err)
}

/// Records an attempt. Only the first try at a puzzle moves the rating (Elo, K 40 for the first
/// 30 rated puzzles, then 20). Returns the rating before and after.
#[tauri::command]
pub fn puzzle_record(
    db: State<Db>,
    id: String,
    rating: i64,
    themes: Vec<String>,
    correct: bool,
    ms: Option<i64>,
) -> Result<Value, String> {
    let conn = db.conn();
    let (before, attempts) = student_rating(&conn)?;
    let seen: bool = conn
        .query_row("SELECT EXISTS (SELECT 1 FROM puzzle_attempts WHERE puzzle_id = ?1)", [&id], |r| r.get(0))
        .map_err(err)?;
    let after = if seen {
        before
    } else {
        let expected = 1.0 / (1.0 + 10f64.powf((rating - before) as f64 / 400.0));
        let k = if attempts < 30 { 40.0 } else { 20.0 };
        (before as f64 + k * (if correct { 1.0 } else { 0.0 } - expected)).round() as i64
    };
    conn.execute(
        "INSERT INTO puzzle_attempts (puzzle_id, correct, ms, puzzle_rating, rated, rating_after, themes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, correct, ms, rating, !seen, after, themes.join(" ")],
    )
    .map_err(err)?;
    Ok(json!({ "before": before, "after": after, "rated": !seen }))
}

/// For the coach's profile: rating, recent form and accuracy by theme (worst first).
pub fn profile(conn: &Connection) -> Result<Value, String> {
    let (rating, attempts) = student_rating(conn)?;
    if attempts == 0 {
        return Ok(Value::Null);
    }
    let recent: (i64, f64) = conn
        .query_row(
            "SELECT count(*), coalesce(avg(correct), 0) FROM
                (SELECT correct FROM puzzle_attempts WHERE rated = 1 ORDER BY id DESC LIMIT 50)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    let mut stmt = conn
        .prepare(
            "WITH t AS (
                SELECT j.value AS theme, a.correct FROM puzzle_attempts a,
                    json_each('[\"' || replace(a.themes, ' ', '\",\"') || '\"]') j
                WHERE a.rated = 1 AND a.themes != '')
             SELECT theme, count(*) AS n, round(100.0 * avg(correct)) AS pct FROM t
             WHERE theme NOT IN ('short', 'long', 'veryLong', 'oneMove', 'crushing', 'advantage', 'equality',
                                 'middlegame', 'endgame', 'opening', 'master', 'masterVsMaster', 'superGM', 'mate')
             GROUP BY theme HAVING n >= 3 ORDER BY pct, n DESC LIMIT 12",
        )
        .map_err(err)?;
    let themes = stmt
        .query_map([], |r| Ok(json!({ "theme": r.get::<_, String>(0)?, "n": r.get::<_, i64>(1)?, "pct": r.get::<_, f64>(2)? })))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(json!({ "rating": rating, "attempts": attempts, "recent": recent.0, "recentPct": (recent.1 * 100.0).round(), "themes": themes }))
}

#[cfg(test)]
mod tests {
    /// Builds the real puzzle file from a local download:
    /// PUZZLE_ZST=path/to/lichess_db_puzzle.csv.zst cargo test --release build_from_file -- --ignored --nocapture
    #[test]
    #[ignore]
    fn build_from_file() {
        let src = std::env::var("PUZZLE_ZST").expect("set PUZZLE_ZST");
        let dest = std::path::Path::new(&src).with_file_name(super::FILE);
        let start = std::time::Instant::now();
        let kept = super::build(std::fs::File::open(&src).unwrap(), &dest, |_, _| true).unwrap();
        let size = std::fs::metadata(&dest).unwrap().len();
        println!("kept {kept} in {:?}, {} MB", start.elapsed(), size / 1_000_000);
    }
}
