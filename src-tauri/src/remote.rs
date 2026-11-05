//! Home server for phones: serves the app itself plus an HTTP version of the Tauri commands, so a
//! phone browser (installed as a PWA) plays against the database, Claude login and coach running
//! on this computer. Off by default; turned on from Settings on the desktop.
//!
//! - `POST /api/pair` trades the pairing code shown on the desktop for a long-lived cookie.
//! - `POST /api/invoke/{cmd}` runs a command (JSON args in, JSON result out).
//! - `GET /api/events` streams the events the desktop gets as Tauri events (server-sent events).
//! - Everything else is the built frontend.

use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::relay::{self, Msg, Relay};
use crate::tailscale::{self, Tailscale};
use crate::{auth, db, puzzles, sounds, stats};

const DEFAULT_PORT: u16 = 8765;
const COOKIE: &str = "cc_auth";
/// No I/O/0/1, so codes survive being read off a screen.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(Clone, Serialize, Deserialize)]
struct Config {
    enabled: bool,
    code: String,
    /// The cookie value paired phones hold. Rotated with the code, which unpairs them.
    secret: String,
}

impl Config {
    fn fresh(enabled: bool) -> Self {
        Self { enabled, code: new_code(), secret: uuid::Uuid::new_v4().simple().to_string() }
    }
}

pub struct Remote {
    path: PathBuf,
    port: u16,
    config: Mutex<Config>,
    server: Mutex<Option<JoinHandle<()>>>,
    /// Wrong pairing codes since the last success, and when the last one came in.
    failures: Mutex<(u32, Instant)>,
}

fn new_code() -> String {
    uuid::Uuid::new_v4().as_bytes()[..8]
        .iter()
        .map(|b| CODE_ALPHABET[*b as usize % CODE_ALPHABET.len()] as char)
        .collect()
}

impl Remote {
    pub fn load(dir: &std::path::Path) -> Self {
        let path = dir.join("remote.json");
        let loaded = std::fs::read(&path)
            .map_err(|e| e.to_string())
            .and_then(|b| serde_json::from_slice::<Config>(&b).map_err(|e| e.to_string()));
        let problem = loaded.as_ref().err().cloned();
        let config = loaded.unwrap_or_else(|_| Config::fresh(false));
        let port = std::env::var("CHESSCOACH_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT);
        let remote = Self {
            path,
            port,
            config: Mutex::new(config),
            server: Mutex::new(None),
            failures: Mutex::new((0, Instant::now())),
        };
        if let Some(problem) = problem {
            remote.log(&format!("remote.json not loaded ({problem}), starting with phone access off"));
        }
        remote
    }

    fn save(&self, config: Config) -> Result<(), String> {
        std::fs::write(&self.path, serde_json::to_vec_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
        *self.config.lock().unwrap() = config;
        Ok(())
    }

    /// Appends to phone-server.log next to remote.json, for "why can't my phone connect?".
    fn log(&self, text: &str) {
        use std::io::Write;
        let path = self.path.with_file_name("phone-server.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            let _ = writeln!(f, "[{secs}] {text}");
        }
    }

    fn running(&self) -> bool {
        self.server.lock().unwrap().is_some()
    }

    fn authed(&self, headers: &HeaderMap) -> bool {
        let secret = self.config.lock().unwrap().secret.clone();
        headers
            .get_all(header::COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(';'))
            .any(|c| c.trim().strip_prefix(COOKIE).and_then(|c| c.strip_prefix('=')) == Some(secret.as_str()))
    }
}

/// Starts the server if it was left on.
pub async fn start_if_enabled(app: &AppHandle) {
    let remote = app.state::<Remote>();
    if !remote.config.lock().unwrap().enabled {
        remote.log("phone access is off");
        return;
    }
    // After a restart (tauri dev rebuilds), the old process can hold the port for a moment.
    for attempt in 1..=20 {
        match start(app).await {
            Ok(()) => return,
            Err(e) if attempt == 20 => remote.log(&format!("not started: {e}")),
            Err(e) => {
                remote.log(&format!("attempt {attempt}: {e}"));
                tokio::time::sleep(Duration::from_millis(500)).await
            }
        }
    }
}

async fn start(app: &AppHandle) -> Result<(), String> {
    let remote = app.state::<Remote>();
    if remote.running() {
        return Ok(());
    }
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", remote.port))
        .await
        .map_err(|e| format!("could not listen on port {}: {e}", remote.port))?;
    let router = Router::new()
        .route("/api/pair", post(pair))
        .route("/api/events", get(events))
        .route("/api/invoke/{cmd}", post(invoke))
        .fallback(get(page))
        .with_state(app.clone());
    remote.log(&format!("listening on port {}", remote.port));
    let log_app = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let result = axum::serve(listener, router).await;
        log_app.state::<Remote>().log(&format!("stopped: {result:?}"));
    });
    *remote.server.lock().unwrap() = Some(handle);
    Ok(())
}

fn stop(app: &AppHandle) {
    if let Some(handle) = app.state::<Remote>().server.lock().unwrap().take() {
        handle.abort();
    }
}

// Desktop-only commands (not reachable over HTTP).

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    enabled: bool,
    running: bool,
    port: u16,
    code: String,
    /// Addresses a phone on the same network can open.
    urls: Vec<String>,
    /// For playing away from home; None when Tailscale isn't installed.
    tailscale: Option<Tailscale>,
}

async fn info(app: &AppHandle) -> RemoteInfo {
    let remote = app.state::<Remote>();
    let config = remote.config.lock().unwrap().clone();
    let (port, running) = (remote.port, remote.running());
    let mut urls = Vec::new();
    if let Some(ip) = lan_ip() {
        urls.push(format!("http://{ip}:{port}"));
    }
    if let Ok(host) = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")) {
        urls.push(format!("http://{}:{port}", host.to_lowercase()));
    }
    let tailscale = tauri::async_runtime::spawn_blocking(move || tailscale::status(port)).await.ok().flatten();
    RemoteInfo { enabled: config.enabled, running, port, code: config.code, urls, tailscale }
}

/// The address this computer uses on its network (no packets are sent).
fn lan_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip())
}

#[tauri::command]
pub async fn remote_info(app: AppHandle) -> RemoteInfo {
    info(&app).await
}

#[tauri::command]
pub async fn remote_set_enabled(app: AppHandle, enabled: bool) -> Result<RemoteInfo, String> {
    if enabled {
        start(&app).await?;
    } else {
        stop(&app);
    }
    let remote = app.state::<Remote>();
    let config = Config { enabled, ..remote.config.lock().unwrap().clone() };
    remote.save(config)?;
    Ok(info(&app).await)
}

/// New pairing code; every paired phone has to pair again.
#[tauri::command]
pub async fn remote_new_code(app: AppHandle) -> Result<RemoteInfo, String> {
    let remote = app.state::<Remote>();
    let enabled = remote.config.lock().unwrap().enabled;
    remote.save(Config::fresh(enabled))?;
    Ok(info(&app).await)
}

/// Points this computer's Tailscale https address at the phone server (see tailscale.rs).
#[tauri::command]
pub async fn remote_tailscale_serve(app: AppHandle) -> Result<RemoteInfo, String> {
    let port = app.state::<Remote>().port;
    tauri::async_runtime::spawn_blocking(move || tailscale::serve(port))
        .await
        .map_err(|e| e.to_string())??;
    Ok(info(&app).await)
}

// HTTP handlers.

#[derive(Deserialize)]
struct PairRequest {
    code: String,
}

async fn pair(State(app): State<AppHandle>, headers: HeaderMap, Json(req): Json<PairRequest>) -> Response {
    let remote = app.state::<Remote>();
    let mut failures = remote.failures.lock().unwrap();
    if failures.0 >= 5 && failures.1.elapsed() < Duration::from_secs(60) {
        return (StatusCode::TOO_MANY_REQUESTS, "Too many wrong codes. Wait a minute and try again.").into_response();
    }
    let code: String = req.code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    let config = remote.config.lock().unwrap().clone();
    if code != config.code {
        *failures = (failures.0 + 1, Instant::now());
        return (StatusCode::UNAUTHORIZED, "That code doesn't match the one in Settings on your computer.").into_response();
    }
    *failures = (0, Instant::now());
    // Over Tailscale's https address the cookie never travels unencrypted.
    let https = headers.get("x-forwarded-proto").is_some_and(|v| v == "https")
        || headers.get(header::HOST).and_then(|h| h.to_str().ok()).is_some_and(|h| h.ends_with(".ts.net"));
    let secure = if https { "; Secure" } else { "" };
    let cookie = format!("{COOKIE}={}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict{secure}", config.secret);
    ([(header::SET_COOKIE, cookie)], StatusCode::NO_CONTENT).into_response()
}

async fn events(State(app): State<AppHandle>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if !app.state::<Remote>().authed(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let client = q.get("client").cloned().unwrap_or_default();
    // Set by the browser when it reconnects; a fresh page only wants what happens from now on.
    let after = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let (missed, latest, rx) = app.state::<Relay>().subscribe(&client, after);
    let last = missed.last().map_or(latest, |m| m.seq).max(after.unwrap_or(0));

    // The hello carries an id so a reconnect resumes from here.
    let hello = Event::default().id(latest.to_string()).event("hello").data("{}");
    let backlog: Vec<_> = std::iter::once(hello).chain(missed.iter().map(to_event)).map(Ok::<_, Infallible>).collect();
    let live = BroadcastStream::new(rx).filter_map(move |m| match m {
        Ok(m) if m.seq > last && relay::wants(&m, &client) => Some(Ok(to_event(&m))),
        _ => None,
    });
    Sse::new(tokio_stream::iter(backlog).chain(live))
        .keep_alive(KeepAlive::default())
        .into_response()
}

fn to_event(m: &Msg) -> Event {
    Event::default().id(m.seq.to_string()).data(serde_json::to_string(m).unwrap_or_default())
}

async fn invoke(State(app): State<AppHandle>, Path(cmd): Path<String>, headers: HeaderMap, Json(args): Json<Value>) -> Response {
    if !app.state::<Remote>().authed(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let client = headers
        .get("x-client")
        .and_then(|v| v.to_str().ok())
        .filter(|c| !c.is_empty() && *c != relay::DESKTOP)
        .unwrap_or("remote")
        .to_string();
    if cmd == "custom_sound" {
        return match arg::<String>(&args, "name").and_then(|name| sounds::read_sound(&app, &name)) {
            Ok(bytes) => ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response(),
            Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
        };
    }
    match dispatch(&app, &client, &cmd, &args).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("{key}: {e}"))
}

fn out<T: Serialize>(r: Result<T, String>) -> Result<Value, String> {
    r.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

/// The Tauri commands, called with camelCase args the way `invoke` sends them.
async fn dispatch(app: &AppHandle, client: &str, cmd: &str, a: &Value) -> Result<Value, String> {
    let st = || app.state::<db::Db>();
    match cmd {
        "coach_send" => out(crate::send_turn(app, client, &arg::<String>(a, "text")?, arg::<Option<String>>(a, "resume")?.as_deref())),
        "coach_reset" => out(Ok(crate::reset_coach(app, client))),
        "tool_result" => out(Ok(app.state::<crate::mcp::Mcp>().resolve(arg(a, "id")?, arg(a, "result")?))),
        "auth_status" => out(auth::auth_status().await),
        "auth_login" => out(auth::auth_login(app.clone(), app.state())),
        "auth_submit_code" => out(auth::auth_submit_code(app.state(), arg(a, "code")?)),
        "auth_cancel" => out(Ok(auth::auth_cancel(app.state()))),
        "auth_logout" => out(auth::auth_logout().await),
        "plan_usage" => out(auth::plan_usage(app.clone()).await),
        "sounds_folder" => out(sounds::sounds_folder(app.clone())),
        "db_create_game" => out(db::db_create_game(st(), arg(a, "game")?)),
        "db_update_game" => out(db::db_update_game(st(), arg(a, "id")?, arg(a, "patch")?)),
        "db_set_moves" => out(db::db_set_moves(st(), arg(a, "gameId")?, arg(a, "moves")?)),
        "db_upsert_tangent" => out(db::db_upsert_tangent(st(), arg(a, "gameId")?, arg(a, "tangent")?)),
        "db_upsert_chat" => out(db::db_upsert_chat(st(), arg(a, "gameId")?, arg(a, "item")?)),
        "db_list_games" => out(db::db_list_games(st(), arg(a, "limit")?)),
        "db_load_game" => out(db::db_load_game(st(), arg(a, "id")?)),
        "db_delete_game" => out(db::db_delete_game(st(), arg(a, "id")?)),
        "db_prune_empty_games" => out(db::db_prune_empty_games(st(), arg(a, "keep")?)),
        "db_get_settings" => out(db::db_get_settings(st())),
        "db_set_setting" => out(db::db_set_setting(st(), arg(a, "key")?, arg(a, "value")?)),
        "db_save_analysis" => out(stats::db_save_analysis(st(), arg(a, "gameId")?, arg(a, "moves")?, arg(a, "openingName")?)),
        "db_unanalyzed_games" => out(stats::db_unanalyzed_games(st())),
        "db_profile" => out(stats::db_profile(st())),
        "db_query_games" => out(stats::db_query_games(st(), arg(a, "mode")?, arg(a, "limit")?, arg(a, "gameId")?)),
        "db_record_observation" => out(stats::db_record_observation(
            st(),
            arg(a, "gameId")?,
            arg(a, "tag")?,
            arg(a, "note")?,
            arg(a, "fen")?,
        )),
        "db_add_drills" => out(stats::db_add_drills(st(), arg(a, "drills")?)),
        "db_due_drills" => out(stats::db_due_drills(st(), arg(a, "limit")?, arg(a, "all")?)),
        "db_drill_counts" => out(stats::db_drill_counts(st())),
        "db_grade_drill" => out(stats::db_grade_drill(st(), arg(a, "id")?, arg(a, "correct")?, arg(a, "played")?, arg(a, "ms")?)),
        "db_retire_drill" => out(stats::db_retire_drill(st(), arg(a, "id")?)),
        "db_drill_overview" => out(stats::db_drill_overview(st(), arg(a, "limit")?)),
        "puzzle_history" => out(stats::puzzle_history(st(), arg(a, "limit")?)),
        "db_repertoire" => out(stats::db_repertoire(st())),
        "db_add_repertoire" => out(stats::db_add_repertoire(st(), arg(a, "line")?)),
        "db_remove_repertoire" => out(stats::db_remove_repertoire(st(), arg(a, "id")?)),
        "puzzle_status" => out(puzzles::puzzle_status(st())),
        "puzzle_find" => out(puzzles::puzzle_find(st(), arg(a, "filter")?)),
        "puzzle_record" => out(puzzles::puzzle_record(
            st(),
            arg(a, "id")?,
            arg(a, "rating")?,
            arg(a, "themes")?,
            arg(a, "correct")?,
            arg(a, "ms")?,
        )),
        "puzzle_import_start" => out(puzzles::puzzle_import_start(app.clone(), app.state())),
        "puzzle_import_cancel" => out(Ok(puzzles::puzzle_import_cancel(app.state()))),
        "game_changed" => out(Ok(crate::notify_game_changed(app, client, arg(a, "gameId")?))),
        _ => Err(format!("unknown command: {cmd}")),
    }
}

/// Everything that isn't the API: the frontend, plus (under `tauri dev`) Vite's live-reload socket.
async fn page(State(app): State<AppHandle>, req: axum::extract::Request) -> Response {
    #[cfg(debug_assertions)]
    if req.headers().get(header::UPGRADE).is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"websocket")) {
        if !app.state::<Remote>().authed(req.headers()) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
        return dev_socket(&app, req).await.unwrap_or_else(|e| (StatusCode::BAD_GATEWAY, e).into_response());
    }
    asset(&app, req.uri()).await
}

/// The frontend, from the same assets the desktop window uses. index.html gets a flag so the
/// frontend knows to talk HTTP instead of Tauri IPC.
async fn asset(app: &AppHandle, uri: &Uri) -> Response {
    let path = match uri.path() {
        "/" => "/index.html",
        p => p,
    };
    // Under `tauri dev`, phones get the live frontend from Vite, like the desktop window does.
    #[cfg(debug_assertions)]
    if let Some(res) = from_dev_server(app, uri).await {
        return res;
    }
    let Some(asset) = app.asset_resolver().get(path.to_string()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = match path.rsplit('.').next() {
        Some("wasm") => "application/wasm",
        Some("webmanifest") => "application/manifest+json",
        Some("js" | "mjs") => "text/javascript",
        _ => asset.mime_type(),
    }
    .to_string();
    // The page itself is never kept, so reopening the app always loads what the computer runs now.
    let cache = match path {
        "/index.html" | "/sw.js" => "no-store",
        p if p.starts_with("/assets/") => "public, max-age=31536000, immutable",
        _ => "no-cache",
    };
    let mut bytes = asset.bytes;
    if path == "/index.html" {
        bytes = with_remote_flag(&bytes);
    }
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(bytes))
        .unwrap()
}

fn with_remote_flag(html: &[u8]) -> Vec<u8> {
    String::from_utf8_lossy(html)
        .replacen("<head>", "<head><script>window.__CC_REMOTE__=true</script>", 1)
        .into_bytes()
}

/// Proxies to the Vite dev server (devUrl). None when it isn't running, so the built `dist/` is
/// served instead.
#[cfg(debug_assertions)]
async fn from_dev_server(app: &AppHandle, uri: &Uri) -> Option<Response> {
    let base = app.config().build.dev_url.clone()?;
    let url = format!("{}{}", base.as_str().trim_end_matches('/'), uri.path_and_query().map_or("/", |p| p.as_str()));
    let html = uri.path() == "/" || uri.path() == "/index.html";
    tauri::async_runtime::spawn_blocking(move || {
        let mut res = ureq::get(&url).call().ok()?;
        let mime = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string();
        let mut body = res.body_mut().with_config().limit(256 * 1024 * 1024).read_to_vec().ok()?;
        if html {
            body = with_remote_flag(&body);
        }
        Some(
            Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .header(header::CACHE_CONTROL, if html { "no-store" } else { "no-cache" })
                .body(Body::from(body))
                .unwrap(),
        )
    })
    .await
    .ok()
    .flatten()
}

/// Passes Vite's HMR websocket through to the dev server, so a phone picks up code changes the
/// moment they're saved (and reloads by itself after a restart) instead of showing stale code.
#[cfg(debug_assertions)]
async fn dev_socket(app: &AppHandle, req: axum::extract::Request) -> Result<Response, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let base = app.config().build.dev_url.clone().ok_or("no dev server")?;
    let host = format!("{}:{}", base.host_str().unwrap_or("localhost"), base.port_or_known_default().unwrap_or(80));
    let mut upstream = tokio::net::TcpStream::connect(&host).await.map_err(|e| e.to_string())?;

    // Same handshake, addressed to Vite as if the page had been opened there.
    let target = req.uri().path_and_query().map_or("/", |p| p.as_str());
    let origin = base.origin().ascii_serialization();
    let mut head = format!("GET {target} HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\n");
    for (name, value) in req.headers() {
        if name != header::HOST && name != header::ORIGIN && name != header::COOKIE {
            head.push_str(&format!("{name}: {}\r\n", value.to_str().unwrap_or_default()));
        }
    }
    head.push_str("\r\n");
    upstream.write_all(head.as_bytes()).await.map_err(|e| e.to_string())?;

    // Vite's answer: headers up to the blank line, then possibly the first frames.
    let mut buf = Vec::new();
    let end = loop {
        let mut chunk = [0u8; 4096];
        let n = upstream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("dev server closed the connection".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
    };
    let text = String::from_utf8_lossy(&buf[..end]).to_string();
    let mut lines = text.split("\r\n");
    let status = lines.next().and_then(|l| l.split(' ').nth(1)).and_then(|c| c.parse::<u16>().ok()).unwrap_or(502);
    let mut res = Response::builder().status(status);
    for line in lines.filter(|l| !l.is_empty()) {
        if let Some((k, v)) = line.split_once(':') {
            res = res.header(k.trim(), v.trim());
        }
    }
    if status != 101 {
        return res.body(Body::empty()).map_err(|e| e.to_string());
    }
    let early = buf[end..].to_vec();
    tauri::async_runtime::spawn(async move {
        let Ok(upgraded) = hyper::upgrade::on(req).await else { return };
        let mut phone = hyper_util::rt::TokioIo::new(upgraded);
        if phone.write_all(&early).await.is_ok() {
            let _ = tokio::io::copy_bidirectional(&mut phone, &mut upstream).await;
        }
    });
    res.body(Body::empty()).map_err(|e| e.to_string())
}
