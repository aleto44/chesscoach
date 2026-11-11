<div align="center">

<img src="assets/icon.png" width="96" alt="Chess Coach logo" />

# Chess Coach

**A personal chess coach on your desktop.** Play human-like opponents, get every game reviewed,
drill your own mistakes until they stick, and ask an AI coach *why*. It answers on the board.

![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-backend-000000?logo=rust&logoColor=white)
![Stockfish 19](https://img.shields.io/badge/Stockfish-19-6aa84f)
![Maia](https://img.shields.io/badge/Maia-human--like%20AI-8e7cc3)

<img src="docs/screenshots/coach.png" alt="The coach explaining a blunder with arrows on the board" width="100%" />

<sub><i>Ask "why was that a blunder?" and the coach answers with a line you can step through on the board.</i></sub>

</div>

---

## Contents

- [Features](#features)
  - [An AI coach that teaches on the board](#an-ai-coach-that-teaches-on-the-board)
  - [Play opponents that play like people](#play-opponents-that-play-like-people)
  - [Every game reviewed](#every-game-reviewed)
  - [Find your weaknesses](#find-your-weaknesses)
  - [Drills built from your own mistakes](#drills-built-from-your-own-mistakes)
  - [Puzzles](#puzzles)
  - [Opening and endgame training](#opening-and-endgame-training)
  - [Analysis board, anywhere](#analysis-board-anywhere)
  - [Play from your phone](#play-from-your-phone)
- [Getting started](#getting-started)
- [Development](#development)
- [Credits](#credits)

---

## Features

### An AI coach that teaches on the board

The chat column holds a coach powered by Claude. It doesn't send you move lists: it builds
scenarios with arrows and circles and links them in its answer, and one click opens the scenario on
the main board. It's grounded in what the engine actually computed, so it can't make up tactics.
Every square and move it mentions highlights on the board when you hover over it.

### Play opponents that play like people

<table>
<tr>
<td width="50%"><img src="docs/screenshots/menu.png" alt="Home menu" /></td>
<td width="50%"><img src="docs/screenshots/games.png" alt="Games menu with ratings and rating graph" /></td>
</tr>
</table>

- **Play rated:** pick a clock and get paired with a [Maia](https://www.maiachess.com/) opponent
  near your rating. Maia is trained on human games, so it makes human mistakes rather than playing
  like an engine.
- **Separate bullet, blitz and rapid ratings**, all on the **chess.com scale**, so the numbers
  mean what you're used to.
- **Practice games** against Maia or Stockfish at any strength, with takebacks.
- Type moves on the keyboard (`e4`, `Nf3`, `O-O`), and draw arrows on **any** board with a right-click drag.

### Every game reviewed

<table>
<tr>
<td width="50%"><img src="docs/screenshots/review.png" alt="Game review with move classifications" /></td>
<td width="50%"><img src="docs/screenshots/report.png" alt="Game report with accuracy and move quality" /></td>
</tr>
</table>

Each game ends with a full report: accuracy, an eval graph, and every move classified from
*brilliant* to *blunder*. Jump between key moments, try your own what-if moves from any position,
or hand the game to the coach for a guided review.

<img src="docs/screenshots/why.png" alt="Why a move was a blunder, shown step by step" width="100%" />

**"Why is it a blunder?"** gives a plain-English explanation of what the move allowed, with the
refutation as arrows you can step through and the better moves next to it.

### Find your weaknesses

<img src="docs/screenshots/weaknesses.png" alt="Weakness report: biggest leaks across your games" width="100%" />

The Profile looks across your **real games** (rated games here plus games **imported from chess.com
and Lichess**) and ranks your biggest leaks: hanging pieces, moving too fast, missed free
material, walking into mate, weak phases of the game. Each leak links straight to drills of those
exact positions, or to puzzles on that theme. Rating history tracks everything over time.

### Drills built from your own mistakes

<img src="docs/screenshots/drill.png" alt="A drill from one of your games, with its lesson" width="100%" />

Positions you got wrong come back on a **spaced-repetition** schedule until they stick. Every drill
is a lesson worked out when the mistake was made: the move you played against the best one,
searched deeply, with the concrete theme behind it ("unguarded square", "fork", "trapped piece", ...).
Missed puzzles and your opening repertoire feed in too.

### Puzzles

<img src="docs/screenshots/puzzles-menu.png" alt="Puzzle menu with rating, weakest themes and theme mastery" width="100%" />

Millions of rated puzzles from the [Lichess puzzle database](https://database.lichess.org/#puzzles)
(downloaded once, on first use). There's a puzzle rating, **Puzzle Rush**, training on your weakest themes, and
**theme mastery** with stars and tiers that you earn per tactic.

### Opening and endgame training

<img src="docs/screenshots/opening-plan.png" alt="Opening trainer showing the plan at the end of a London System line" width="100%" />

- **Opening trainer:** build a repertoire (London, Italian, Queen's Gambit, and defences as Black)
  and play it against the book. The opponent picks replies weighted by how often they're played.
  Transpositions that cost nothing are accepted, and engine-equal alternatives are marked `≈`
  instead of wrong. At the end of every line you get **the plan**: what you're playing for, drawn on the board.
- **Endgame trainer:** convert the standard endings against Stockfish.
- **Guess the move:** play through master games and predict each move.

### Analysis board, anywhere

<img src="docs/screenshots/analysis.png" alt="Analysis board with Stockfish's top three lines" width="100%" />

The magnifier opens an analysis board on top of whatever you're looking at, at the same position,
with an eval bar, Stockfish's top three lines and what-if branches. It's off during rated games,
and on puzzles or drills until you've answered.

### Play from your phone

<table>
<tr>
<td width="34%"><img src="docs/screenshots/phone.png" alt="Chess Coach on a phone" /></td>
<td>

The desktop app serves the same app to your phone. Pair it with a code, add it to your home screen,
and play, solve puzzles and drill from the couch. Engines run on the phone itself, and **puzzles and
drills keep working offline**: your answers sync when the computer is back.

With [Tailscale](https://tailscale.com/) it works from anywhere, privately, over HTTPS, with one
button in Settings. See [docs/phone.md](docs/phone.md).

</td>
</tr>
</table>

---

## Getting started

Setup is short. You need:

| Requirement | Why |
| --- | --- |
| [Node.js](https://nodejs.org/) 20+ | Frontend and setup scripts |
| [Rust](https://rustup.rs/) (stable) | The Tauri desktop shell |
| [Claude Code](https://claude.com/claude-code), signed in | Powers the coach and uses your existing Claude login, so there are no API keys to manage |

On Windows, Tauri also needs WebView2 (already installed on Windows 10/11) and the
[MSVC build tools](https://tauri.app/start/prerequisites/).

Then:

```bash
git clone https://github.com/aleto44/chesscoach.git
```

```bash
cd chesscoach
```

```bash
npm install
```

```bash
npm run tauri dev
```

That's it. `npm install` sets everything up for you: it patches the board library, copies
**Stockfish** into place and downloads the **Maia** model (~46 MB). The Lichess puzzle database
downloads inside the app the first time you open Puzzles.

> **Windows shortcut:** `scripts/start-dev.ps1` launches the app, reinstalls packages when they
> change and restarts the app if it crashes. Point a desktop shortcut at it.

To build an installer instead:

```bash
npm run tauri build
```

---

## Development

| | |
| --- | --- |
| `src/` | React + TypeScript frontend (boards, trainers, review, chat) |
| `src-tauri/` | Rust backend: SQLite storage, coach process, puzzle DB, imports, phone server |
| `src/engine/` | Stockfish and Maia, running in the browser (WASM / ONNX) |
| `src/rating.ts` | Rating scale conversions (everything shown is on the chess.com scale) |

```bash
npx tsc --noEmit
```

```bash
npm run dev
```

The first command type-checks. The second runs the web UI alone on port 1420. Opening lines are
checked with `node scripts/check-book.mjs`. Contributor and AI-assistant conventions are in
[.github/copilot-instructions.md](.github/copilot-instructions.md).

---

## Credits

- [Stockfish](https://stockfishchess.org/) (GPL-3.0): engine analysis
- [Maia](https://github.com/CSSLab/maia3) (AGPL-3.0), by the CSSLab at the University of Toronto: human-like opponents
- [Lichess open database](https://database.lichess.org/) (CC0): puzzles
- [Chessground](https://github.com/lichess-org/chessground) and [chess.js](https://github.com/jhlywa/chess.js): the board and the rules
- [Claude](https://claude.com/): the coach
