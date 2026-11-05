//! Reaching the phone server from anywhere. Tailscale puts the phone and this computer on a
//! private network only the student's own devices can join, and `tailscale serve` gives the
//! server an https address there (https://<computer>.<tailnet>.ts.net). Https is also what a
//! phone needs to install the app. Nothing is exposed to the open internet.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tailscale {
    /// "Running" when signed in and connected; otherwise e.g. "NeedsLogin" or "Stopped".
    pub state: String,
    /// This computer's https address on the tailnet.
    pub url: Option<String>,
    /// Whether `tailscale serve` already forwards that address to the phone server.
    pub serving: bool,
}

fn exe() -> Option<PathBuf> {
    let name = if cfg!(windows) { "tailscale.exe" } else { "tailscale" };
    let installed = PathBuf::from(r"C:\Program Files\Tailscale").join(name);
    if cfg!(windows) && installed.exists() {
        return Some(installed);
    }
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(name))
        .find(|p| p.exists())
}

/// A `tailscale` invocation that doesn't flash a console window on Windows.
fn command(exe: &PathBuf) -> Command {
    let mut cmd = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(Stdio::null());
    cmd
}

fn json(exe: &PathBuf, args: &[&str]) -> Option<Value> {
    let out = command(exe).args(args).output().ok()?;
    serde_json::from_slice(&out.stdout).ok()
}

/// None when Tailscale isn't installed. Blocks while `tailscale` runs (well under a second).
pub fn status(port: u16) -> Option<Tailscale> {
    let exe = exe()?;
    let st = json(&exe, &["status", "--json"]);
    let state = st
        .as_ref()
        .and_then(|s| s["BackendState"].as_str())
        .unwrap_or("Unknown")
        .to_string();
    let url = st
        .as_ref()
        .and_then(|s| s["Self"]["DNSName"].as_str())
        .map(|d| d.trim_end_matches('.'))
        .filter(|d| !d.is_empty())
        .map(|d| format!("https://{d}"));
    let serving = json(&exe, &["serve", "status", "--json"]).is_some_and(|v| proxies_to(&v, port));
    Some(Tailscale { state, url, serving })
}

/// Whether any handler in `tailscale serve status --json` proxies to `port` on this computer.
fn proxies_to(v: &Value, port: u16) -> bool {
    match v {
        Value::Object(map) => map.iter().any(|(k, v)| {
            (k == "Proxy" && v.as_str().is_some_and(|p| p.trim_end_matches('/').ends_with(&format!(":{port}"))))
                || proxies_to(v, port)
        }),
        Value::Array(items) => items.iter().any(|v| proxies_to(v, port)),
        _ => false,
    }
}

/// Runs `tailscale serve --bg <port>`, which keeps forwarding across restarts. The first time,
/// Tailscale may need https turned on for the tailnet: it prints a login.tailscale.com link and
/// waits, so after a while this gives up and returns that output (link included) as the error.
pub fn serve(port: u16) -> Result<(), String> {
    let exe = exe().ok_or("Tailscale isn't installed on this computer.")?;
    let mut child = command(&exe)
        .args(["serve", "--bg", &port.to_string()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run tailscale: {e}"))?;

    let output = Arc::new(Mutex::new(String::new()));
    let readers: Vec<_> = [
        Box::new(child.stdout.take().unwrap()) as Box<dyn Read + Send>,
        Box::new(child.stderr.take().unwrap()),
    ]
    .into_iter()
    .map(|mut stream| {
        let output = output.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            while let Ok(n) = stream.read(&mut buf) {
                if n == 0 {
                    break;
                }
                output.lock().unwrap().push_str(&String::from_utf8_lossy(&buf[..n]));
            }
        })
    })
    .collect();

    let deadline = Instant::now() + Duration::from_secs(20);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(200)),
            _ => {
                let _ = child.kill();
                break None;
            }
        }
    };
    for r in readers {
        let _ = r.join();
    }
    let text = output.lock().unwrap().trim().to_string();
    match status {
        Some(s) if s.success() => Ok(()),
        Some(_) => Err(if text.is_empty() { "tailscale serve failed".into() } else { text }),
        None => Err(if text.is_empty() { "tailscale serve didn't finish".into() } else { text }),
    }
}

#[cfg(test)]
mod tests {
    use super::proxies_to;
    use serde_json::json;

    #[test]
    fn finds_the_proxy_in_serve_status() {
        let status = json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "desktop.tail1234.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:8765" } } } }
        });
        assert!(proxies_to(&status, 8765));
        assert!(!proxies_to(&status, 8766));
        assert!(!proxies_to(&json!({}), 8765));
    }
}
