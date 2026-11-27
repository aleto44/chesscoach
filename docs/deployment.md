# Deployment: main is what runs

**Rule: what runs is always the latest commit on `main` on GitHub.** That includes the server, the
phone, and the desktop app. Nothing runs from a checked-out working tree. To change the app, commit
to `main` and push; laptop-server deploys it within a minute, and every client picks it up.

The repo has two working clones:

- the desktop's, `C:\Users\alexj\IdeaProjects\chesscoach`;
- the server's, `/srv/dev/chesscoach`, for the Claude on laptop-server (`claude-rc`, reached from the
  phone).

Both pull before they start work and push when they're done. Neither one is what runs.

## The server

`/srv/services/chesscoach` on laptop-server holds:

| Path | What it is |
| --- | --- |
| `repo/` | Fetch-only clone the deploys build from. |
| `src/` | The deployed commit's files. Replaced on every deploy; never edit it. |
| `.env` | What's deployed: commit, subject, time, and the `ui` and `shell` hashes. |
| `state/` | `deployed`, `failed`, `hold`, `build.log`, and the lock. |
| `data/`, `claude/` | The database and the coach's sign-in. Untouched by deploys. |

`chesscoach-deploy.timer` runs `chesscoach-deploy auto` every minute
(`deploy/auto-deploy.sh` and `deploy/systemd/`; a deploy installs newer copies of both). When
`origin/main` moved:

1. Exports that commit into a new source folder and builds the image while the old container keeps
   serving. `npm run build` type-checks and the server is compiled, so a commit that doesn't build
   never goes live.
2. Swaps containers and waits for the health check. If the new one isn't healthy, the previous image
   comes back.
3. Records the commit. A failure is kept in `state/failed`, and server-watch alerts on it
   (`chesscoach_deploy`). That commit isn't tried again until a newer one lands, or until
   `chesscoach-deploy now`.

Commands on the server:

- `chesscoach-deploy now`: deploy `main` right away and show the output. From the desktop,
  `scripts/deploy.ps1` does the same and skips the wait.
- `chesscoach-deploy status`: what's deployed, what's on `main`, failures and holds.
- `chesscoach-deploy rollback`: back to the image before the last deploy. The next commit on `main`
  deploys as usual.
- `chesscoach-deploy hold [why]` / `release`: pause or resume automatic deploys.

`GET /api/version` (no sign-in) says what's deployed: `commit`, `subject`, `deployedAt`, `ui` and
`shell`.

- **`ui`** is a hash of what the frontend is built from: `src/`, `public/`, the package files, Vite
  and TS config, `patches/`, and the scripts that copy the engines.
- **`shell`** is the git tree hash of `src-tauri/`.

A deploy that changes neither, such as a server-only fix, asks nothing of the clients.

## The clients

- **Every page comes from the server**: the phone's and the desktop's alike. The page knows its own
  `ui` (`VITE_UI_VERSION`, set at build time) and compares it with `/api/version`:
  - at startup;
  - whenever the event stream reconnects, which happens right after every deploy, since the server
    restarts;
  - every 10 minutes.

  This is in `src/update.ts`.
- **Different `ui`**: the top bar shows **Update**, which reloads into the new page past the service
  worker's kept copy. Right at startup, a stale page reloads by itself, once.
- **The desktop app** (`src-tauri/`) is a window opened at the server's address. The address and
  token come from `%USERPROFILE%\.chesscoach\server.json`.
  - The program is installed in `%USERPROFILE%\.chesscoach\app` and started by `start.vbs` →
    `launch.ps1`. The desktop shortcut points to `start.vbs`.
  - At every start, `launch.ps1` asks the server for its `shell`. If the installed build
    (`installed.json`) differs, it builds that commit's `src-tauri` with cargo, in the clone
    `%USERPROFILE%\.chesscoach\build`, installs it, and starts it. A tray balloon shows while it
    builds.
  - While it runs, a changed `shell` shows **Restart to update** instead. The page goes to
    `relaunch.chesscoach.invalid`, and the program hands over to `launch.ps1 -After <pid>` and quits.
  - Offline, or when a build fails, the installed program starts as it is.
- **Offline**: the service worker (`public/sw.js`) keeps the page for the phone and the desktop, so
  both open without the server.

## Developing

- `npm run dev` (port 1420) is for trying changes before they're committed. It's a preview in a
  browser that talks to the server through Vite's `/api` proxy (`CHESSCOACH_SERVER`). It isn't the
  app.
- For server changes, run `cargo run -p chesscoach-server -- --data data`; Vite reaches it on
  `localhost:8765`.
- For the desktop program itself, `cargo run -p chesscoach` opens a window at the server from
  `server.json`.
- `main` deploys as soon as it's pushed, so check before pushing: `npx tsc --noEmit`, plus the
  `check-*.mjs` scripts for what you touched. The server's build is the last gate.
- If both clones change at once, git stops the second push. Pull (rebase) and push again.
