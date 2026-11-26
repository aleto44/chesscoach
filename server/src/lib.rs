//! Chess Coach's server: the database, the coach and the HTTP API every client talks to
//! (docs/server-migration.md). The desktop app and phones are both clients of it.

pub mod auth;
pub mod boot;
pub mod coach;
pub mod coach_data;
pub mod ctx;
pub mod db;
pub mod devlog;
pub mod import;
pub mod live;
pub mod loads;
pub mod mcp;
pub mod puzzles;
pub mod relay;
pub mod remote;
pub mod sounds;
pub mod stats;
pub mod tools;

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use coach::{ClaudeCli, CoachBackend};
use ctx::{AppHandle, Ctx, Inner};
use mcp::Mcp;
use relay::Relay;

/// The coach process and the client (see `relay`) it belongs to.
#[derive(Default)]
pub struct Coach(Mutex<Option<(String, Box<dyn CoachBackend>)>>);

/// Opens the database in `data` and starts the coach's tool server; the HTTP API is `remote::serve`.
pub async fn start(data: PathBuf, web: Option<PathBuf>) -> Result<Ctx, String> {
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let db = db::Db::open(&data.join("chesscoach.db")).map_err(|e| format!("could not open the database: {e}"))?;
    let ctx = Ctx::new(Inner {
        remote: remote::Remote::load(&data, web),
        data_dir: data,
        db,
        relay: Relay::default(),
        coach: Coach::default(),
        login: auth::Login::default(),
        import: puzzles::Import::default(),
        mcp: OnceLock::new(),
    });
    let mcp = mcp::start(ctx.clone()).await.map_err(|e| format!("could not start the coach's tools: {e}"))?;
    let _ = ctx.0.mcp.set(mcp);
    Ok(ctx)
}

/// Sends a user turn for `client`, starting the backend as needed: on first use, after a crash,
/// or when the turn comes from a different client than the running process belongs to (then
/// the process restarts resuming that client's own conversation).
pub(crate) fn send_turn(app: &AppHandle, client: &str, text: &str, resume: Option<&str>) -> Result<(), String> {
    let coach = app.state::<Coach>();
    let mut backend = coach.0.lock().unwrap();
    if let Some((owner, b)) = backend.as_mut() {
        if owner == client && b.send(text).is_ok() {
            return Ok(());
        }
    }
    backend.take();
    app.state::<Relay>().set_owner(client);
    let model = app.state::<db::Db>().setting("coachModel");
    let model = model.as_ref().and_then(|m| m.as_str()).filter(|m| !m.is_empty());
    let mut fresh = ClaudeCli::spawn(app, client, &app.state::<Mcp>().url, resume, model)?;
    fresh.send(text)?;
    *backend = Some((client.to_string(), Box::new(fresh)));
    Ok(())
}

/// Ends `client`'s coach process; another client's is left alone.
pub(crate) fn reset_coach(app: &AppHandle, client: &str) {
    let coach = app.state::<Coach>();
    let mut backend = coach.0.lock().unwrap();
    if backend.as_ref().is_some_and(|(owner, _)| owner == client) {
        backend.take();
    }
}

/// Tells the other devices that `client` saved changes to a game, so they reload it.
pub(crate) fn notify_game_changed(app: &AppHandle, client: &str, game_id: i64) {
    relay::emit_all(app, "game-changed", serde_json::json!({ "gameId": game_id, "from": client }));
}

/// Tells every device that puzzle or drill progress changed, so they refresh the rating and due
/// counts they loaded at startup. The device that made the change refreshes too: one cheap call.
pub(crate) fn notify_data_changed(app: &AppHandle, kind: &str) {
    relay::emit_all(app, "data-changed", serde_json::json!({ "kind": kind }));
}

/// Tells the other devices that `client` saved a setting, so they take the new value.
pub(crate) fn notify_setting_changed(app: &AppHandle, client: &str, key: &str, value: &serde_json::Value) {
    relay::emit_all(app, "setting-changed", serde_json::json!({ "key": key, "value": value, "from": client }));
}
