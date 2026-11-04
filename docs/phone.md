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

## Away from home, and installing as an app: Tailscale

Plain `http://192.168.x.x` works on home Wi-Fi, but Chrome only installs a real PWA (service
worker, standalone window) from `https://`. Tailscale gives you both, free:

1. Install Tailscale on the computer and the phone, sign in to the same account on both.
2. On the computer, once:

   ```
   tailscale serve --bg 8765
   ```

   This publishes the app at `https://<computer-name>.<tailnet>.ts.net` (shown by
   `tailscale serve status`), reachable only from your own Tailscale devices, with a real certificate.
3. Open that address on the phone, pair, then Chrome menu → **Add to Home screen → Install**.

## How it fits together

- `POST /api/invoke/<command>`: the Tauri commands, same names and camelCase args.
- `GET /api/events`: Tauri events as server-sent events. A dropped connection (screen off)
  resumes where it left off, so coach replies and tool calls aren't lost.
- The coach belongs to whichever device last sent it a message. Its replies and tool calls go only
  there; switching devices restarts the coach process on that device's own conversation.
- `src/backend.ts` picks Tauri IPC or HTTP at runtime; the page served to phones carries
  `window.__CC_REMOTE__`.
- In `tauri dev`, the server serves `dist/`, so run `npm run build` first to see current frontend changes.
- `CHESSCOACH_PORT` changes the port (default 8765).
