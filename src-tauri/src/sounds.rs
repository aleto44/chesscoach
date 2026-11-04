//! Optional custom sounds: audio files the student drops into `<app data>/sounds`, named after
//! the event they replace (move.mp3, capture.wav, castle.ogg, check.mp3, promotion.mp3, game-end.mp3).

use std::path::PathBuf;

use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

const EXTENSIONS: &[&str] = &["mp3", "wav", "ogg", "m4a", "webm"];

fn sounds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("sounds");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The folder custom sounds go in (created if missing).
#[tauri::command]
pub fn sounds_folder(app: AppHandle) -> Result<String, String> {
    Ok(sounds_dir(&app)?.to_string_lossy().into_owned())
}

/// Raw bytes of the custom file for `name` (e.g. "move"), or an empty response if there is none.
#[tauri::command]
pub fn custom_sound(app: AppHandle, name: String) -> Result<Response, String> {
    read_sound(&app, &name).map(Response::new)
}

pub fn read_sound(app: &AppHandle, name: &str) -> Result<Vec<u8>, String> {
    if !name.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
        return Err("bad sound name".into());
    }
    let dir = sounds_dir(app)?;
    for ext in EXTENSIONS {
        let path = dir.join(format!("{name}.{ext}"));
        if path.is_file() {
            return std::fs::read(path).map_err(|e| e.to_string());
        }
    }
    Ok(Vec::new())
}
