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
  Games (play a rated or practice game, analysis board), School (drills, opening training with the
  repertoire, the endgame trainer, guess the move), Puzzles, and Profile (weaknesses, rating history,
  saved games, import from chess.com and Lichess), each with its own sub-menu. The top bar's back button
  returns one level, and the brand / home button returns to the main menu.
- The view lives in `useNav` (`src/nav.ts`). Puzzle, drill, opening, endgame and guess-the-move sessions have
  their own stores (`src/puzzles/session.ts`, `src/analysis/drillSession.ts`, `src/openings/session.ts`,
  `src/endgames/session.ts`, `src/guess/session.ts`); starting one shows its board, and starting one stops
  the others.
- The opening and endgame trainers are not games: they never create a game or show up in saved games, and
  they can start while a game is in progress (a rated game's clock pauses meanwhile, `src/game/clock.ts`).
  Opening sets live in `src/openings/training.ts`, checked by `node scripts/check-book.mjs`. The trainer
  matches moves by what's left of the line, not by ply (`src/openings/order.ts`): a move the line plays
  later is fine when the engine says the order costs nothing, and an engine-equal move outside the line
  is marked "≈", not wrong.
- Screens that aren't a game ask the coach one-off questions with `coach_explain` (`src/coach.rs` `explain`):
  no tools, no conversation, so it works during a rated game. Its answers show in the chat column through
  `src/coach/trainerChat.ts`, a thread of their own that is never saved into the game's chat. Hand it computed
  facts (engine evals) the way the chat coach gets them; the opening trainer's "why not" is the example
  (`src/openings/explain.ts`).
- "Real games" are rated games here plus imported ones (`games.source` set, stored as rated, never moving
  the in-app rating). The Profile and the coach's profile judge the student on those, never on practice.
- Phones keep working offline for puzzles and drills (`src/offline.ts`): calls fall back to a pack kept on
  the phone and writes wait in an outbox. A new puzzle or drill call should go through `orOffline`.
- Board sounds (`src/sound.ts`) follow whichever board is on screen: game, puzzle, drill, endgame or guess.

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
