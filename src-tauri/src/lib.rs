//! The desktop app: a window over the bundled frontend, which talks to Chess Coach's server
//! (`server/`) over HTTP, like the phone does. Nothing is stored here but the window's own web
//! storage (the server address and token, offline caches).
//!
//! The server address and token can also come from `%USERPROFILE%\.chesscoach\server.json`
//! (`{"url": "...", "token": "..."}`), handed to the page as `window.__CC_SERVER__`. That's how the
//! app gets set up without typing a pairing code; Settings can change it too.

use tauri::WebviewWindowBuilder;

fn server_config() -> serde_json::Value {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    home.map(|h| std::path::PathBuf::from(h).join(".chesscoach").join("server.json"))
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(serde_json::Value::Null)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().unwrap_or_default();
            let script = format!("window.__CC_SERVER__ = {};", server_config());
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(&script)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
