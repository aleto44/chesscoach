# Playing on your phone

Chess Coach's server (`server/`, in Docker on laptop-server; see `docs/server-migration.md`) is the
home of everything: the database, the Claude login and the coach. The phone and the desktop app are
both clients of it. The phone opens the web app the server serves, in Chrome, and installs it to the
home screen as a PWA. Engines (Stockfish, Maia) run on the phone in the browser.

## Setup

1. Tailscale on the phone, signed in to the same account as the server. Leave it on.
2. On the phone, open **https://laptop-server.tail3adf5e.ts.net** (`tailscale serve` on the server
   gives it an https address, which Chrome needs to install the app and use the microphone).
3. Enter the pairing code. A paired device shows it in **Settings → Server**; on the server,
   `docker exec chesscoach chesscoach-server pairing-code --data /data` prints it. **New code** there
   unpairs every other device.
4. Browser menu → **Add to Home screen** / **Install**.

## Offline

Whatever runs on the phone keeps working while the server is out of reach: games against the
engines (rated too), puzzles and drills from the pack the phone keeps, opening courses, the endgame
trainer, guess the move. Results wait in an outbox and go to the server, oldest first, when it's
back; games played offline are sent, rated and reviewed then. The coach and imports need the server.

## Desktop and phone together

Whatever is in progress (a game, a puzzle set, a drill run, a trainer) is mirrored live through the
server: open the other device and **Continue** on Home picks it up, and from then on a move on either
shows on both. Leaving a session on one device leaves it only there.

## How it fits together

- `POST /api/invoke/<command>`: the commands, camelCase args, JSON in and out.
- `GET /api/events`: server-sent events. A dropped connection (screen off) resumes where it left
  off, so coach replies and tool calls aren't lost; after a longer gap the app rereads (`resync`).
- The coach belongs to whichever device last sent it a message. Its replies and tool calls go only
  there; switching devices restarts the coach process on that device's own conversation.
- The phone proves it's paired with a cookie; the desktop app, given its token by server.json,
  sends the token as `Authorization: Bearer` (and `?token=` on the event stream).
- Phone touch bugs: set `SEND_FROM_PHONES` in `src/touchLog.ts` with a server running from the repo
  (`cargo run -p chesscoach-server`); each phone streams its touches to `phone-debug.log`.
