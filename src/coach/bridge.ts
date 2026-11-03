// Frontend end of the coach: sends user turns to the backend, renders its stream-json output,
// and answers tool calls coming in through the MCP server.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatMoves } from "../chess/line";
import { gameDescription, newId, pushChat, screen, updateChat, useStore } from "../store";
import { useSettings } from "../settings";
import { describeCall, handleTool } from "./tools";

let streamingId: string | null = null;
const stderrTail: string[] = [];

/** Call once at startup (outside React, so StrictMode doesn't double-register). */
export function initBridge() {
  // Plain-browser dev (vite only): the board works, the coach doesn't.
  if (!("__TAURI_INTERNALS__" in window)) return;
  listen<string>("coach-event", (e) => {
    let msg;
    try {
      msg = JSON.parse(e.payload);
    } catch {
      return;
    }
    onEvent(msg);
  });
  listen<string>("coach-stderr", (e) => {
    stderrTail.push(e.payload);
    if (stderrTail.length > 20) stderrTail.shift();
    console.warn("[claude]", e.payload);
  });
  listen("coach-exit", () => {
    if (useStore.getState().busy) {
      finishTurn();
      const tail = stderrTail.slice(-5).join("\n");
      pushChat({ kind: "system", id: newId("c"), error: true, text: `The coach process exited.${tail ? `\n${tail}` : ""}` });
    }
  });
  listen<{ id: number; name: string; args: Record<string, unknown> }>("tool-call", async (e) => {
    const { id, name, args } = e.payload;
    const logId = newId("c");
    pushChat({ kind: "tool", id: logId, text: describeCall(name, args), status: "running" });
    const result = await handleTool(name, args);
    updateChat(logId, { status: result.isError ? "error" : "ok", detail: result.isError ? result.text : undefined });
    await invoke("tool_result", { id, result: { text: result.text, isError: !!result.isError } });
  });
}

// See https://code.claude.com/docs/en/headless for the stream-json event shapes.
function onEvent(msg: any) {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        useStore.setState({ sessionId: msg.session_id });
        useSettings.setState({ activeModel: msg.model ?? null });
      }
      break;
    case "stream_event": {
      const ev = msg.event;
      if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
        streamingId = newId("c");
        pushChat({ kind: "coach", id: streamingId, text: ev.content_block.text ?? "" });
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && streamingId) {
        const id = streamingId;
        useStore.setState((s) => ({
          chat: s.chat.map((c) => (c.id === id && c.kind === "coach" ? { ...c, text: c.text + ev.delta.text } : c)),
        }));
      } else if (ev.type === "content_block_stop") {
        streamingId = null;
      }
      break;
    }
    case "result":
      finishTurn();
      if (msg.is_error || msg.subtype !== "success") {
        pushChat({ kind: "system", id: newId("c"), error: true, text: `Coach error: ${msg.result ?? msg.subtype}` });
      }
      break;
  }
}

function finishTurn() {
  streamingId = null;
  useStore.setState({ busy: false });
}

/** Prefix each turn with a compact view of the screen so the coach rarely needs get_state. */
function withContext(text: string): string {
  const { line, ply, tangent } = screen();
  const from = Math.max(0, ply - 6);
  const recent = ply > 0 ? formatMoves(line, from, ply) : "(none)";
  const where = tangent ? `tangent board "${tangent.title}"` : "main game";
  return `<screen>\nGame: ${gameDescription()}\nShowing: ${where}\nFEN: ${line.fens[ply]}\nLast moves: ${recent}\n</screen>\n\n${text}`;
}

export async function sendToCoach(text: string) {
  const { sessionId } = useStore.getState();
  pushChat({ kind: "user", id: newId("c"), text });
  useStore.setState({ busy: true });
  try {
    await invoke("coach_send", { text: withContext(text), resume: sessionId });
  } catch (e) {
    finishTurn();
    pushChat({ kind: "system", id: newId("c"), error: true, text: String(e) });
  }
}

/** Fresh coach conversation for this game (rereads coach.md); the chat history stays on screen. */
export async function restartCoach() {
  await invoke("coach_reset");
  useStore.setState({ sessionId: null, busy: false });
  pushChat({ kind: "system", id: newId("c"), text: "Coach restarted. It won't remember the conversation above." });
}
