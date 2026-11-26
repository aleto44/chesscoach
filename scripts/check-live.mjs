// Two clients against one server, for every live-synced activity kind (docs/server-migration.md,
// phase 3): an update from one reaches the other within 500 ms, an update made from a stale version
// (both acting at once, or a device back from offline) is refused and answered with the server's
// state, and ending a session reaches the other too.
// usage: node scripts/check-live.mjs <server url> <token>
const [base = "http://localhost:8765", token] = process.argv.slice(2);
if (!token) throw new Error("usage: node scripts/check-live.mjs <server url> <token>");
const KINDS = ["puzzle", "drill", "opening", "endgame", "guess", "plan", "trainer"];
const LIMIT_MS = 500;

const call = async (client, cmd, args) => {
  const res = await fetch(`${base}/api/invoke/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Client": client },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${cmd}: ${res.status} ${await res.text()}`);
  return res.json();
};

/** A client's event stream: resolves `next(pred)` with the first matching live-changed record. */
async function listen(client) {
  const res = await fetch(`${base}/api/events?client=${client}&token=${token}`);
  const reader = res.body.getReader();
  const waiting = [];
  const seen = [];
  (async () => {
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split("\n").find((l) => l.startsWith("data:"))?.slice(5);
        if (!data) continue;
        const msg = JSON.parse(data);
        if (msg.event !== "live-changed") continue;
        const at = performance.now();
        const w = waiting.findIndex((x) => x.pred(msg.payload));
        if (w >= 0) waiting.splice(w, 1)[0].resolve({ rec: msg.payload, at });
        else seen.push({ rec: msg.payload, at });
      }
    }
  })();
  await new Promise((r) => setTimeout(r, 200));
  return {
    next: (pred) => {
      const i = seen.findIndex((x) => pred(x.rec));
      if (i >= 0) return Promise.resolve(seen.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiting.push({ pred, resolve });
        setTimeout(() => reject(new Error("no live-changed within 3 s")), 3000);
      });
    },
    close: () => reader.cancel(),
  };
}

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

const A = "check-a", B = "check-b";
const a = await listen(A);
const b = await listen(B);
for (const kind of KINDS) {
  // A starts a session: B sees it.
  let t0 = performance.now();
  const started = await call(A, "live_update", { kind, id: `${kind}-1`, state: { step: 1 }, baseVersion: 0 });
  let got = await b.next((r) => r.kind === kind && r.version === started.version);
  check(started.ok && got.at - t0 < LIMIT_MS && got.rec.state.step === 1, `${kind}: A's start reaches B in ${Math.round(got.at - t0)} ms`);

  // B carries on from it: A sees B's step.
  t0 = performance.now();
  const moved = await call(B, "live_update", { kind, id: `${kind}-1`, state: { step: 2 }, baseVersion: started.version });
  got = await a.next((r) => r.kind === kind && r.version === moved.version);
  check(moved.ok && got.at - t0 < LIMIT_MS && got.rec.device === B, `${kind}: B's move reaches A in ${Math.round(got.at - t0)} ms`);

  // Both at once: A still on the old version. Refused; A gets B's state to take.
  const stale = await call(A, "live_update", { kind, id: `${kind}-1`, state: { step: 99 }, baseVersion: started.version });
  check(!stale.ok && stale.current?.state?.step === 2, `${kind}: a stale update is refused and answered with the server's state`);

  // Back from offline: B played on from a version A has since moved past.
  const fromA = await call(A, "live_update", { kind, id: `${kind}-1`, state: { step: 3 }, baseVersion: moved.version });
  const offline = await call(B, "live_update", { kind, id: `${kind}-1`, state: { step: "offline" }, baseVersion: moved.version });
  check(fromA.ok && !offline.ok && offline.current?.state?.step === 3, `${kind}: an offline device's late update yields to the newer one`);
  await b.next((r) => r.kind === kind && r.version === fromA.version);

  // A ends it: B hears, and the server no longer lists it.
  const ended = await call(A, "live_update", { kind, id: null, state: null, baseVersion: fromA.version });
  got = await b.next((r) => r.kind === kind && r.version === ended.version);
  const listed = await call(B, "live_get", {});
  check(ended.ok && got.rec.state === null && !listed.some((r) => r.kind === kind), `${kind}: ending reaches B and clears the record`);
}
a.close();
b.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
