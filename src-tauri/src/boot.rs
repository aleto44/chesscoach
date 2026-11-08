//! Everything the app needs when it opens, in one call. Over Tailscale each request from a phone
//! that just woke up can take a while, and opening the app used to make half a dozen of them one
//! after another before the game was on screen.

use serde_json::{json, Value};
use tauri::State;

use crate::db::{self, Db};
use crate::{puzzles, stats};

/// `prefer`: the game the device had open last time (kept if it still exists), else the latest.
/// Games abandoned before the student moved go first, as they did on every launch.
#[tauri::command]
pub fn app_boot(db: State<Db>, prefer: Option<i64>) -> Result<Value, String> {
    db::db_prune_empty_games(db.clone(), prefer)?;
    let mut game = match prefer {
        Some(id) => db::db_load_game(db.clone(), id)?,
        None => None,
    };
    if game.is_none() {
        if let Some(latest) = db::db_list_games(db.clone(), Some(1))?.into_iter().next() {
            game = db::db_load_game(db.clone(), latest.id)?;
        }
    }
    Ok(json!({
        "game": game,
        "settings": db::db_get_settings(db.clone())?,
        "drillCounts": stats::db_drill_counts(db.clone())?,
        // The puzzle set is optional; the app works without knowing about it yet.
        "puzzles": puzzles::puzzle_status(db.clone()).ok(),
    }))
}
