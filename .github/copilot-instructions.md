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
- The student has three game ratings here, bullet, blitz and rapid (`ratingPool` in `src/rating.ts`,
  `rating_pool` in `src-tauri/src/db.rs`, split by base + 40 × increment like chess.com); a game with no
  clock counts as rapid. Each lives in its own setting (`RATING_KEYS` in `src/settings.ts`), set in
  Settings; unset bullet and blitz start from rapid.

## Layout and navigation

- The left/middle column shows the **home menu** (`src/components/Home.tsx`) or the screen picked from it:
  Games (Play rated: pick a clock and get paired with a Maia near your rating, `src/game/matchmaking.ts`;
  Choose game: every option, rated or practice), School (drills, opening training with the
  repertoire, the endgame trainer, guess the move), Puzzles, and Profile (weaknesses, rating history,
  saved games, import from chess.com and Lichess), and Utility (the free analysis board, and a
  two-player chess clock for over-the-board games, `src/utility/timer.ts` + `src/components/Timer.tsx`:
  full-screen on phones, the top half turned to the player across, separate time and increment per
  side for odds games), each with its own sub-menu. The top bar's back button
  returns one level, and the brand / home button returns to the main menu.
- The view lives in `useNav` (`src/nav.ts`). Puzzle, drill, opening, endgame and guess-the-move sessions have
  their own stores (`src/puzzles/session.ts`, `src/analysis/drillSession.ts`, `src/openings/session.ts`,
  `src/endgames/session.ts`, `src/guess/session.ts`); starting one shows its board, and starting one stops
  the others.
- The opening and endgame trainers are not games: they never create a game or show up in saved games, and
  they can start while a game is in progress (a rated game's clock pauses meanwhile, `src/game/clock.ts`).
  Opening sets live in `src/openings/training.ts`, checked by `node scripts/check-book.mjs`. Every
  built-in line has a plan in `src/openings/plans.ts` (two or three ideas with drawings for the line's
  final position), shown when the student finishes the line; a new line needs one, and the check fails
  without it. The trainer
  matches moves by what's left of the line, not by ply (`src/openings/order.ts`): a move the line plays
  later is fine when the engine says the order costs nothing, and an engine-equal move outside the line
  is marked "≈", not wrong.
  Now and then the opponent plays a mistake instead of the book move: one from `src/openings/traps.ts`,
  precomputed by `node scripts/find-traps.mjs` (Maia says players of a rating really make it, Stockfish
  says it loses at least a pawn). Run that again after adding or changing lines; nothing is searched live.
- Screens that aren't a game ask the coach one-off questions with `coach_explain` (`src/coach.rs` `explain`):
  no tools, no conversation, so it works during a rated game. Its answers show in the chat column through
  `src/coach/trainerChat.ts`, a thread of their own that is never saved into the game's chat. Hand it computed
  facts (engine evals) the way the chat coach gets them; the opening trainer's "why not" is the example
  (`src/openings/explain.ts`).
- A mistake drill is a teaching moment, decided when it's captured: `addMistakeDrills` works out its
  lesson (`src/analysis/lesson.ts`: the game move against the best move, searched deeply, with its
  themes) and stores it in `drills.lesson`; a position with no concrete theme doesn't become a drill.
  A drill session only works out why a *different* wrong answer is bad; everything else it shows,
  right answer or wrong, comes from the lesson. Older drills get theirs from `backfillLessons`.
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
- Square colors, piece set and coordinate size (Settings → Visuals) apply page-wide from `src/visuals.ts`
  (CSS variables plus a piece `<style>`); don't hard-code board colors or piece images in a board's CSS.
- Never pass Chessground's own `viewOnly` or `drawable.enabled: false` to a full-size board.
- On desktop the student can type a move (e2e4, Nf3, O-O) when no text field has focus: `Board` shows it
  green/red over the board, Enter plays it and Escape drops it (`src/chess/typed.ts`). Keys go to the last
  mounted board that's on screen and takes moves; it types whichever side is to move.
- Moves can also be spoken (the top bar's mic, `src/components/Voice.tsx`): Vosk recognizes offline on
  the device with a chess-words grammar (`src/voice/listen.ts`, model from `scripts/setup-vosk.mjs`),
  `src/voice/parse.ts` reads the words against the legal moves (checked by `node scripts/check-voice.mjs`),
  and they go to the same board typed moves do. A move waits for a yes per `needsConfirm`
  (`src/voice/confirm.ts`): rated games and unsure readings by default. Phones need the https address.
- The student's drawings belong to the position: they clear when the position changes, not on re-renders.
- Any text about a position on screen, not only the coach's chat, makes its squares and moves hoverable
  (desktop) and tappable (phones) so they show on the board: render it with `SquareText` / `SquareRef`
  (`src/components/SquareText.tsx`). Trainer messages and the opening plans do.
- Give `SquareText` the position the text speaks from (`at`, plus `earlier` / `game` when it names
  older or numbered moves; `lastMoveContext` in `src/chess/line.ts` for trainer messages). Moves are then
  placed by `splitSquares` (`src/chess/squareRefs.ts`): a written-out line is played move after move, a
  numbered move is found in the game, and hovering a move from another position shows that position on
  the board with the line so far as numbered arrows (the student's drawings come back after).

## What-if moves

Boards that show a fixed line (a finished game in review, the why-screen's lines) take the student's
moves for both sides as a fork (`src/chess/explore.ts`): playing something other than the line's next
move stacks new moves from there, and stepping back to the fork point drops them and brings the line back.

## The analysis board

The top bar's magnifier (`AnalysisButton`, `src/components/Analysis.tsx`) opens a board one level
above the current screen (`src/analysis/layer.ts`), at the same position with that screen's moves, what-if
forks for both sides, the eval bar and the engine's top 3 lines (hover a move for a thumbnail, click to
play up to it). The screen underneath keeps its state; back / Escape returns to it. `analysisSource` decides
where it's allowed: never during a rated game, and on puzzles, drills, endgames and guess-the-move only
once the position is answered. A new screen with a board adds its case there.

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
