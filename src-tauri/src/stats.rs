//! What the app learns about the student: post-game analysis, the profile built from rated games,
//! the coach's observations, spaced-repetition drills and the opening repertoire.
//! The frontend runs the engine; this module stores results and does the aggregation in SQL.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::db::Db;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Runs `sql` and turns each row into a JSON object keyed by column name.
fn rows(conn: &rusqlite::Connection, sql: &str, args: impl rusqlite::Params) -> Result<Vec<Value>, String> {
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let names: Vec<String> = stmt.column_names().map(|s| s.to_string()).collect();
    let out = stmt
        .query_map(args, |r| {
            let mut obj = serde_json::Map::new();
            for (i, name) in names.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(f) => json!(f),
                    rusqlite::types::ValueRef::Text(t) => {
                        let s = String::from_utf8_lossy(t).into_owned();
                        // JSON columns (tags, line) come back parsed.
                        if s.starts_with('[') { serde_json::from_str(&s).unwrap_or(Value::String(s)) } else { Value::String(s) }
                    }
                    rusqlite::types::ValueRef::Blob(_) => Value::Null,
                };
                obj.insert(name.clone(), v);
            }
            Ok(Value::Object(obj))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(out)
}

// ---- Analysis ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedMove {
    ply: i64,
    eval_before: i64,
    eval_after: i64,
    cp_loss: i64,
    best_uci: Option<String>,
    class: String,
    #[serde(default)]
    label: Option<String>,
    phase: String,
    tags: Vec<String>,
}

#[tauri::command]
pub fn db_save_analysis(
    db: State<Db>,
    game_id: i64,
    moves: Vec<AnalyzedMove>,
    opening_name: Option<String>,
) -> Result<(), String> {
    let mut conn = db.conn();
    let tx = conn.transaction().map_err(err)?;
    {
        let mut update = tx
            .prepare(
                "UPDATE moves SET eval_before = ?3, eval_after = ?4, cp_loss = ?5, best_uci = ?6,
                        class = ?7, phase = ?8, tags = ?9, label = ?10
                 WHERE game_id = ?1 AND ply = ?2",
            )
            .map_err(err)?;
        for m in &moves {
            update
                .execute(params![
                    game_id,
                    m.ply,
                    m.eval_before,
                    m.eval_after,
                    m.cp_loss,
                    m.best_uci,
                    m.class,
                    m.phase,
                    serde_json::to_string(&m.tags).map_err(err)?,
                    m.label,
                ])
                .map_err(err)?;
        }
    }
    tx.execute(
        "UPDATE games SET analyzed_at = datetime('now'), opening_name = coalesce(?2, opening_name) WHERE id = ?1",
        params![game_id, opening_name],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}

/// Finished games with moves that haven't been analyzed yet, newest first (a fresh import of many
/// games shows its latest ones first).
#[tauri::command]
pub fn db_unanalyzed_games(db: State<Db>) -> Result<Vec<i64>, String> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare(
            "SELECT id FROM games g WHERE result IS NOT NULL AND analyzed_at IS NULL
               AND EXISTS (SELECT 1 FROM moves m WHERE m.game_id = g.id)
             ORDER BY ended_at DESC, id DESC",
        )
        .map_err(err)?;
    let ids = stmt.query_map([], |r| r.get(0)).map_err(err)?.collect::<Result<Vec<i64>, _>>().map_err(err);
    ids
}

// ---- Profile ----

/// Aggregates over the student's rated games (their unaided play). Practice games are only counted.
#[tauri::command]
pub fn db_profile(db: State<Db>) -> Result<Value, String> {
    let conn = db.conn();
    // Student moves in finished, analyzed rated games.
    const STUDENT_MOVES: &str = "moves m JOIN games g ON g.id = m.game_id
        WHERE g.mode = 'rated' AND g.result IS NOT NULL AND m.by_student = 1 AND m.class IS NOT NULL";

    let record = rows(
        &conn,
        "SELECT student_color AS color, count(*) AS games,
                sum(CASE WHEN (result = '1-0') = (student_color = 'white') AND result != '1/2-1/2' THEN 1 ELSE 0 END) AS wins,
                sum(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
                sum(CASE WHEN (result = '0-1') = (student_color = 'white') AND result != '1/2-1/2' THEN 1 ELSE 0 END) AS losses,
                avg(coalesce(opponent_rating, CAST(substr(opponent, instr(opponent, ':') + 1) AS INTEGER))) AS avg_opponent
         FROM games WHERE mode = 'rated' AND result IS NOT NULL GROUP BY student_color",
        [],
    )?;
    let counts = rows(
        &conn,
        "SELECT
            (SELECT count(*) FROM games WHERE mode = 'rated' AND result IS NOT NULL) AS rated_finished,
            (SELECT count(*) FROM games WHERE mode = 'rated' AND result IS NOT NULL AND analyzed_at IS NOT NULL) AS rated_analyzed,
            (SELECT count(*) FROM games WHERE mode = 'practice') AS practice_games",
        [],
    )?;
    let phases = rows(
        &conn,
        &format!(
            "SELECT m.phase, count(*) AS moves, round(avg(m.cp_loss)) AS avg_cp_loss,
                    sum(m.class = 'inaccuracy') AS inaccuracies, sum(m.class = 'mistake') AS mistakes,
                    sum(m.class = 'blunder') AS blunders
             FROM {STUDENT_MOVES} GROUP BY m.phase"
        ),
        [],
    )?;
    let tags = rows(
        &conn,
        "SELECT t.value AS tag, count(*) AS count
         FROM moves m JOIN games g ON g.id = m.game_id, json_each(m.tags) t
         WHERE g.mode = 'rated' AND g.result IS NOT NULL AND m.by_student = 1 AND m.class IN ('mistake', 'blunder')
         GROUP BY t.value ORDER BY count DESC LIMIT 8",
        [],
    )?;
    // Results by the first move pair, from the student's side.
    let openings = rows(
        &conn,
        "SELECT g.student_color AS color,
                coalesce(g.opening_name, (SELECT group_concat(san, ' ') FROM
                    (SELECT san FROM moves WHERE game_id = g.id ORDER BY ply LIMIT 4))) AS opening,
                count(*) AS games,
                sum(CASE WHEN g.result = '1/2-1/2' THEN 0.5
                         WHEN (g.result = '1-0') = (g.student_color = 'white') THEN 1 ELSE 0 END) AS points
         FROM games g WHERE g.mode = 'rated' AND g.result IS NOT NULL
         GROUP BY color, opening ORDER BY games DESC LIMIT 10",
        [],
    )?;
    let recent = rows(
        &conn,
        "SELECT g.id, date(g.ended_at) AS date, g.student_color AS color, g.opponent, g.result, g.termination,
                g.time_control, g.opening_name, g.rating_before, g.rating_after,
                (SELECT round(avg(cp_loss)) FROM moves WHERE game_id = g.id AND by_student = 1) AS avg_cp_loss,
                (SELECT count(*) FROM moves WHERE game_id = g.id AND by_student = 1 AND class = 'blunder') AS blunders
         FROM games g WHERE g.mode = 'rated' AND g.result IS NOT NULL ORDER BY g.ended_at DESC LIMIT 5",
        [],
    )?;
    let observations = rows(
        &conn,
        "SELECT date(created_at) AS date, tag, note FROM observations ORDER BY created_at DESC, id DESC LIMIT 10",
        [],
    )?;
    let drills = rows(
        &conn,
        "SELECT kind, count(*) AS cards, sum(due_at <= datetime('now')) AS due,
                (SELECT round(100.0 * avg(correct)) FROM drill_attempts a JOIN drills d2 ON d2.id = a.drill_id
                 WHERE d2.kind = d.kind) AS pct_correct
         FROM drills d WHERE retired = 0 GROUP BY kind",
        [],
    )?;
    let (rating, rated_games) = crate::db::player_rating(&conn)?;
    Ok(json!({
        "counts": counts.into_iter().next(),
        "record": record,
        "phases": phases,
        "mistakeTags": tags,
        "openings": openings,
        "recentRated": recent,
        "observations": observations,
        "drills": drills,
        "puzzles": crate::puzzles::profile(&conn)?,
        "gameRating": { "rating": rating, "games": rated_games },
    }))
}

/// The puzzle menu's history: the latest attempts, newest first, with the stats the profile uses.
#[tauri::command]
pub fn puzzle_history(db: State<Db>, limit: i64) -> Result<Value, String> {
    let conn = db.conn();
    let attempts = rows(
        &conn,
        "SELECT id, puzzle_id AS puzzleId, at, correct, ms, puzzle_rating AS puzzleRating, rated,
                rating_after AS ratingAfter, themes
         FROM puzzle_attempts ORDER BY id DESC LIMIT ?1",
        [limit],
    )?;
    Ok(json!({
        "attempts": attempts,
        "stats": crate::puzzles::profile(&conn)?,
        "mastery": crate::puzzles::mastery(&conn, None)?,
    }))
}

/// The drill menu: cards per kind and the latest attempts, newest first.
#[tauri::command]
pub fn db_drill_overview(db: State<Db>, limit: i64) -> Result<Value, String> {
    let conn = db.conn();
    let kinds = rows(
        &conn,
        "SELECT kind, count(*) AS cards, sum(due_at <= datetime('now')) AS due,
                (SELECT round(100.0 * avg(correct)) FROM drill_attempts a JOIN drills d2 ON d2.id = a.drill_id
                 WHERE d2.kind = d.kind) AS pctCorrect
         FROM drills d WHERE retired = 0 GROUP BY kind",
        [],
    )?;
    let recent = rows(
        &conn,
        "SELECT a.id, a.at, a.correct, a.played, d.kind, d.title
         FROM drill_attempts a JOIN drills d ON d.id = a.drill_id ORDER BY a.id DESC LIMIT ?1",
        [limit],
    )?;
    Ok(json!({ "kinds": kinds, "recent": recent }))
}

/// Games with their student mistakes, newest first. `mode` is 'rated', 'practice' or 'all'.
#[tauri::command]
pub fn db_query_games(db: State<Db>, mode: String, limit: i64, game_id: Option<i64>) -> Result<Value, String> {
    let conn = db.conn();
    let games = rows(
        &conn,
        "SELECT g.id, date(g.started_at) AS date, g.mode, g.student_color AS color, g.opponent, g.result,
                g.termination, g.time_control, g.opening_name, g.takebacks, g.analyzed_at IS NOT NULL AS analyzed,
                g.source, g.opponent_rating, g.student_rating,
                (SELECT count(*) FROM moves WHERE game_id = g.id) AS plies,
                (SELECT round(avg(cp_loss)) FROM moves WHERE game_id = g.id AND by_student = 1) AS avg_cp_loss
         FROM games g
         WHERE (?1 = 'all' OR g.mode = ?1) AND (?3 IS NULL OR g.id = ?3)
           AND EXISTS (SELECT 1 FROM moves m WHERE m.game_id = g.id AND m.by_student = 1)
         ORDER BY g.updated_at DESC LIMIT ?2",
        params![mode, limit, game_id],
    )?;
    let mut out = Vec::new();
    for mut g in games {
        let id = g["id"].as_i64().unwrap_or_default();
        g["mistakes"] = json!(rows(
            &conn,
            "SELECT ply, san, fen_before, best_uci, cp_loss, eval_before, eval_after, class, phase, tags, clock_ms
             FROM moves WHERE game_id = ?1 AND by_student = 1 AND class IN ('mistake', 'blunder') ORDER BY ply",
            [id],
        )?);
        out.push(g);
    }
    Ok(json!(out))
}

#[tauri::command]
pub fn db_record_observation(
    db: State<Db>,
    game_id: Option<i64>,
    tag: String,
    note: String,
    fen: Option<String>,
) -> Result<i64, String> {
    let conn = db.conn();
    conn.execute(
        "INSERT INTO observations (game_id, tag, note, fen) VALUES (?1, ?2, ?3, ?4)",
        params![game_id, tag, note, fen],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

// ---- Weaknesses and ratings (the Profile menu) ----

/// Which real games the dashboard covers: 'all', 'app' (rated games here) or 'imported'
/// (chess.com and Lichess).
fn scope_sql(source: &str) -> &'static str {
    match source {
        "app" => "g.source IS NULL",
        "imported" => "g.source IS NOT NULL",
        _ => "1",
    }
}

/// What goes wrong in the student's real games (rated games here and imported ones, analyzed),
/// over the `last` most recent. Practice games are left out: help was on. Moves are the student's.
#[tauri::command]
pub fn db_weakness(db: State<Db>, source: String, last: i64) -> Result<Value, String> {
    weakness(&db.conn(), &source, last)
}

pub(crate) fn weakness(conn: &rusqlite::Connection, source: &str, last: i64) -> Result<Value, String> {
    let scope = scope_sql(source);
    let real = format!("g.mode = 'rated' AND g.result IS NOT NULL AND g.student_color != 'both' AND {scope}");
    let ids = format!(
        "SELECT g.id FROM games g WHERE {real} AND g.analyzed_at IS NOT NULL ORDER BY g.ended_at DESC, g.id DESC LIMIT {}",
        last.clamp(1, 1000)
    );
    let mine = format!("m.game_id IN ({ids}) AND m.by_student = 1 AND m.class IS NOT NULL");
    let summary = rows(
        &conn,
        &format!(
            "SELECT count(*) AS games,
                    coalesce(sum(CASE WHEN result = '1/2-1/2' THEN 0 WHEN (result = '1-0') = (student_color = 'white') THEN 1 ELSE 0 END), 0) AS wins,
                    coalesce(sum(result = '1/2-1/2'), 0) AS draws,
                    coalesce(sum(CASE WHEN result = '1/2-1/2' THEN 0 WHEN (result = '1-0') = (student_color = 'white') THEN 0 ELSE 1 END), 0) AS losses,
                    (SELECT count(*) FROM moves m WHERE {mine}) AS moves,
                    (SELECT round(avg(cp_loss)) FROM moves m WHERE {mine}) AS avgCpLoss,
                    (SELECT coalesce(sum(class = 'blunder'), 0) FROM moves m WHERE {mine}) AS blunders,
                    (SELECT coalesce(sum(class = 'mistake'), 0) FROM moves m WHERE {mine}) AS mistakes,
                    (SELECT coalesce(sum(class = 'inaccuracy'), 0) FROM moves m WHERE {mine}) AS inaccuracies,
                    (SELECT count(*) FROM games g WHERE {real} AND g.analyzed_at IS NULL) AS waiting
             FROM games WHERE id IN ({ids})"
        ),
        [],
    )?;
    let phases = rows(
        &conn,
        &format!(
            "SELECT m.phase, count(*) AS moves, count(DISTINCT m.game_id) AS games, round(avg(m.cp_loss)) AS avgCpLoss,
                    sum(m.class = 'inaccuracy') AS inaccuracies, sum(m.class = 'mistake') AS mistakes,
                    sum(m.class = 'blunder') AS blunders
             FROM moves m WHERE {mine} GROUP BY m.phase"
        ),
        [],
    )?;
    // The patterns behind the student's mistakes and blunders, and how many games they cost.
    let tags = rows(
        &conn,
        &format!(
            "SELECT t.value AS tag, count(*) AS count, count(DISTINCT m.game_id) AS games,
                    sum(m.class = 'blunder') AS blunders
             FROM moves m, json_each(m.tags) t
             WHERE {mine} AND m.class IN ('mistake', 'blunder')
             GROUP BY t.value ORDER BY count DESC"
        ),
        [],
    )?;
    let colors = rows(
        &conn,
        &format!(
            "SELECT g.student_color AS color, count(*) AS games,
                    sum(CASE WHEN g.result = '1/2-1/2' THEN 0.5 WHEN (g.result = '1-0') = (g.student_color = 'white') THEN 1 ELSE 0 END) AS points,
                    (SELECT round(avg(m.cp_loss)) FROM moves m JOIN games g2 ON g2.id = m.game_id
                     WHERE {mine} AND g2.student_color = g.student_color) AS avgCpLoss
             FROM games g WHERE g.id IN ({ids}) GROUP BY g.student_color"
        ),
        [],
    )?;
    // How the student does in each opening, and how well they play its first dozen moves.
    let openings = rows(
        &conn,
        &format!(
            "SELECT g.student_color AS color, coalesce(g.opening_name, 'Unnamed opening') AS opening, count(*) AS games,
                    sum(CASE WHEN g.result = '1/2-1/2' THEN 0.5 WHEN (g.result = '1-0') = (g.student_color = 'white') THEN 1 ELSE 0 END) AS points,
                    (SELECT round(avg(m.cp_loss)) FROM moves m JOIN games g2 ON g2.id = m.game_id
                     WHERE {mine} AND m.ply <= 24 AND g2.student_color = g.student_color
                       AND coalesce(g2.opening_name, '') = coalesce(g.opening_name, '')) AS avgCpLoss
             FROM games g WHERE g.id IN ({ids})
             GROUP BY g.student_color, g.opening_name HAVING count(*) >= 2 ORDER BY games DESC LIMIT 10"
        ),
        [],
    )?;
    // Game by game, oldest first: is it getting better?
    let trend = rows(
        &conn,
        &format!(
            "SELECT g.id, date(g.ended_at) AS date, g.source,
                    (SELECT round(avg(cp_loss)) FROM moves m WHERE m.game_id = g.id AND m.by_student = 1) AS avgCpLoss,
                    (SELECT count(*) FROM moves m WHERE m.game_id = g.id AND m.by_student = 1 AND m.class = 'blunder') AS blunders,
                    (SELECT count(*) FROM moves m WHERE m.game_id = g.id AND m.by_student = 1 AND m.class = 'mistake') AS mistakes
             FROM games g WHERE g.id IN ({ids}) ORDER BY g.ended_at, g.id"
        ),
        [],
    )?;
    Ok(json!({
        "summary": summary.into_iter().next(),
        "phases": phases,
        "tags": tags,
        "colors": colors,
        "openings": openings,
        "trend": trend,
        "puzzles": crate::puzzles::profile(&conn)?,
    }))
}

/// Every rating the student has, over time, oldest first, each point [time, rating]: the in-app
/// game rating (chess.com scale), the puzzle rating (Lichess scale; the frontend converts it), and
/// the student's own rating in imported games (chess.com scale already), per site and speed.
#[tauri::command]
pub fn db_rating_history(db: State<Db>) -> Result<Value, String> {
    rating_history(&db.conn())
}

pub(crate) fn rating_history(conn: &rusqlite::Connection) -> Result<Value, String> {
    let points = |sql: &str, args: &[&dyn rusqlite::ToSql]| -> Result<Vec<Value>, String> {
        let mut stmt = conn.prepare(sql).map_err(err)?;
        let out = stmt
            .query_map(args, |r| Ok(json!([r.get::<_, String>(0)?, r.get::<_, i64>(1)?])))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err);
        out
    };
    let game = points(
        "SELECT * FROM (SELECT ended_at, rating_after FROM games WHERE rating_after IS NOT NULL AND ended_at IS NOT NULL
         ORDER BY ended_at DESC LIMIT 500) ORDER BY 1",
        &[],
    )?;
    let puzzles = points(
        "SELECT * FROM (SELECT at, rating_after FROM puzzle_attempts WHERE rated = 1 ORDER BY id DESC LIMIT 1000) ORDER BY 1",
        &[],
    )?;
    let series: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT source, coalesce(speed, 'other') FROM games
                 WHERE source IS NOT NULL AND student_rating IS NOT NULL ORDER BY 1, 2",
            )
            .map_err(err)?;
        let out = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        out
    };
    let mut imported = Vec::new();
    for (source, speed) in series {
        let pts = points(
            "SELECT * FROM (SELECT ended_at, student_rating FROM games
                WHERE source = ?1 AND coalesce(speed, 'other') = ?2 AND student_rating IS NOT NULL
                ORDER BY ended_at DESC LIMIT 500) ORDER BY 1",
            &[&source, &speed],
        )?;
        imported.push(json!({ "source": source, "speed": speed, "points": pts }));
    }
    Ok(json!({ "game": game, "puzzles": puzzles, "imported": imported }))
}

// ---- Drills ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDrill {
    kind: String,
    title: String,
    fen: String,
    color: String,
    answer_uci: Option<String>,
    #[serde(default)]
    line: Vec<String>,
    note: Option<String>,
    source_game_id: Option<i64>,
    source_ply: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drill {
    id: i64,
    kind: String,
    title: String,
    fen: String,
    color: String,
    answer_uci: Option<String>,
    line: Vec<String>,
    note: Option<String>,
    source_game_id: Option<i64>,
    source_ply: Option<i64>,
    due_at: String,
    reps: i64,
    lapses: i64,
}

/// Adds drills, skipping ones that already exist. Returns how many were new.
#[tauri::command]
pub fn db_add_drills(db: State<Db>, drills: Vec<NewDrill>) -> Result<usize, String> {
    let mut conn = db.conn();
    let tx = conn.transaction().map_err(err)?;
    let mut added = 0;
    for d in &drills {
        let line = if d.line.is_empty() { String::new() } else { serde_json::to_string(&d.line).map_err(err)? };
        added += tx
            .execute(
                "INSERT OR IGNORE INTO drills (kind, title, fen, color, answer_uci, line, note, source_game_id, source_ply)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![d.kind, d.title, d.fen, d.color, d.answer_uci, line, d.note, d.source_game_id, d.source_ply],
            )
            .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(added)
}

/// Drills due now (or all of them with `all`), most overdue first. `tag` picks the mistake drills
/// with that review tag (e.g. "hung-piece"), due or not: the weakness dashboard's "drill these".
#[tauri::command]
pub fn db_due_drills(db: State<Db>, limit: i64, all: Option<bool>, tag: Option<String>) -> Result<Vec<Drill>, String> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, title, fen, color, answer_uci, line, note, source_game_id, source_ply, due_at, reps, lapses
             FROM drills WHERE retired = 0
               AND (CASE WHEN ?3 IS NULL THEN ?2 OR due_at <= datetime('now')
                         ELSE kind = 'mistake' AND (', ' || coalesce(note, '') || ',') LIKE '%, ' || ?3 || ',%' END)
             ORDER BY due_at, id LIMIT ?1",
        )
        .map_err(err)?;
    let drills = stmt
        .query_map(params![limit, all.unwrap_or(false), tag], |r| {
            let line: String = r.get(6)?;
            Ok(Drill {
                id: r.get(0)?,
                kind: r.get(1)?,
                title: r.get(2)?,
                fen: r.get(3)?,
                color: r.get(4)?,
                answer_uci: r.get(5)?,
                line: serde_json::from_str(&line).unwrap_or_default(),
                note: r.get(7)?,
                source_game_id: r.get(8)?,
                source_ply: r.get(9)?,
                due_at: r.get(10)?,
                reps: r.get(11)?,
                lapses: r.get(12)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(drills)
}

#[tauri::command]
pub fn db_drill_counts(db: State<Db>) -> Result<Value, String> {
    let conn = db.conn();
    Ok(rows(
        &conn,
        "SELECT count(*) AS total, coalesce(sum(due_at <= datetime('now')), 0) AS due FROM drills WHERE retired = 0",
        [],
    )?
    .into_iter()
    .next()
    .unwrap_or(Value::Null))
}

/// Records an attempt and schedules the next review (SM-2: a miss starts the card over tomorrow;
/// a hit multiplies the interval by the card's ease).
#[tauri::command]
pub fn db_grade_drill(db: State<Db>, id: i64, correct: bool, played: String, ms: Option<i64>) -> Result<String, String> {
    let mut conn = db.conn();
    let tx = conn.transaction().map_err(err)?;
    let (interval, ease, reps): (f64, f64, i64) = tx
        .query_row("SELECT interval_days, ease, reps FROM drills WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()
        .map_err(err)?
        .ok_or("no such drill")?;
    let (next, ease, reps) = if correct {
        let next = match reps {
            0 => 1.0,
            1 => 3.0,
            _ => (interval * ease).max(interval + 1.0),
        };
        (next, (ease + 0.1).min(3.0), reps + 1)
    } else {
        (1.0, (ease - 0.2).max(1.3), 0)
    };
    tx.execute(
        "UPDATE drills SET interval_days = ?2, ease = ?3, reps = ?4,
                lapses = lapses + ?5, due_at = datetime('now', printf('+%d minutes', CAST(?2 * 1440 AS INTEGER)))
         WHERE id = ?1",
        params![id, next, ease, reps, if correct { 0 } else { 1 }],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO drill_attempts (drill_id, correct, played, ms) VALUES (?1, ?2, ?3, ?4)",
        params![id, correct, played, ms],
    )
    .map_err(err)?;
    let due: String = tx.query_row("SELECT due_at FROM drills WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(due)
}

#[tauri::command]
pub fn db_retire_drill(db: State<Db>, id: i64) -> Result<(), String> {
    db.conn().execute("UPDATE drills SET retired = 1 WHERE id = ?1", [id]).map(|_| ()).map_err(err)
}

// ---- Repertoire ----

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireLine {
    #[serde(default)]
    id: i64,
    color: String,
    name: String,
    moves: Vec<String>,
}

#[tauri::command]
pub fn db_repertoire(db: State<Db>) -> Result<Vec<RepertoireLine>, String> {
    let conn = db.conn();
    let mut stmt = conn.prepare("SELECT id, color, name, moves FROM repertoire ORDER BY color DESC, name").map_err(err)?;
    let lines = stmt
        .query_map([], |r| {
            let moves: String = r.get(3)?;
            Ok(RepertoireLine {
                id: r.get(0)?,
                color: r.get(1)?,
                name: r.get(2)?,
                moves: serde_json::from_str(&moves).unwrap_or_default(),
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(lines)
}

#[tauri::command]
pub fn db_add_repertoire(db: State<Db>, line: RepertoireLine) -> Result<(), String> {
    db.conn()
        .execute(
            "INSERT INTO repertoire (color, name, moves) VALUES (?1, ?2, ?3)
             ON CONFLICT (color, moves) DO UPDATE SET name = excluded.name",
            params![line.color, line.name, serde_json::to_string(&line.moves).map_err(err)?],
        )
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub fn db_remove_repertoire(db: State<Db>, id: i64) -> Result<(), String> {
    db.conn().execute("DELETE FROM repertoire WHERE id = ?1", [id]).map(|_| ()).map_err(err)
}
