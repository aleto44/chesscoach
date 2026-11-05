# Playing on your phone

The computer stays the home of everything: the database, your Claude login and the coach
process. The phone is a client. The desktop app runs a small web server (`src-tauri/src/remote.rs`)
that serves the same frontend plus an HTTP version of the Tauri commands, and the phone opens
it in Chrome and installs it to the home screen as a PWA.

Engines (Stockfish, Maia) run on the phone in the browser, just like in the desktop window.

## Setup

1. On the computer: **Settings → Play from my phone**. It shows an address and a pairing code.
   Windows may ask whether to allow Chess Coach through the firewall; allow it on private networks.
2. On the phone (same Wi-Fi): open the address in Chrome, enter the code. The phone keeps a
   pairing cookie for a year. **New code** in Settings unpairs every phone.
3. Keep the desktop app running (it can be minimized).

## From anywhere (and installing as an app): Tailscale

Tailscale (free) joins your phone and the computer into a private network that only your own
devices can reach, over cellular or any Wi-Fi, with no router changes. `tailscale serve` then gives
the computer an `https://<computer>.<tailnet>.ts.net` address for the app. Nothing is opened to the
public internet, and https is also what Chrome needs to install a real PWA.

1. Install Tailscale on the computer and the phone (tailscale.com/download) and sign in with the
   same account on both. Leave it on on the phone.
2. On the computer: **Settings → Play from my phone → Anywhere → Set up**. That runs
   `tailscale serve --bg 8765` for you (it keeps working after restarts). The first time, Tailscale
   may ask you to turn on https for your tailnet: Settings shows the link; approve it, then press
   **Set up** again.
3. On the phone, open the `https://….ts.net` address Settings shows, enter the pairing code (each
   address pairs separately), then browser menu → **Add to Home screen** / **Install**.

For this to work while you're out:

- The computer has to be on, awake and running Chess Coach. Set Windows to never sleep while
  plugged in (Settings → System → Power), or the phone can't reach it.
- Under `tauri dev` the phone loads the unbundled dev frontend, which is many small files: the first
  load over cellular can take a few seconds. A release build (`npm run tauri build`) serves bundles.

## How it fits together

- `POST /api/invoke/<command>`: the Tauri commands, same names and camelCase args.
- `GET /api/events`: Tauri events as server-sent events. A dropped connection (screen off)
  resumes where it left off, so coach replies and tool calls aren't lost.
- The coach belongs to whichever device last sent it a message. Its replies and tool calls go only
  there; switching devices restarts the coach process on that device's own conversation.
- `src/backend.ts` picks Tauri IPC or HTTP at runtime; the page served to phones carries
  `window.__CC_REMOTE__`.
- Under `tauri dev`, pages come from the Vite dev server (live, with hot reload through the server);
  a release build serves the bundled frontend.
- `CHESSCOACH_PORT` changes the port (default 8765).
