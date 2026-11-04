//! The LLM side of the coach. `ClaudeCli` drives `claude -p` in stream-json mode, billed to the
//! user's Claude login. Another backend (e.g. the API with a key) only needs to implement
//! `CoachBackend` and emit the same `coach-event` lines.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::relay;

pub trait CoachBackend: Send {
    fn send(&mut self, text: &str) -> Result<(), String>;
}

pub struct ClaudeCli {
    child: Child,
    stdin: ChildStdin,
}

impl ClaudeCli {
    /// `client` is the frontend that gets this process's output (see `relay`).
    pub fn spawn(
        app: &AppHandle,
        client: &str,
        mcp_url: &str,
        resume: Option<&str>,
        model: Option<&str>,
    ) -> Result<Self, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let mcp_config = dir.join("chess-tools.json");
        let config = json!({ "mcpServers": { "chess": { "type": "http", "url": mcp_url } } });
        std::fs::write(&mcp_config, config.to_string()).map_err(|e| e.to_string())?;

        let prompt_file = dir.join("coach.md");
        std::fs::write(&prompt_file, system_prompt()).map_err(|e| e.to_string())?;

        let mut cmd = claude_command();
        // Run outside the project so no project CLAUDE.md or settings leak into the coach.
        cmd.current_dir(&dir)
            .args(["-p", "--verbose", "--include-partial-messages"])
            .args(["--input-format", "stream-json", "--output-format", "stream-json"])
            .arg("--mcp-config")
            .arg(&mcp_config)
            .arg("--strict-mcp-config")
            .args(["--tools", ""])
            .args(["--allowedTools", "mcp__chess__*"])
            .arg("--system-prompt-file")
            .arg(&prompt_file)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(id) = resume {
            cmd.args(["--resume", id]);
        }
        if let Some(model) = model {
            cmd.args(["--model", model]);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", claude_exe().display()))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let (out_app, out_client) = (app.clone(), client.to_string());
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                relay::emit_to(&out_app, &out_client, "coach-event", line);
            }
            relay::emit_to(&out_app, &out_client, "coach-exit", ());
        });
        let (err_app, err_client) = (app.clone(), client.to_string());
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                relay::emit_to(&err_app, &err_client, "coach-stderr", line);
            }
        });

        Ok(Self { child, stdin })
    }
}

impl CoachBackend for ClaudeCli {
    fn send(&mut self, text: &str) -> Result<(), String> {
        let msg = json!({ "type": "user", "message": { "role": "user", "content": text } });
        writeln!(self.stdin, "{msg}")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| e.to_string())
    }
}

impl Drop for ClaudeCli {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

/// A `claude` invocation that doesn't flash a console window on Windows.
pub fn claude_command() -> Command {
    let mut cmd = Command::new(claude_exe());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// `CHESSCOACH_CLAUDE` overrides; otherwise the native installer location, then PATH.
fn claude_exe() -> PathBuf {
    if let Some(p) = std::env::var_os("CHESSCOACH_CLAUDE") {
        return p.into();
    }
    let name = if cfg!(windows) { "claude.exe" } else { "claude" };
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    if let Some(home) = home {
        let p = PathBuf::from(home).join(".local").join("bin").join(name);
        if p.exists() {
            return p;
        }
    }
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(name))
        .find(|p| p.exists())
        .unwrap_or_else(|| name.into())
}

/// In debug builds coach.md is read from the repo on every new session, so the prompt can be
/// iterated on without rebuilding. Release builds embed it.
fn system_prompt() -> String {
    #[cfg(debug_assertions)]
    if let Ok(s) = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../coach.md")) {
        return s;
    }
    include_str!("../../coach.md").to_string()
}
