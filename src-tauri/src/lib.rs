mod auth;
mod coach;
mod db;
mod mcp;
mod puzzles;
mod relay;
mod remote;
mod sounds;
mod stats;
mod tailscale;
mod tools;

use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use relay::Relay;

use coach::{ClaudeCli, CoachBackend};
use mcp::{Mcp, ToolResult};

/// The coach process and the client (see `relay`) it belongs to.
#[derive(Default)]
struct Coach(Mutex<Option<(String, Box<dyn CoachBackend>)>>);

/// Sends a user turn for `client`, starting the backend as needed: on first use, after a crash,
/// or when the turn comes from a different client than the running process belongs to (then
/// the process restarts resuming that client's own conversation).
pub(crate) fn send_turn(app: &AppHandle, client: &str, text: &str, resume: Option<&str>) -> Result<(), String> {
    let coach = app.state::<Coach>();
    let mut backend = coach.0.lock().unwrap();
    if let Some((owner, b)) = backend.as_mut() {
        if owner == client && b.send(text).is_ok() {
            return Ok(());
        }
    }
    backend.take();
    app.state::<Relay>().set_owner(client);
    let model = app.state::<db::Db>().setting("coachModel");
    let model = model.as_ref().and_then(|m| m.as_str()).filter(|m| !m.is_empty());
    let mut fresh = ClaudeCli::spawn(app, client, &app.state::<Mcp>().url, resume, model)?;
    fresh.send(text)?;
    *backend = Some((client.to_string(), Box::new(fresh)));
    Ok(())
}

/// Ends `client`'s coach process; another client's is left alone.
pub(crate) fn reset_coach(app: &AppHandle, client: &str) {
    let coach = app.state::<Coach>();
    let mut backend = coach.0.lock().unwrap();
    if backend.as_ref().is_some_and(|(owner, _)| owner == client) {
        backend.take();
    }
}

/// Tells the other devices that `client` saved changes to a game, so they reload it.
pub(crate) fn notify_game_changed(app: &AppHandle, client: &str, game_id: i64) {
    relay::emit_all(app, "game-changed", serde_json::json!({ "gameId": game_id, "from": client }));
}

#[tauri::command]
fn game_changed(app: AppHandle, game_id: i64) {
    notify_game_changed(&app, relay::DESKTOP, game_id);
}

#[tauri::command]
fn coach_send(app: AppHandle, text: String, resume: Option<String>) -> Result<(), String> {
    send_turn(&app, relay::DESKTOP, &text, resume.as_deref())
}

#[tauri::command]
fn coach_reset(app: AppHandle) {
    reset_coach(&app, relay::DESKTOP);
}

#[tauri::command]
fn tool_result(mcp: State<Mcp>, id: u64, result: ToolResult) {
    mcp.resolve(id, result);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Coach::default())
        .manage(auth::Login::default())
        .manage(puzzles::Import::default())
        .manage(Relay::default())
        .setup(|app| {
            let mcp = tauri::async_runtime::block_on(mcp::start(app.handle().clone()))?;
            app.manage(mcp);
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join("chesscoach.db"))?);
            app.manage(remote::Remote::load(&dir));
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { remote::start_if_enabled(&handle).await });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            coach_send,
            coach_reset,
            tool_result,
            auth::auth_status,
            auth::auth_login,
            auth::auth_submit_code,
            auth::auth_cancel,
            auth::auth_logout,
            auth::plan_usage,
            sounds::sounds_folder,
            sounds::custom_sound,
            game_changed,
            remote::remote_info,
            remote::remote_set_enabled,
            remote::remote_new_code,
            remote::remote_tailscale_serve,
            db::db_create_game,
            db::db_update_game,
            db::db_set_moves,
            db::db_upsert_tangent,
            db::db_upsert_chat,
            db::db_list_games,
            db::db_load_game,
            db::db_delete_game,
            db::db_prune_empty_games,
            db::db_get_settings,
            db::db_set_setting,
            stats::db_save_analysis,
            stats::db_unanalyzed_games,
            stats::db_profile,
            stats::db_query_games,
            stats::db_record_observation,
            stats::db_add_drills,
            stats::db_due_drills,
            stats::db_drill_counts,
            stats::db_grade_drill,
            stats::db_retire_drill,
            stats::db_drill_overview,
            stats::puzzle_history,
            stats::db_repertoire,
            stats::db_add_repertoire,
            stats::db_remove_repertoire,
            puzzles::puzzle_status,
            puzzles::puzzle_find,
            puzzles::puzzle_record,
            puzzles::puzzle_import_start,
            puzzles::puzzle_import_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
