//! The HTTP side of the server: every client (the desktop app and phones) reaches the database,
//! the Claude login and the coach through it.
//!
//! - `POST /api/pair` trades a pairing code for the server's token (JSON, plus a cookie for the
//!   phone's web app, which is served from here).
//! - `POST /api/invoke/{cmd}` runs a command (JSON args in, JSON result out).
//! - `GET /api/events` streams events (server-sent events).
//! - `GET /api/ping` answers without pairing, for "is the server there?".
//! - Everything else is the built frontend (`--web`), for phones.
//!
//! A client proves it's paired with the cookie (phones), an `Authorization: Bearer` header (the
//! desktop app, whose page comes from its own bundle and so can't hold the server's cookie) or,
//! for the event stream, `?token=`. Tailscale and the server's firewall are the outer wall.

use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::ctx::AppHandle;
use crate::relay::{self, Msg, Relay};
use crate::{auth, db, live, puzzles, sounds, stats};

const COOKIE: &str = "cc_auth";
/// No I/O/0/1, so codes survive being read off a screen.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/// Bumped when a command or event changes shape, so a desktop app built against another version
/// says so instead of writing what the server doesn't expect (src/backend.ts, API_VERSION).
pub const API_VERSION: u32 = 2;

#[derive(Clone, Serialize, Deserialize)]
struct Config {
    code: String,
    /// The token paired devices hold. Rotated with the code, which unpairs them.
    secret: String,
}

impl Config {
    fn fresh() -> Self {
        Self { code: new_code(), secret: uuid::Uuid::new_v4().simple().to_string() }
    }
}

pub struct Remote {
    path: PathBuf,
    config: Mutex<Config>,
    /// Wrong pairing codes since the last success, and when the last one came in.
    failures: Mutex<(u32, Instant)>,
    /// The built frontend served to phones; None serves the API only.
    web: Option<PathBuf>,
}

fn new_code() -> String {
    uuid::Uuid::new_v4().as_bytes()[..8]
        .iter()
        .map(|b| CODE_ALPHABET[*b as usize % CODE_ALPHABET.len()] as char)
        .collect()
}

impl Remote {
    /// `remote.json` in the data folder holds the code and token. The desktop app's old one works
    /// as it is (its `enabled` flag is ignored), so devices paired before the move stay paired.
    pub fn load(dir: &std::path::Path, web: Option<PathBuf>) -> Self {
        let path = dir.join("remote.json");
        let loaded = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Config>(&b).ok());
        let remote = Self {
            path,
            config: Mutex::new(loaded.clone().unwrap_or_else(Config::fresh)),
            failures: Mutex::new((0, Instant::now())),
            web,
        };
        if loaded.is_none() {
            let config = remote.config.lock().unwrap().clone();
            if let Err(e) = remote.save(config) {
                eprintln!("could not save remote.json: {e}");
            }
        }
        remote
    }

    fn save(&self, config: Config) -> Result<(), String> {
        std::fs::write(&self.path, serde_json::to_vec_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
        *self.config.lock().unwrap() = config;
        Ok(())
    }

    pub fn code(&self) -> String {
        self.config.lock().unwrap().code.clone()
    }

    /// A new code and token: every paired device has to pair again.
    pub fn rotate(&self) -> Result<String, String> {
        let config = Config::fresh();
        let code = config.code.clone();
        self.save(config)?;
        Ok(code)
    }

    fn authed(&self, headers: &HeaderMap, query_token: Option<&str>) -> bool {
        let secret = self.config.lock().unwrap().secret.clone();
        let bearer = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .is_some_and(|t| t.trim() == secret);
        let cookie = headers
            .get_all(header::COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(';'))
            .any(|c| c.trim().strip_prefix(COOKIE).and_then(|c| c.strip_prefix('=')) == Some(secret.as_str()));
        bearer || cookie || query_token == Some(secret.as_str())
    }
}

pub async fn serve(app: AppHandle, port: u16) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("could not listen on port {port}: {e}"))?;
    let router = Router::new()
        .route("/api/pair", post(pair))
        .route("/api/events", get(events))
        .route("/api/invoke/{cmd}", post(invoke))
        .route("/api/ping", get(|| async { StatusCode::NO_CONTENT }))
        .fallback(get(asset))
        .layer(axum::middleware::from_fn(cors))
        .with_state(app);
    eprintln!("chesscoach-server listening on port {port}");
    axum::serve(listener, router).await.map_err(|e| e.to_string())
}

/// The desktop app's page comes from its own bundle (another origin), so the API answers any
/// origin. That's safe because nothing rides on cookies cross-origin: the desktop sends its token.
async fn cors(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let preflight = req.method() == Method::OPTIONS;
    let mut res = if preflight { StatusCode::NO_CONTENT.into_response() } else { next.run(req).await };
    let h = res.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("authorization, content-type, x-client"));
    h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, OPTIONS"));
    h.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("86400"));
    res
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
        return (StatusCode::UNAUTHORIZED, "That code doesn't match. A paired device shows it in Settings.").into_response();
    }
    *failures = (0, Instant::now());
    // Over Tailscale's https address the cookie never travels unencrypted.
    let https = headers.get("x-forwarded-proto").is_some_and(|v| v == "https")
        || headers.get(header::HOST).and_then(|h| h.to_str().ok()).is_some_and(|h| h.ends_with(".ts.net"));
    let secure = if https { "; Secure" } else { "" };
    let cookie = format!("{COOKIE}={}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict{secure}", config.secret);
    ([(header::SET_COOKIE, cookie)], Json(json!({ "token": config.secret }))).into_response()
}

async fn events(State(app): State<AppHandle>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if !app.state::<Remote>().authed(&headers, q.get("token").map(String::as_str)) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let client = q.get("client").cloned().unwrap_or_default();
    // Set by the browser when it reconnects; a fresh page only wants what happens from now on.
    let after = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    app.state::<Relay>().saw(&client, &via(&headers));
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
    if !app.state::<Remote>().authed(&headers, None) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let client = headers
        .get("x-client")
        .and_then(|v| v.to_str().ok())
        .filter(|c| !c.is_empty())
        .unwrap_or("remote")
        .to_string();
    app.state::<Relay>().saw(&client, &via(&headers));
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

/// How a client reached the server: its Tailscale address through `tailscale serve` (which says so
/// in X-Forwarded-For), else plain http.
fn via(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map_or_else(|| "http".to_string(), |ip| format!("https from {ip}"))
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("{key}: {e}"))
}

fn out<T: Serialize>(r: Result<T, String>) -> Result<Value, String> {
    r.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

/// Every command, called with camelCase args the way the frontend's `invoke` sends them.
pub async fn dispatch(app: &AppHandle, client: &str, cmd: &str, a: &Value) -> Result<Value, String> {
    let st = || app.state::<db::Db>();
    match cmd {
        "clients" => out(Ok(app.state::<Relay>().clients())),
        "server_info" => out(Ok(json!({
            "apiVersion": API_VERSION,
            "version": env!("CARGO_PKG_VERSION"),
            "publicUrl": std::env::var("CHESSCOACH_PUBLIC_URL").ok(),
        }))),
        "pairing_code" => out(Ok(app.state::<Remote>().code())),
        "pairing_new_code" => out(app.state::<Remote>().rotate()),
        "live_get" => out(live::live_get(&st())),
        "live_update" => out(live::live_update(app, client, &arg::<String>(a, "kind")?, arg(a, "id")?, arg(a, "state")?, arg(a, "baseVersion")?)),
        "coach_send" => out(crate::send_turn(app, client, &arg::<String>(a, "text")?, arg::<Option<String>>(a, "resume")?.as_deref())),
        "coach_reset" => out(Ok(crate::reset_coach(app, client))),
        "coach_explain" => out(crate::coach::explain(app, arg(a, "prompt")?).await),
        "coach_read_board" => out(crate::coach::read_board(app, arg(a, "image")?, arg(a, "mediaType")?).await),
        "tool_result" => out(Ok(app.state::<crate::mcp::Mcp>().resolve(arg(a, "id")?, arg(a, "result")?))),
        "auth_status" => out(auth::auth_status().await),
        "auth_login" => out(auth::auth_login(app.clone(), app.state())),
        "auth_submit_code" => out(auth::auth_submit_code(app.state(), arg(a, "code")?)),
        "auth_cancel" => out(Ok(auth::auth_cancel(app.state()))),
        "auth_logout" => out(auth::auth_logout().await),
        "plan_usage" => out(auth::plan_usage(app.clone()).await),
        "sounds_folder" => out(sounds::sounds_folder(app.clone())),
        "app_boot" => out(crate::boot::app_boot(st(), arg(a, "prefer")?)),
        "db_create_game" => out(db::db_create_game(st(), arg(a, "game")?)),
        "db_update_game" => out(db::update_game_from(app, &st(), client, arg(a, "id")?, arg(a, "patch")?)),
        "db_set_moves" => out(db::db_set_moves(st(), arg(a, "gameId")?, arg(a, "moves")?)),
        "db_upsert_tangent" => out(db::db_upsert_tangent(st(), arg(a, "gameId")?, arg(a, "tangent")?)),
        "db_upsert_chat" => out(db::db_upsert_chat(st(), arg(a, "gameId")?, arg(a, "item")?)),
        "db_clear_chat" => out(db::db_clear_chat(st(), arg(a, "gameId")?)),
        "db_list_games" => out(db::db_list_games(st(), arg(a, "limit")?)),
        "db_load_game" => out(db::db_load_game(st(), arg(a, "id")?)),
        "db_delete_game" => out(db::db_delete_game(st(), arg(a, "id")?)),
        "db_prune_empty_games" => out(db::db_prune_empty_games(st(), arg(a, "keep")?)),
        "db_get_settings" => out(db::db_get_settings(st())),
        "db_set_setting" => out((|| {
            let (key, value): (String, Value) = (arg(a, "key")?, arg(a, "value")?);
            db::store_setting(&st(), &key, &value)?;
            crate::notify_setting_changed(app, client, &key, &value);
            Ok(())
        })()),
        "db_course_progress" => out(db::merge_course_progress(app, &st(), &arg::<String>(a, "id")?, arg(a, "progress")?)),
        "db_player_rating" => out(db::db_player_rating(st())),
        "db_save_analysis" => out(stats::db_save_analysis(st(), arg(a, "gameId")?, arg(a, "moves")?, arg(a, "openingName")?)),
        "db_unanalyzed_games" => out(stats::db_unanalyzed_games(st())),
        "db_profile" => out(stats::db_profile(st())),
        "db_query_games" => out(stats::db_query_games(st(), arg(a, "mode")?, arg(a, "limit")?, arg(a, "gameId")?)),
        "db_coach_query" => out(crate::coach_data::db_coach_query(st(), arg(a, "sql")?).await),
        "db_training_games" => out(stats::db_training_games(st(), arg(a, "realOnly")?, arg(a, "maxPly")?, arg(a, "limit")?)),
        "db_record_observation" => out(stats::db_record_observation(
            st(),
            arg(a, "gameId")?,
            arg(a, "tag")?,
            arg(a, "note")?,
            arg(a, "fen")?,
        )),
        "db_add_drills" => out(stats::db_add_drills(app.clone(), st(), arg(a, "drills")?)),
        "db_due_drills" => out(stats::db_due_drills(st(), arg(a, "limit")?, arg(a, "all")?, arg(a, "tag")?, arg(a, "category")?)),
        "db_drill_counts" => out(stats::db_drill_counts(st())),
        "db_set_drill_category" => out(stats::db_set_drill_category(st(), arg(a, "id")?, arg(a, "category")?)),
        "db_set_drill_lesson" => out(stats::db_set_drill_lesson(st(), arg(a, "id")?, arg(a, "lesson")?, arg(a, "category")?)),
        "db_drills_without_lesson" => out(stats::db_drills_without_lesson(st(), arg(a, "limit")?, arg(a, "version")?)),
        "db_grade_drill" => out(stats::db_grade_drill(app.clone(), st(), arg(a, "id")?, arg(a, "correct")?, arg(a, "played")?, arg(a, "ms")?)),
        "db_retire_drill" => out(stats::db_retire_drill(app.clone(), st(), arg(a, "id")?)),
        "db_drill_overview" => out(stats::db_drill_overview(st(), arg(a, "limit")?)),
        "puzzle_history" => out(stats::puzzle_history(st(), arg(a, "limit")?)),
        "db_weakness" => out(stats::db_weakness(st(), arg(a, "source")?, arg(a, "last")?)),
        "db_rating_history" => out(stats::db_rating_history(st())),
        "import_fetch" => out(crate::import::import_fetch(arg(a, "site")?, arg(a, "user")?, arg(a, "max")?, arg(a, "since")?).await),
        "db_import_known" => out(crate::import::db_import_known(st(), arg(a, "site")?)),
        "db_import_game" => out(crate::import::db_import_game(st(), arg(a, "game")?, arg(a, "moves")?)),
        "db_import_accounts" => out(crate::import::db_import_accounts(st())),
        "db_import_finish" => out(crate::import::db_import_finish(st(), arg(a, "site")?, arg(a, "account")?, arg(a, "seen")?)),
        "db_loads" => out(crate::loads::db_loads(st(), arg(a, "limit")?)),
        "db_save_load" => out(crate::loads::db_save_load(st(), arg(a, "load")?)),
        "db_update_load" => out(crate::loads::db_update_load(st(), arg(a, "id")?, arg(a, "startFen")?, arg(a, "sans")?, arg(a, "orientation")?)),
        "db_open_load" => out(crate::loads::db_open_load(st(), arg(a, "id")?)),
        "db_remove_load" => out(crate::loads::db_remove_load(st(), arg(a, "id")?)),
        "db_import_remove" => out(crate::import::db_import_remove(st(), arg(a, "site")?, arg(a, "account")?)),
        "puzzle_status" => out(puzzles::puzzle_status(st())),
        "puzzle_find" => out(puzzles::puzzle_find(st(), arg(a, "filter")?)),
        "puzzle_get" => out(puzzles::puzzle_get(st(), arg(a, "id")?)),
        "puzzle_record" => out(puzzles::puzzle_record(
            app.clone(),
            st(),
            arg(a, "id")?,
            arg(a, "rating")?,
            arg(a, "themes")?,
            arg(a, "correct")?,
            arg(a, "ms")?,
        )),
        "dev_log" => out(Ok(crate::devlog::dev_log(arg(a, "device")?, arg(a, "lines")?))),
        "puzzle_void" => out(puzzles::puzzle_void(app.clone(), st(), arg(a, "id")?, arg(a, "fen")?)),
        "puzzle_import_start" => out(puzzles::puzzle_import_start(app.clone(), app.state())),
        "puzzle_import_cancel" => out(Ok(puzzles::puzzle_import_cancel(app.state()))),
        "puzzle_import_progress" => out(Ok(puzzles::puzzle_import_progress(app.state()))),
        "game_changed" => out(Ok(crate::notify_game_changed(app, client, arg(a, "gameId")?))),
        _ => Err(format!("unknown command: {cmd}")),
    }
}

/// The built frontend, for phones. The page itself and the service worker are never cached, so
/// reopening the app always loads what the server runs now.
async fn asset(State(app): State<AppHandle>, uri: Uri) -> Response {
    let Some(web) = &app.state::<Remote>().web else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let path = match uri.path() {
        "/" => "/index.html",
        p => p,
    };
    let rel = path.trim_start_matches('/');
    if rel.split('/').any(|part| part == ".." || part.contains('\\')) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(bytes) = tokio::fs::read(web.join(rel)).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = match rel.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    let cache = match path {
        "/index.html" | "/sw.js" => "no-store",
        p if p.starts_with("/assets/") => "public, max-age=31536000, immutable",
        _ => "no-cache",
    };
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(bytes))
        .unwrap()
}
