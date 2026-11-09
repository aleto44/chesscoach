// Frontend end of the coach: sends user turns to the backend, renders its stream-json output,
// and answers tool calls coming in through the MCP server.
import { hasBackend, invoke, listen } from "../backend";
import { Chess } from "chess.js";
import { formatMoves, moveLabel } from "../chess/line";
import { labelOf } from "../analysis/review";
import { evalWords, positionFacts, topMoves } from "./insight";
import { gameDescription, isLocked, newId, pushChat, screen, updateChat, useStore } from "../store";
import { useSettings } from "../settings";
import { describeCall, handleTool } from "./tools";
import { drillContext } from "../analysis/drillSession";
import { puzzleContext } from "../puzzles/session";
import { endgameContext } from "../endgames/session";
import { openingContext } from "../openings/session";
import { lastTrainerExchange } from "./trainerChat";
import { peeking } from "../nav";
import { guessContext } from "../guess/session";
import { cancelQuizzes } from "./quiz";
import { refreshUsageSoon } from "./usage";

let streamingId: string | null = null;
const stderrTail: string[] = [];

/** Call once at startup (outside React, so StrictMode doesn't double-register). */
export function initBridge() {
  // Plain-browser dev (vite only): the board works, the coach doesn't.
  if (!hasBackend()) return;
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
        useStore.setState({ streaming: true });
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && streamingId) {
        const id = streamingId;
        useStore.setState((s) => ({
          chat: s.chat.map((c) => (c.id === id && c.kind === "coach" ? { ...c, text: c.text + ev.delta.text } : c)),
        }));
      } else if (ev.type === "content_block_stop") {
        streamingId = null;
        useStore.setState({ streaming: false });
      }
      break;
    }
    case "rate_limit_event":
      refreshUsageSoon();
      break;
    case "result":
      finishTurn();
      refreshUsageSoon();
      if (msg.is_error || msg.subtype !== "success") {
        pushChat({ kind: "system", id: newId("c"), error: true, text: `Coach error: ${msg.result ?? msg.subtype}` });
      }
      break;
  }
}

function finishTurn() {
  streamingId = null;
  useStore.setState({ busy: false, busySince: null, streaming: false });
}

/**
 * Prefix each turn with a compact view of the screen so the coach rarely needs get_state: the
 * position, the engine's top moves and facts worked out by code, so it starts from real numbers.
 */
export async function withContext(text: string): Promise<string> {
  return `<screen>
${(await screenLines()).join("\n")}
</screen>

${text}`;
}

async function screenLines(): Promise<string[]> {
  // A coach scenario opened over a session is what's on screen: describe that board instead.
  if (peeking()) return mainBoardLines();
  const puzzle = puzzleContext();
  if (puzzle)
    return [
      `Showing: ${puzzle.title} in the puzzle trainer (not a game): ${puzzle.detail}`,
      `FEN: ${puzzle.fen}`,
      ...(await engineLines(puzzle.fen, puzzle.detail.includes("not solved") ? " (this is the answer: use it for hints, don't reveal it)" : "")),
    ];
  const drill = drillContext();
  if (drill)
    return [`Showing: drill "${drill.title}" (not a game)`, `FEN: ${drill.fen}`, ...(await engineLines(drill.fen, " (the drill's answer: don't reveal it unless asked)"))];
  const trainer = endgameContext() ?? openingContext() ?? guessContext();
  if (trainer) {
    // The trainer's own explanation is in the chat column too: a follow-up question is usually about it.
    const said = lastTrainerExchange();
    return [
      `Showing: ${trainer.title} (not a game): ${trainer.detail}`,
      `FEN: ${trainer.fen}`,
      ...(await engineLines(trainer.fen, trainer.detail.includes("don't reveal") ? " (this includes the answer: don't reveal it)" : "")),
      ...(said ? [`The trainer's last explanation, shown in the chat above:
${said}`] : []),
    ];
  }
  return mainBoardLines();
}

async function mainBoardLines(): Promise<string[]> {
  const s = useStore.getState();
  const { line, ply, tangent } = screen();
  const from = Math.max(0, ply - 6);
  const recent = ply > 0 ? formatMoves(line, from, ply) : "(none)";
  const where = tangent ? `tangent board "${tangent.title}"` : s.gameFork ? "main game, with the student's what-if moves" : "main game";
  const out = [`Game: ${gameDescription()}`, `Showing: ${where}`, `FEN: ${line.fens[ply]}`, `Last moves: ${recent}`];
  // The review's verdict on the move just played, so the coach agrees with what the student sees.
  const a = !tangent && !s.gameFork && ply > 0 ? s.annotations[ply - 1] : null;
  if (a) {
    const fen = s.game.fens[ply - 1];
    const best = a.bestUci ? uciSan(fen, a.bestUci) : null;
    out.push(
      `Review of ${moveLabel(fen, s.game.sans[ply - 1])}: ${labelOf(a)}` +
        (a.evalBefore !== undefined ? `, ${evalWords(a.evalBefore)} → ${evalWords(a.evalAfter)}` : "") +
        (best && best !== s.game.sans[ply - 1] ? `; the engine's move was ${best}` : ""),
    );
  }
  return [...out, ...(await engineLines(line.fens[ply], ""))];
}

/** The engine's top moves (quick, so the student isn't kept waiting) and the position's facts. */
async function engineLines(fen: string, note: string): Promise<string[]> {
  let engine: string | null = null;
  try {
    const top = await Promise.race([topMoves(fen, 3, 12), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    if (top) engine = `Engine's top moves (depth 12)${note}: ${top.text}`;
  } catch {
    // No engine: the facts still help.
  }
  return [...(engine ? [engine] : []), "Position facts (computed, exact):", ...positionFacts(fen).map((f) => `- ${f}`)];
}

function uciSan(fen: string, uci: string): string | null {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

export async function sendToCoach(text: string) {
  // The UI stops this too; a rated game in progress gets no help.
  if (isLocked()) return;
  const { sessionId } = useStore.getState();
  pushChat({ kind: "user", id: newId("c"), text });
  useStore.setState({ busy: true, busySince: Date.now(), streaming: false });
  try {
    await invoke("coach_send", { text: await withContext(text), resume: sessionId });
  } catch (e) {
    finishTurn();
    pushChat({ kind: "system", id: newId("c"), error: true, text: String(e) });
  }
}

/** Fresh coach conversation for this game (rereads coach.md); the chat history stays on screen. */
export async function restartCoach() {
  cancelQuizzes();
  await invoke("coach_reset");
  useStore.setState({ sessionId: null, busy: false });
  pushChat({ kind: "system", id: newId("c"), text: "Coach restarted. It won't remember the conversation above." });
}
