//! Signing in to Claude from inside the app by driving `claude auth`. The CLI opens the browser,
//! the student signs in, and the code shown on the callback page is written to the CLI's stdin.

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::fs::File;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::coach::claude_command;
use crate::relay;

#[derive(Default)]
pub struct Login(Mutex<Option<(Child, ChildStdin)>>, Mutex<Option<Arc<Mutex<File>>>>);

/// Appends an app-side marker to the login log (never the code itself).
fn note(login: &Login, text: &str) {
    if let Some(log) = login.1.lock().unwrap().as_ref() {
        let _ = writeln!(log.lock().unwrap(), "
{text}");
    }
}

impl Drop for Login {
    fn drop(&mut self) {
        if let Some((mut child, _)) = self.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

/// `claude auth status` as JSON, e.g. {"loggedIn": true, "authMethod": "claude.ai", ...}.
#[tauri::command]
pub async fn auth_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = claude_command()
            .args(["auth", "status"])
            .output()
            .map_err(|e| format!("could not run claude: {e}"))?;
        serde_json::from_slice(&out.stdout).map_err(|_| {
            format!(
                "unexpected output from claude auth status: {}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Starts `claude auth login`. Output arrives as `auth-output` chunks (the code prompt has no
/// newline, so this streams raw text), then `auth-exit` with the exit code.
#[tauri::command]
pub fn auth_login(app: AppHandle, login: State<Login>) -> Result<(), String> {
    let mut slot = login.0.lock().unwrap();
    if let Some((mut old, _)) = slot.take() {
        let _ = old.kill();
    }
    let mut child = claude_command()
        .args(["auth", "login", "--claudeai"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run claude: {e}"))?;
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Everything the CLI prints also goes to auth-login.log in the app data dir, for debugging.
    let log = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| File::create(dir.join("auth-login.log")).ok())
        .map(|f| Arc::new(Mutex::new(f)));
    *login.1.lock().unwrap() = log.clone();

    for mut stream in [Box::new(stdout) as Box<dyn Read + Send>, Box::new(stderr)] {
        let app = app.clone();
        let log = log.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = stream.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if let Some(log) = &log {
                    let _ = log.lock().unwrap().write_all(&buf[..n]);
                }
                relay::emit_all(&app, "auth-output", String::from_utf8_lossy(&buf[..n]).to_string());
            }
        });
    }

    let pid = child.id();
    *slot = Some((child, stdin));
    drop(slot);

    // Reap the process and report how it ended.
    let app2 = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let state = app2.state::<Login>();
        let mut slot = state.0.lock().unwrap();
        match slot.as_mut() {
            Some((child, _)) if child.id() == pid => match child.try_wait() {
                Ok(Some(status)) => {
                    slot.take();
                    note(&state, &format!("[exited: {status}]"));
                    relay::emit_all(&app2, "auth-exit", status.code());
                    return;
                }
                Ok(None) => continue,
                Err(_) => {
                    slot.take();
                    relay::emit_all(&app2, "auth-exit", None::<i32>);
                    return;
                }
            },
            // Cancelled or replaced by a newer login.
            _ => return,
        }
    });
    Ok(())
}

/// Sends the code from the sign-in page to the waiting `claude auth login`.
#[tauri::command]
pub fn auth_submit_code(login: State<Login>, code: String) -> Result<(), String> {
    let mut slot = login.0.lock().unwrap();
    let Some((_, stdin)) = slot.as_mut() else {
        return Err("No sign-in in progress.".into());
    };
    let code = code.trim();
    let sent = writeln!(stdin, "{code}").and_then(|_| stdin.flush()).map_err(|e| e.to_string());
    drop(slot);
    note(&login, &format!("[app wrote a {}-character code to stdin: {sent:?}]", code.len()));
    sent
}

#[tauri::command]
pub fn auth_cancel(login: State<Login>) {
    if let Some((mut child, _)) = login.0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

#[tauri::command]
pub async fn auth_logout() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = claude_command()
            .args(["auth", "logout"])
            .output()
            .map_err(|e| format!("could not run claude: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Plan usage as the CLI reports it (`/usage` runs locally: no model call, no cost). Returns the
/// text, e.g. "Current session: 24% used · resets Nov 3, 10:19pm (America/New_York)".
#[tauri::command]
pub async fn plan_usage(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let out = claude_command()
            .current_dir(dir)
            .args(["-p", "--tools", "", "--output-format", "json", "/usage"])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("could not run claude: {e}"))?;
        let v: Value = serde_json::from_slice(&out.stdout)
            .map_err(|_| format!("unexpected /usage output: {}", String::from_utf8_lossy(&out.stdout)))?;
        v["result"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "no result from /usage".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
