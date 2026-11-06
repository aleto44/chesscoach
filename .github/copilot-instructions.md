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

## Boards: the student can always draw

Every chessboard on screen takes the student's drawings: right-click drag on desktop, the two-finger
method on phones (one finger held, the other draws). That covers the game board, analysis and review,
drills, puzzles, the why-screen, the coach's scenario boards and any board added later.

- Use `src/components/Board.tsx` for every board. `viewOnly` there only stops piece moves; drawing still
  works. Only a thumbnail inside a button (`preview`, e.g. chat cards) has no drawing.
- Never pass Chessground's own `viewOnly` or `drawable.enabled: false` to a full-size board.
- The student's drawings belong to the position: they clear when the position changes, not on re-renders.

## What-if moves

Boards that show a fixed line (a finished game in review, the why-screen's lines) take the student's
moves for both sides as a fork (`src/chess/explore.ts`): playing something other than the line's next
move stacks new moves from there, and stepping back to the fork point drops them and brings the line back.

## The coach and the board

The coach explains with the board, not with move lists. `show_line` and `setup_position` make scenarios
with the coach's arrows and circles per step, and return a key (`s1`, `s2`, ...). The coach links to them
in its text as `[words](#s1)`; the chat renders those as buttons that open the scenario on the main board.

## Code style

- Match the surrounding code: short doc comments that explain *why*, small zustand stores, plain
  functions over classes.
- Chessground is patched via `patches/chessground+9.2.1.patch` (patch-package). Edit
  `node_modules/chessground/dist/*.js`, then run `npx patch-package chessground`.
- Check with `npx tsc --noEmit`; run the web UI with `npm run dev` (port 1420).
