//! Minimal MCP server (streamable HTTP transport, plain JSON responses) exposing the chess
//! tools to `claude -p`. Tool calls are forwarded to the frontend, which owns the board state,
//! chess.js and Stockfish, and answers through the `tool_result` command.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::oneshot;

use crate::{relay, tools};

/// Long enough for tools that wait on the user (e.g. `ask_move`).
const TOOL_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Clone)]
pub struct Mcp {
    pub url: String,
    inner: Arc<Inner>,
}

struct Inner {
    app: AppHandle,
    token: String,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<ToolResult>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub text: String,
    #[serde(default)]
    pub is_error: bool,
}

#[derive(Clone, Serialize)]
struct ToolCall {
    id: u64,
    name: String,
    args: Value,
}

pub async fn start(app: AppHandle) -> std::io::Result<Mcp> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    // The token keeps other local processes from driving the board.
    let token = uuid::Uuid::new_v4().simple().to_string();
    let inner = Arc::new(Inner {
        app,
        token: token.clone(),
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
    });

    let router = Router::new()
        .route(
            "/mcp/{token}",
            post(handle).get(|| async { StatusCode::METHOD_NOT_ALLOWED }),
        )
        .with_state(inner.clone());
    tauri::async_runtime::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("mcp server stopped: {e}");
        }
    });

    Ok(Mcp {
        url: format!("http://127.0.0.1:{port}/mcp/{token}"),
        inner,
    })
}

impl Mcp {
    pub fn resolve(&self, id: u64, result: ToolResult) {
        if let Some(tx) = self.inner.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(result);
        }
    }
}

async fn handle(
    State(inner): State<Arc<Inner>>,
    Path(token): Path<String>,
    Json(msg): Json<Value>,
) -> Response {
    if token != inner.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Notifications (no id) need no reply.
    let Some(id) = msg.get("id").cloned() else {
        return StatusCode::ACCEPTED.into_response();
    };
    let method = msg["method"].as_str().unwrap_or_default();
    let params = &msg["params"];

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "chess", "version": env!("CARGO_PKG_VERSION") },
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::definitions() })),
        "tools/call" => Ok(call_tool(&inner, params).await),
        _ => Err(json!({ "code": -32601, "message": format!("method not found: {method}") })),
    };

    let body = match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
    };
    Json(body).into_response()
}

async fn call_tool(inner: &Inner, params: &Value) -> Value {
    let id = inner.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    inner.pending.lock().unwrap().insert(id, tx);

    let call = ToolCall {
        id,
        name: params["name"].as_str().unwrap_or_default().to_string(),
        args: params.get("arguments").cloned().unwrap_or_else(|| json!({})),
    };
    relay::emit_owner(&inner.app, "tool-call", call);
    let outcome = match tokio::time::timeout(TOOL_TIMEOUT, rx).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(_)) => Err("tool call was dropped by the app".to_string()),
        Err(_) => Err("tool call timed out".to_string()),
    };
    inner.pending.lock().unwrap().remove(&id);

    let result = outcome.unwrap_or_else(|text| ToolResult { text, is_error: true });
    json!({
        "content": [{ "type": "text", "text": result.text }],
        "isError": result.is_error,
    })
}
