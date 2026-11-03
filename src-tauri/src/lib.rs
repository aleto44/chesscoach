mod coach;
mod db;
mod mcp;
mod tools;

use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use coach::{ClaudeCli, CoachBackend};
use mcp::{Mcp, ToolResult};

#[derive(Default)]
struct Coach(Mutex<Option<Box<dyn CoachBackend>>>);

/// Sends a user turn, starting (or restarting after a crash) the backend as needed.
#[tauri::command]
fn coach_send(
    app: AppHandle,
    coach: State<Coach>,
    mcp: State<Mcp>,
    text: String,
    resume: Option<String>,
) -> Result<(), String> {
    let mut backend = coach.0.lock().unwrap();
    if let Some(b) = backend.as_mut() {
        if b.send(&text).is_ok() {
            return Ok(());
        }
    }
    let mut fresh = ClaudeCli::spawn(&app, &mcp.url, resume.as_deref())?;
    fresh.send(&text)?;
    *backend = Some(Box::new(fresh));
    Ok(())
}

#[tauri::command]
fn coach_reset(coach: State<Coach>) {
    coach.0.lock().unwrap().take();
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
        .setup(|app| {
            let mcp = tauri::async_runtime::block_on(mcp::start(app.handle().clone()))?;
            app.manage(mcp);
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join("chesscoach.db"))?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            coach_send,
            coach_reset,
            tool_result,
            db::db_create_game,
            db::db_update_game,
            db::db_set_moves,
            db::db_upsert_tangent,
            db::db_upsert_chat,
            db::db_list_games,
            db::db_load_game,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
