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
        let config = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_else(|| Config::fresh(false));
        let port = std::env::var("CHESSCOACH_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT);
        Self {
            path,
            port,
            config: Mutex::new(config),
            server: Mutex::new(None),
            failures: Mutex::new((0, Instant::now())),
        }
    }

    fn save(&self, config: Config) -> Result<(), String> {
        std::fs::write(&self.path, serde_json::to_vec_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
        *self.config.lock().unwrap() = config;
        Ok(())
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
    if app.state::<Remote>().config.lock().unwrap().enabled {
        if let Err(e) = start(app).await {
            eprintln!("phone access not started: {e}");
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
        .fallback(get(asset))
        .with_state(app.clone());
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("phone server stopped: {e}");
        }
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
}

fn info(app: &AppHandle) -> RemoteInfo {
    let remote = app.state::<Remote>();
    let config = remote.config.lock().unwrap().clone();
    let mut urls = Vec::new();
    if let Some(ip) = lan_ip() {
        urls.push(format!("http://{ip}:{}", remote.port));
    }
    if let Ok(host) = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")) {
        urls.push(format!("http://{}:{}", host.to_lowercase(), remote.port));
    }
    RemoteInfo { enabled: config.enabled, running: remote.running(), port: remote.port, code: config.code, urls }
}

/// The address this computer uses on its network (no packets are sent).
fn lan_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip())
}

#[tauri::command]
pub fn remote_info(app: AppHandle) -> RemoteInfo {
    info(&app)
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
    Ok(info(&app))
}

/// New pairing code; every paired phone has to pair again.
#[tauri::command]
pub fn remote_new_code(app: AppHandle) -> Result<RemoteInfo, String> {
    let remote = app.state::<Remote>();
    let enabled = remote.config.lock().unwrap().enabled;
    remote.save(Config::fresh(enabled))?;
    Ok(info(&app))
}

// HTTP handlers.

#[derive(Deserialize)]
struct PairRequest {
    code: String,
}

async fn pair(State(app): State<AppHandle>, Json(req): Json<PairRequest>) -> Response {
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
    let cookie = format!("{COOKIE}={}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict", config.secret);
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
        _ => Err(format!("unknown command: {cmd}")),
    }
}

/// The built frontend, from the same assets the desktop window uses. index.html gets a flag so
/// the frontend knows to talk HTTP instead of Tauri IPC.
async fn asset(State(app): State<AppHandle>, uri: Uri) -> Response {
    let path = match uri.path() {
        "/" => "/index.html",
        p => p,
    };
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
    let cache = if path.starts_with("/assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    let mut bytes = asset.bytes;
    if path == "/index.html" {
        let html = String::from_utf8_lossy(&bytes).replacen("<head>", "<head><script>window.__CC_REMOTE__=true</script>", 1);
        bytes = html.into_bytes();
    }
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(bytes))
        .unwrap()
}
