//! Event delivery to every connected client (the desktop app and phones alike) as server-sent
//! events (see `remote.rs`). The coach belongs to one client at a time, the one that last sent it
//! a turn; its stream and tool calls go only there.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::ctx::AppHandle;
use tokio::sync::broadcast;

/// Events kept for replay when a client's connection drops (screen off, Wi-Fi hiccup).
const BACKLOG: usize = 2000;

#[derive(Clone, Serialize)]
pub struct Msg {
    #[serde(skip)]
    pub seq: u64,
    /// None: every client.
    #[serde(skip)]
    pub to: Option<String>,
    pub event: String,
    pub payload: Value,
}

pub struct Relay {
    tx: broadcast::Sender<Msg>,
    log: Mutex<(u64, VecDeque<Msg>)>,
    owner: Mutex<String>,
}

impl Default for Relay {
    fn default() -> Self {
        Self {
            tx: broadcast::channel(256).0,
            log: Mutex::new((0, VecDeque::new())),
            owner: Mutex::new(String::new()),
        }
    }
}

impl Relay {
    pub fn owner(&self) -> String {
        self.owner.lock().unwrap().clone()
    }

    pub fn set_owner(&self, client: &str) {
        *self.owner.lock().unwrap() = client.to_string();
    }

    fn push(&self, to: Option<String>, event: &str, payload: Value) {
        let mut log = self.log.lock().unwrap();
        log.0 += 1;
        let msg = Msg { seq: log.0, to, event: event.to_string(), payload };
        log.1.push_back(msg.clone());
        if log.1.len() > BACKLOG {
            log.1.pop_front();
        }
        // Sent under the lock so replay and live delivery agree on order.
        let _ = self.tx.send(msg);
    }

    /// A live feed, the latest seq, and (when reconnecting after `after`) what `client` missed.
    pub fn subscribe(&self, client: &str, after: Option<u64>) -> (Vec<Msg>, u64, broadcast::Receiver<Msg>) {
        let log = self.log.lock().unwrap();
        let rx = self.tx.subscribe();
        let missed = match after {
            Some(after) => log.1.iter().filter(|m| m.seq > after && wants(m, client)).cloned().collect(),
            None => Vec::new(),
        };
        (missed, log.0, rx)
    }
}

pub fn wants(msg: &Msg, client: &str) -> bool {
    msg.to.as_deref().is_none_or(|to| to == client)
}

/// To every client.
pub fn emit_all<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Ok(v) = serde_json::to_value(payload) {
        app.state::<Relay>().push(None, event, v);
    }
}

/// To one client.
pub fn emit_to<S: Serialize + Clone>(app: &AppHandle, client: &str, event: &str, payload: S) {
    if let Ok(v) = serde_json::to_value(payload) {
        app.state::<Relay>().push(Some(client.to_string()), event, v);
    }
}

/// To whichever client owns the coach right now.
pub fn emit_owner<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let owner = app.state::<Relay>().owner();
    emit_to(app, &owner, event, payload);
}
