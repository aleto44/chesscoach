//! The desktop app: a window opened at Chess Coach's server, which serves the same page the phone
//! gets, so the desktop always runs what's deployed (docs/deployment.md). Nothing is stored here but
//! the window's own web storage (offline caches); the service worker lets it open without the server.
//!
//! The server address and token come from `%USERPROFILE%\.chesscoach\server.json`
//! (`{"url": "...", "token": "..."}`), handed to the page as `window.__CC_SERVER__`.
//!
//! The program is installed and kept up to date by `launch.ps1` (next to it), which rebuilds it
//! when the deployed `src-tauri` changed. The page asks for that by going to the RELAUNCH address.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// Which build of this program it is: the hash of `src-tauri` it was built from, set by
/// launch.ps1. The page compares it with the server's /api/version (src/update.ts).
const SHELL_VERSION: &str = match option_env!("CC_SHELL_VERSION") {
    Some(v) => v,
    None => "dev",
};
/// Where the page goes to ask for a restart (src/update.ts); it never loads.
const RELAUNCH_HOST: &str = "relaunch.chesscoach.invalid";

fn server_config() -> serde_json::Value {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    home.map(|h| std::path::PathBuf::from(h).join(".chesscoach").join("server.json"))
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(serde_json::Value::Null)
}

/// Starts launch.ps1 to wait for this process to end, update and start again, then quits.
fn relaunch(app: &AppHandle) {
    let script = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|d| d.join("launch.ps1")));
    if let Some(script) = script.filter(|s| s.exists()) {
        let mut cmd = std::process::Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"])
            .arg(script)
            .args(["-After", &std::process::id().to_string()]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        if cmd.spawn().is_ok() {
            app.exit(0);
            return;
        }
    }
    // Not installed by launch.ps1 (e.g. `cargo run`): just reload the page.
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("location.reload()");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let mut config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().unwrap_or_default();
            let server_json = server_config();
            let server: Option<Url> = server_json.get("url").and_then(|u| u.as_str()).and_then(|u| Url::parse(u).ok());
            // Without an address, the bundled page (fallback/) says how to give it one.
            if let Some(url) = &server {
                config.url = WebviewUrl::External(url.clone());
            }
            let script = format!(
                "window.__CC_SERVER__ = {}; window.__CC_SHELL__ = {};",
                server_json,
                serde_json::json!({ "version": SHELL_VERSION })
            );
            let handle = app.handle().clone();
            let origin = server.as_ref().map(|u| u.origin());
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(&script)
                // The window stays on the server's pages: the restart address restarts, and any
                // other site (a Lichess puzzle, the usage page) opens in the browser instead.
                .on_navigation(move |url| {
                    if url.host_str() == Some(RELAUNCH_HOST) {
                        let app = handle.clone();
                        std::thread::spawn(move || relaunch(&app));
                        return false;
                    }
                    let external = matches!(url.scheme(), "http" | "https")
                        && origin.as_ref().is_some_and(|o| *o != url.origin())
                        && !url.host_str().is_some_and(|h| h == "tauri.localhost" || h == "localhost");
                    if external {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                        return false;
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
