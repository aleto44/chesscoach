// The coach through the server, end to end: a client sends a turn (coach_send), the server runs
// `claude -p` with the chess tools, tool calls come back to that client as `tool-call` events and
// its answers go in with `tool_result`, and the reply streams back as `coach-event` lines. The
// client here answers every tool with the starting position. Uses the server's Claude sign-in.
// usage: node scripts/check-coach.mjs <server url> <token>
const [base = "http://localhost:8765", token] = process.argv.slice(2);
if (!token) throw new Error("usage: node scripts/check-coach.mjs <server url> <token>");
const client = `check-coach-${Date.now()}`;
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const call = async (cmd, args) => {
  const res = await fetch(`${base}/api/invoke/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Client": client },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${cmd}: ${res.status} ${await res.text()}`);
  return res.json();
};

const res = await fetch(`${base}/api/events?client=${client}&token=${token}`);
const reader = res.body.getReader();
await new Promise((r) => setTimeout(r, 300));

const auth = await call("auth_status", {});
console.log(`signed in: ${auth.loggedIn} (${auth.authMethod})`);
if (!auth.loggedIn) process.exit(2);

const t0 = Date.now();
await call("coach_send", { text: "Quick check of the tools: look at the current position with your tools, then answer in one short sentence what the first move options are.", resume: null });

let buf = "", text = "", tools = 0, done = false;
const timeout = setTimeout(() => (console.log("FAIL no result within 180 s"), process.exit(1)), 180_000);
while (!done) {
  const { value, done: end } = await reader.read();
  if (end) break;
  buf += new TextDecoder().decode(value);
  let i;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"))?.slice(5);
    buf = buf.slice(i + 2);
    if (!data) continue;
    const { event, payload } = JSON.parse(data);
    if (event === "tool-call") {
      tools++;
      console.log(`tool call: ${payload.name} ${JSON.stringify(payload.args)}`);
      await call("tool_result", { id: payload.id, result: { text: `Position (FEN): ${START}. White to move; no moves played yet.`, isError: false } });
    } else if (event === "coach-event") {
      const line = JSON.parse(payload);
      if (line.type === "result") {
        text = line.result ?? "";
        done = true;
        console.log(`result after ${Math.round((Date.now() - t0) / 1000)} s (${line.is_error ? "error" : "ok"}): ${text.slice(0, 300)}`);
      }
    } else if (event === "coach-stderr") {
      console.log(`stderr: ${payload}`);
    } else if (event === "coach-exit") {
      console.log("coach process exited");
      done = true;
    }
  }
}
clearTimeout(timeout);
await call("coach_reset", {});
const ok = text.length > 0 && tools > 0;
console.log(ok ? `ok: ${tools} tool call(s) answered through the server, reply received` : "FAIL");
process.exit(ok ? 0 : 1);
