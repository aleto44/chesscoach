# Moving Chess Coach onto laptop-server

Status: **done** (2026-11-25). Chess Coach runs on laptop-server in Docker
(`/srv/services/chesscoach`), at **https://laptop-server.tail3adf5e.ts.net**. The server itself is
described in `/srv/README.md` on laptop-server (read it first: layout, snapshots, firewall, alerts).

## How it is now (read this first)

- **Code:** `server/` is the server crate (`chesscoach-server`): every module that used to live in
  `src-tauri/src` (db, coach, mcp, puzzles, stats, imports...) plus `ctx.rs` (what replaced Tauri's
  `AppHandle`), `remote.rs` (the HTTP API) and `live.rs` (live sync). `src-tauri/` is only the desktop
  window. There's no separate `core/` crate: with the desktop shell holding no backend, nothing else
  needed the modules.
- **Run it locally:** `cargo run -p chesscoach-server -- --data data [--web dist]`, then
  `npm run dev` (Vite passes `/api` to `localhost:8765`, or `CHESSCOACH_SERVER`).
- **Deploy:** push to `main`; the server deploys it within a minute (`docs/deployment.md`, since
  2026-11-27). The first build took about 5 minutes; later ones reuse the cache.
- **Server commands:** `docker exec chesscoach chesscoach-server pairing-code --data /data` (the code
  a new device pairs with); `... backup DEST.db --data /data` (used by `snapshot.conf`).
- **The desktop app** reads its server address and token from `%USERPROFILE%\.chesscoach\server.json`
  (`{"url", "token"}`). It opens the page the server serves, and is installed and updated by
  `launch.ps1` (`docs/deployment.md`).
- **The coach's Claude sign-in** lives in `/srv/services/chesscoach/claude` (the container's
  `CLAUDE_CONFIG_DIR`). Sign in from Settings in the app; server-watch warns (`coach_login`) when it's
  signed out or ends within 7 days.
- **Checks** (against a running server, with its token from `remote.json`):
  `node scripts/check-live.mjs <url> <token>` (two clients, every live-synced kind: delivery within
  500 ms, stale and late-from-offline updates refused, ending) and
  `node scripts/check-coach.mjs <url> <token>` (a coach turn with a tool call, through the server; needs
  the server's Claude sign-in).
- **Offline packs** stay in localStorage: 150 puzzles on phones, 400 on the desktop, plus the due
  drills, well under the 5 MB limit, so IndexedDB wasn't needed.

## Target

```
                 laptop-server (Docker: /srv/services/chesscoach)
                 ┌─────────────────────────────────────────────┐
                 │ chesscoach-server (Rust, axum)               │
                 │  - the database (chesscoach.db, puzzles.db)  │
                 │  - the HTTP API (/api/invoke/<cmd>) + events │
                 │  - the coach (`claude -p` + its MCP tools)   │
                 │  - serves the web frontend to phones         │
                 └──────────────▲───────────────▲───────────────┘
                     Tailscale (https)     Tailscale / LAN
                                │               │
        Phone: PWA from the server        Desktop: Chess Coach.exe (Tauri)
        (offline pack, as today)          UI bundled in the app, talks to the
                                          server; full offline mode
```

- **The server owns everything stored**: games, ratings, drills, puzzle attempts, settings,
  courses and imports. It also runs the coach. Clients hold only caches and an outbox.
- **The phone** is the PWA, as today, but served by the server instead of the desktop.
- **The desktop** is a real Windows program, a small Tauri app, not a PWA or a browser tab. Its UI
  is bundled, so it opens and plays without the server, and it talks to the server over the
  same HTTP API the phone uses.
- **Every device stays in sync live.** Open the phone while the desktop is mid-game or mid-puzzle,
  and you can carry on from either one. Each move goes to the server, which pushes it to the other
  device (phase 3).
- **Engines stay in the client** (Stockfish and Maia as WebAssembly). The server's CPU never runs them,
  and moves feel the same.

### Why Docker works

It does. The coach needs the `claude` CLI and a claude.ai sign-in, so the image installs `claude`,
and its sign-in lives in a volume (`/srv/services/chesscoach/claude`):
- Sign in once with `docker exec -it chesscoach claude auth login`.
- Renew about monthly. server-watch warns, just as it does for `claude-rc`.

A bonus is that the coach's Claude is boxed into the container and can't touch the rest of the
server.

## Already done

- [x] **Safety snapshot of the desktop data** (2026-11-25 22:08):
  `G:\ServerSnapshots\chesscoach-desktop\chesscoach-desktop-2026-11-25-2208.zip`, the same file on
  `H:`, both SHA-256 verified.
  - `chesscoach.db` was taken with SQLite's backup API while the app ran: integrity ok, 193 games,
    12309 moves, 491 drills, 60 drill attempts, 91 puzzle attempts, 464 chat items, 14 settings.
  - `remote.json` is in it too.
  - `puzzles.db` (415 MB Lichess set) is left out: it can be downloaded again, and the attempts are in
    `chesscoach.db`.

## What we start from

- `src-tauri/src/remote.rs` already **is** a server: axum, `/api/invoke/<cmd>` for 67 of the 73
  Tauri commands, `/api/events` (SSE), pairing, and it serves the frontend.
  - The 6 missing commands: `custom_sound`, and `remote_*` (the phone-server settings, which go away).
- `src/backend.ts` already speaks HTTP when `isRemote`.
- `src/offline.ts` already gives phones a pack (puzzles, drills) and an outbox for course progress, grades
  and attempts.
- What ties the Rust side to the desktop:
  - 226 Tauri references (`AppHandle`, `app.emit`, `.path()`, `.state()`) across 15 files.
  - The `relay::DESKTOP` client, which owns the coach by default.
- What ties the frontend to the desktop: 101 `isTauri` / `isRemote` / `hasBackend` branches in 32 files.

## Phases

The app keeps working after every phase. Until phase 5, everything still runs on the desktop: the
new server binary runs locally on Windows in place of the Tauri backend.

### 1. Backend out of Tauri
- Cargo workspace:
  - `core/`: db, puzzles, stats, import, coach, mcp, relay, tools, loads, coach_data, auth and sounds,
    with no `tauri` dependency.
  - `server/`: the binary, grown from `remote.rs`.
  - `src-tauri/`: becomes the desktop shell (phase 6).
- Replace `AppHandle` with our own `Ctx`: data dir, `Db`, the event broadcast (what `app.emit` does
  today, already fanned out by `relay` for SSE), coach and login state, and the puzzle import job.
- The HTTP API is the only API. `dispatch` covers every command, `custom_sound` included.
- `chesscoach-server --data <dir> --port <n> [--web <dist>]`, plus
  `chesscoach-server backup <dest.db>` (SQLite backup API, for snapshots).
- Auth: keep pairing, so every client, the desktop included, holds a token. Tailscale and the
  firewall are the outer wall.

### 2. Frontend: every window is a client
- `backend.ts`: one path, HTTP plus SSE. The base URL is the page's origin (PWA) or the server address
  from the desktop shell's config.
- Go through the 101 branches. Each becomes "always", "never", or "offline-capable client".
- Drop `relay::DESKTOP` as a special owner. The coach belongs to whichever client last sent to it, as
  phones already work.
- Settings: replace the phone-server section with the server address and pairing. Claude sign-in runs on
  the server (auth.rs already drives `claude auth`; the link opens on the client).
- Typed moves, the voice mic (needs https; the server provides it), sounds and drawing keep working.
  They're all in the browser.

### 3. Live sync: every device shows the same thing
**Goal:** with the desktop app and the phone both open, whatever is in progress (a game, a puzzle,
a drill run, a trainer session) can be played from either one. A move made on one shows on the other
within a fraction of a second. The server holds the live state, and each device mirrors it.

Today only games do this: `src/game/sync.ts`, plus `game-changed`, plus a lead/follow rule. Settings
(`setting-changed`) and drill/puzzle counts (`data-changed`) refresh too. The session stores
(`src/puzzles/session.ts`, `src/analysis/drillSession.ts`, `src/openings/session.ts`,
`src/endgames/session.ts`, `src/guess/session.ts`, `src/plans/session.ts`) live on one device only.

**Design**
- **The server keeps one live record per activity kind**: kind, id, state (JSON), a version number, and
  which device made the last change. It's stored in the database, so it survives a server restart.
- **Each session store gets a `snapshot()` / `apply(state)` pair.** `src/live.ts` pushes a snapshot after
  every meaningful step (a move, an answer, next puzzle) with `live_update { kind, state, baseVersion }`.
  The server bumps the version and broadcasts `live-changed` over SSE. Other devices call `apply()`.
- **Lead and follow, generalized from `game/sync.ts`.** The device you last touched leads. Only the
  leader lets the engine answer, so Maia never moves twice. A follower mirrors the moves, and touching
  it makes it the leader.
- **Stale writes:** if two devices act at once, the update with an old `baseVersion` is refused. That
  device then takes the server's state, so the board can't split into two versions.
- **Clocks:** rated games count time from server timestamps, so both devices show the same clock. The
  game clock pauses while a trainer runs (`src/game/clock.ts`), as it does today.
- **Opening the app on a second device:** the home screen shows "Continue: rated game vs Maia 1450,
  move 23" (or "puzzle in progress", ...). One tap joins it. It never jumps there on its own.
- **Also synced:** the coach chat (game threads already are; the trainer thread in
  `src/coach/trainerChat.ts` joins them), rating changes, new drills, and imports in progress.
- **Not synced** (UI choices, per device): which screen you're on, filters, board drawings, the
  analysis-board scratch lines.
- **Offline:** a device that's offline keeps playing on its own copy. When it reconnects:
  - If nobody else touched that activity, its updates apply in order.
  - If another device moved on meanwhile, the server's version wins. The offline device's
    diverging moves are kept as a saved variation and announced, never silently dropped.

**Testing:** two clients against one local server, e.g. two browser contexts driven by a script.
Make a move, answer a puzzle or grade a drill on one, then check the other within 500 ms. Repeat for
every activity kind. Also test the stale-write and offline-reconnect cases.

### 4. Server package
- `/srv/services/chesscoach/` holds:
  - `docker-compose.yml`
  - `src/`: the deployed tree
  - `data/`: `chesscoach.db`, `puzzles.db`, sounds
  - `claude/`: the coach's sign-in
  - `snapshot.conf`
- Multi-stage `Dockerfile`:
  1. Build the Rust release.
  2. `npm run build`.
  3. A slim runtime with the server, `dist/` and the `claude` CLI.
- Compose: `restart: unless-stopped`, a healthcheck on `/api/ping`, and the port published.
  - The firewall's DOCKER-USER block already limits it to the LAN and Tailscale.
  - `tailscale serve` on the host gives the https address phones need to install the PWA and use the mic.
- `snapshot.conf`, which puts the database into the server's daily snapshot. That snapshot is pulled to
  the desktop's G: and H: drives and alerts if it isn't collected for 5 days:
  - `PATHS=(docker-compose.yml)`
  - `pre()` runs `docker exec chesscoach chesscoach-server backup /data/snap.db` and copies that into `$DUMP`.
  - `puzzles.db` stays out: it can be downloaded again.
- server-watch: the container watch covers it. Also add the coach's Claude sign-in expiry.
- **Deploy** with `scripts/deploy.ps1` (replaced on 2026-11-27 by deploys from `main`, `docs/deployment.md`):
  1. Send the working tree (`git ls-files -co --exclude-standard`, so uncommitted work deploys
     too) over SSH.
  2. `docker compose up -d --build`.
  3. Wait for healthy.
  - The first Rust build on the laptop is slow (10–20 min); later builds reuse cached layers.

### 5. Move the data (the switch-over)
1. Close the desktop app.
2. Take a final SQLite backup with the WMI trick (Claude's tools see a stale shadow copy of AppData).
3. Copy it and `puzzles.db` to `/srv/services/chesscoach/data/`.
4. Start the container.
5. Check that the row counts match the safety snapshot.
6. Re-pair the phone to the new address.

From then on the server holds the truth. The desktop's old data folder stays as it is. Alex deletes it himself when
he's ready, so nothing in this migration removes it.

### 6. Desktop app
- `src-tauri` becomes a thin shell: a window over the bundled frontend, plus a config for the server
  address (default `https://laptop-server.<tailnet>.ts.net`) and the pairing token.
- Started the same way as today (`scripts/start-dev.ps1`) while developing. (Since 2026-11-27 the window
  opens the server's page instead, and `launch.ps1` installs it: `docs/deployment.md`.)
- Before switching, the shell checks that its frontend version matches the server's API version, so a
  stale desktop build can't write in a format the server doesn't expect.

### 7. Offline mode, desktop and phone
**Rule: if everything a feature needs can run on the device, it works offline.** It works the same on
the desktop app and the phone PWA. Maia (`src/engine/maia.ts`, onnxruntime-web) and Stockfish
(WebAssembly) already run inside the app on every device, and the phone's service worker already
caches them (`maia3/` 44 MB, `stockfish/`).

Extend `offline.ts` from "phone" to "any client". Use IndexedDB, not localStorage (5 MB limit). The
desktop keeps bigger caches than the phone.

Offline, a client has:
- **Puzzles:** a large pack (hundreds, across ratings and themes).
- **Drills:** every due drill.
- **Opening courses:** the full progress map. Each answer is saved per decision and merged later, as
  today.
- **Games:**
  - Practice and rated games against Maia or Stockfish play fully offline, because the engines are
    local.
  - The finished game goes into the outbox. The server saves it, rates it, works out its drills and
    review, and pushes the rating change back.
  - Matchmaking uses the cached rating.
- **Analysis board, endgame trainer, guess-the-move:** work offline (engines local).
- **Saved games, profile and stats:** read-only from the last cached copy.
- **Not offline:** the coach (it runs on the server), and imports from chess.com and Lichess.
- When the server is back, the outbox drains oldest first, as phones do today. Conflicts are rare (one
  student), and the later answer wins, as course progress already does.

### 8. Clean up
- Remove from the desktop: `tailscale.rs`, the `remote_*` commands and the phone-server code.
- Update `.github/copilot-instructions.md` (the "phone client served from the computer" text, the
  backend description, offline), `docs/phone.md` and `/srv/README.md` (Services table, Chess Coach
  section, restore steps).

## Decisions (Alex, 2026-11-25)
- **Offline:** every feature whose pieces can all run on the device works offline, on the desktop and
  the phone.
- **Rated games offline: yes.** Maia runs locally, and the game is rated when it syncs.
- **No coach offline.** It needs the server.
- **Old desktop data:** Alex deletes the old app-data folder himself when he's ready. Don't touch it.
- **Hosting:** Docker, in `/srv/services/chesscoach`.
- **Backups:** the server's daily snapshot job (`/srv/README.md`, "Snapshots") covers the database
  through `snapshot.conf`'s `pre()` dump (phase 4). It's pulled to G: and H: on the desktop like
  everything else.
- **Live sync:** everything in progress (games, puzzles, drills, trainers, coach chat) is shared live
  between the desktop and the phone through the server, so either device can carry on (phase 3).
