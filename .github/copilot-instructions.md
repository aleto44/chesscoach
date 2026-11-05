# Chess Coach: instructions for AI assistants

Chess Coach is a Tauri 2 desktop app (Rust backend in `src-tauri/`, React + TypeScript + Vite frontend in
`src/`) with a phone client served from the computer. It has practice and rated games against Maia /
Stockfish, a post-game review, spaced-repetition drills, a Lichess puzzle trainer, and an AI coach in the
chat column.

## Ratings: always chess.com Elo for the user

Every rating the user sees, and every rating the coach talks about, is on the **chess.com rating scale**
(chess.com rapid). That includes opponent strength, game ratings in the report, the puzzle rating, a
puzzle's own rating, rating changes, and any rating the coach reads from a tool or profile.

Ratings from other systems are converted in code to the scale of whatever they describe:

- **Lichess** (puzzle ratings, the student's puzzle rating, Maia's training data): stored and queried on
  Lichess's scale, converted with `fromLichess` / `toLichess` in `src/rating.ts`.
- **Stockfish `UCI_Elo`** (engine-list calibration): `toEngineElo` in `src/engine/stockfish.ts`.
- **Maia**: takes a Lichess rating; `src/engine/maia.ts` converts from chess.com.

Rules:

- Store and pass around the source system's numbers where that system needs them (database queries,
  engine options), but convert at the edge: anything rendered in the UI or written into text for the
  coach is chess.com scale.
- Coach tool inputs that take a rating (e.g. `find_puzzles` `rating_min`/`rating_max`) accept chess.com
  numbers and convert before querying.
- Rating *changes* are the difference of the converted values, not a converted difference.
- Add new scales to `src/rating.ts` (or next to the engine they belong to) rather than inlining numbers.

## Layout and navigation

- The left/middle column shows the **home menu** (`src/components/Home.tsx`) or the screen picked from it:
  Games (practice / rated / saved games), Drills, and Puzzles, each with its own sub-menu. The top bar's
  back button returns one level, and the brand / home button returns to the main menu.
- The view lives in `useNav` (`src/nav.ts`). Puzzle and drill sessions have their own stores
  (`src/puzzles/session.ts`, `src/analysis/drillSession.ts`); starting one shows its board.
- Board sounds (`src/sound.ts`) follow whichever board is on screen: game, puzzle or drill.

## Code style

- Match the surrounding code: short doc comments that explain *why*, small zustand stores, plain
  functions over classes.
- Chessground is patched via `patches/chessground+9.2.1.patch` (patch-package). Edit
  `node_modules/chessground/dist/*.js`, then run `npx patch-package chessground`.
- Check with `npx tsc --noEmit`; run the web UI with `npm run dev` (port 1420).
