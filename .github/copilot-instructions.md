# Chess Coach: instructions for AI assistants

Chess Coach is a server (`server/`, Rust: the SQLite database, the coach and an HTTP API, run in Docker on
laptop-server) with two clients of the same React + TypeScript + Vite frontend (`src/`): a desktop app
(`src-tauri/`, a thin Tauri window over the bundled frontend) and the phone's web app, served by the
server. Both talk HTTP to the server (`src/backend.ts`); see `docs/server-migration.md` for how it fits
together and `scripts/deploy.ps1` to ship server changes. It has practice and rated games against Maia /
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
  `rating_pool` in `server/src/db.rs`, split by base + 40 × increment like chess.com); a game with no
  clock counts as rapid. Each lives in its own setting (`RATING_KEYS` in `src/settings.ts`), set in
  Settings; unset bullet and blitz start from rapid.

## Layout and navigation

- The left/middle column shows the **home menu** (`src/components/Home.tsx`) or the screen picked from it:
  Games (Play rated: pick a clock and get paired with a Maia near your rating, `src/game/matchmaking.ts`;
  Choose game: every option, rated or practice), School (drills, opening training (a submenu: New opening training, the courses,
  and the Legacy opening trainer: side, then an opening, then Main lines or Punish mistakes), the endgame trainer, guess the move, win it again, find the plan, opening leaks), Puzzles, and Profile (weaknesses, rating history,
  saved games, import from chess.com and Lichess). Saved games is its own screen
  (`src/components/SavedGames.tsx`): filters by source (chess.com, Lichess, rated or practice here),
  clock, color, result, date and opponent/opening, and a games-over-time chart with wins, draws and
  losses built from the same filtered list, and Utility (the free analysis board, and a
  two-player chess clock for over-the-board games, `src/utility/timer.ts` + `src/components/Timer.tsx`:
  full-screen on phones, the top half turned to the player across, separate time and increment per
  side for odds games), each with its own sub-menu. The top bar's back button
  returns one level, and the brand / home button returns to the main menu.
- The view lives in `useNav` (`src/nav.ts`). Puzzle, drill, opening, endgame and guess-the-move sessions have
  their own stores (`src/puzzles/session.ts`, `src/analysis/drillSession.ts`, `src/openings/session.ts`,
  `src/endgames/session.ts`, `src/guess/session.ts`, `src/plans/session.ts`); starting one shows its board, and
  starting one stops the others.
- Three School trainers work from the student's own analyzed games, loaded once through
  `db_training_games` (`src/training/games.ts`): "Win it again" (`src/convert/positions.ts`: positions they
  were clearly better in and didn't win, or worse but holding and lost, played in the endgame session as a
  `spec` with its own bars), "Find the plan" (`src/plans/`: quiet, non-tactical middlegame slips; the
  engine grades the move and `describe.ts` names the plan) and "Opening leaks" (`src/openings/leaks.ts`:
  real games only; repeated costly positions and the engine's move). There are no opening-line drills
  any more (the old ones are retired), and no repertoire feature any more (removed on purpose; the old `repertoire` table is
  left unused). Endgame positions that Stockfish can't score as won without
  tablebases (bishop and knight mate) don't work in the endgame trainer, which judges by eval.
  The trainer's "Surprise me" (`src/endgames/surprise.ts`) plays a random hand-written ending (pawns plus
  at most one minor piece or a queen, to win or to hold) whose hints are its ideas, one card per hint
  with drawings, in the opening plans' format; `node scripts/check-endgames.mjs` checks the results and
  drawings. A "watch out" idea must name a move the engine really punishes. The written ideas speak from
  the start position only; once the student has moved, hints are about the board as it is
  (`src/endgames/now.ts`: the opponent's threat, loose pawns, passed pawns and the square, the kings, then
  the engine's move and what it does).
- The opening and endgame trainers are not games: they never create a game or show up in saved games, and
  they can start while a game is in progress (a rated game's clock pauses meanwhile, `src/game/clock.ts`).
  Opening sets live in `src/openings/training.ts`, checked by `node scripts/check-book.mjs`. Every
  built-in line has a plan in `src/openings/plans.ts` (two or three ideas with drawings for the line's
  final position), shown when the student finishes the line; a new line needs one, and the check fails
  without it. The check also reads every move the plans and move notes (`guides.ts`) name the way the
  board shows them, and fails on one it can't place: write a move so it can be played where the text
  speaks from, as a line ("...Bxg3 hxg3"), one side's plan ("...g6, ...Bg7 and ...O-O"), a route
  ("...Na6-c5") or a numbered move past the line's end ("10.e5"). The trainer
  matches moves by what's left of the line, not by ply (`src/openings/order.ts`): a move the line plays
  later is fine when the engine says the order costs nothing, and an engine-equal move outside the line
  is marked "≈", not wrong.
  Lines teach moves; structure cards (`src/openings/structures.ts`) teach what kind of game it is. They're
  recognized from the pieces, not the line, so a transposition counts (1.d4 Nf6 2.Nc3 g6 3.Nf3 Bg7 4.e4
  is a Pirc): when the board turns into one (a Pirc, a King's Indian, Bc4 or Be3 or f4 in the Pirc) its
  button under the board lights up, and the card with the ideas opens only when clicked. Tactic
  patterns (the fork trick) never show while the student has to find the move, only as "Missed: ..."
  after a wrong one. `node scripts/check-structures.mjs` lists where each card opens along every line and
  checks with Stockfish that each pattern really works wherever it fires.
  Now and then the opponent plays a mistake instead of the book move: one from `src/openings/traps.ts`,
  precomputed by `node scripts/find-traps.mjs` (Maia says players of a rating really make it, Stockfish
  says it loses at least a pawn). Run that again after adding or changing lines; nothing is searched live.
  Then run `node scripts/explain-traps.mjs`: it writes `src/openings/trapNotes.ts`, what each trap and
  detour is about, worked out from the board and Stockfish (what the mistake took away, what taking back
  runs into, the threat). Hint shows that first (the arrow on a second press), and "Why" explains it once
  the trap is punished. A trap with nothing concrete to find (`positional`) isn't played.
  Quiet openings hide most of their traps one step off the book, so the script also stores detours
  (`ROUTES`): a sound, common non-book move, the student's natural answer, then the mistake. To judge
  traps outside the app, `node scripts/trap-harness.mjs [--set london] [--detours]` writes
  `trap-preview.html` (open it at `localhost:1420/trap-preview.html`), each trap stepped through as a drill.
- An opening can have a course (`src/openings/courses/`, listed in `index.ts`: the King's Indian and the London), shown in
  New opening training (the `openings-course` screen: side, then a course, then its map,
  `src/components/CourseMap.tsx`); the line sets stay in the Legacy opening trainer (`openings-legacy`)
  until each opening gets its course. A course teaches decisions, not lines:
  chapters are the opponent's setups, each node a position (`path`), the course's move, what the
  opponent's last move means (`recognize`), why the answer, and a `watch` move that loses. A study run
  (`src/openings/courseSession.ts`, on the opening trainer's store with `course` set, shown by
  `CoursePanel.tsx`) starts each decision at its own position: new ones are taught (card and arrow
  first), then asked from memory; a move players really make there that loses is played out against
  the student ("Don't get caught"). A decision missed twice gets the coach's closer look
  (`src/openings/courseMemo.ts`, one `coach_explain` call kept in the setting `openingCourseMemos`):
  what to spot in the position (an extra Hint step, before the arrow) and a rule of thumb against the
  moves the student keeps playing, written again from another angle after three more misses. Progress is spaced like drills (`src/openings/progress.ts`, setting
  `openingCourse`). `node scripts/check-course.mjs` checks every answer against Stockfish, and
  `node scripts/find-pitfalls.mjs` (Maia + Stockfish) writes `src/openings/pitfalls.ts`; run both after
  editing a course.
- Screens that aren't a game ask the coach one-off questions with `coach_explain` (`server/src/coach.rs` `explain`):
  no tools, no conversation, so it works during a rated game. Its answers show in the chat column through
  `src/coach/trainerChat.ts`, a thread of their own that is never saved into the game's chat. Hand it computed
  facts (engine evals) the way the chat coach gets them; the opening trainer's "why not" is the example
  (`src/openings/explain.ts`).
- A mistake drill is a teaching moment, decided when it's captured: `addMistakeDrills` works out its
  lesson (`src/analysis/lesson.ts`: the game move against the best move, searched deeply, with its
  themes) and stores it in `drills.lesson`; a position with no concrete theme doesn't become a drill.
  Each drill also gets a category (`src/analysis/drillCategory.ts`: hung material, walked into a tactic,
  missed free material, missed tactics, mates, long-term, puzzles, coach), stored in `drills.category`
  and worked out again with each new lesson. The Drills menu's "Due drills" is every due drill
  shuffled; its "Focus on one kind" tiles start one category.
  A drill session only works out why a *different* wrong answer is bad; everything else it shows,
  right answer or wrong, comes from the lesson. Older drills get theirs from `backfillLessons`.
- Fat-finger recall: no takeback button in rated games or puzzles, on purpose. Holding ◀ (the move-stepping
  back arrow, `BackButton` in `StepButtons.tsx`) for three seconds opens a confirm: a rated game takes back the
  student's last move (counted in `takebacks`), and a puzzle's first wrong move is voided (`undoMiss`, `puzzle_void`: the try and its drill are deleted,
  so the rating and theme XP replay without it). Both are the student's own honesty.
- "Real games" are rated games here plus imported ones (`games.source` set, stored as rated, never moving
  the in-app rating). The Profile and the coach's profile judge the student on those, never on practice.
- Every client keeps working offline for whatever runs on the device (`src/offline.ts`): puzzles, drills
  and opening courses (a course answer is saved per decision with `db_course_progress`, merged on the
  server, later answer wins) answer from a pack kept on the device, and writes wait in an outbox. A new
  puzzle or drill call should go through `orOffline`. Games against the engines play offline too, rated
  ones included: a game started while the server is away gets a local (negative) id and is kept on the
  device (`src/game/local.ts`), then sent, rated and reviewed once the server is back. The coach and
  imports need the server.
- Every device shares the server's database, and the student's progress must look the same on
  all of them. Keep progress (results, scores, spaced-repetition state) in the database or a setting, never in
  localStorage, which is per device (fine for UI choices like filters or the last screen). A device holds
  what it loaded at startup, so every write that changes what another device shows is announced:
  settings via `setting-changed` (`initSettingsSync` in `src/settings.ts`, including ratings moved by
  `rate_game`), puzzle and drill progress via `data-changed` (`notify_data_changed` in `server/src/lib.rs`),
  games via `game-changed`. A device that may have missed them rereads on `resync` (`src/backend.ts`). A new
  kind of shared progress needs the same.
- Whatever is in progress is mirrored live between devices (`src/live.ts`, `server/src/live.rs`): each
  session store (puzzles, drills, the opening, endgame, guess-the-move and find-the-plan trainers, the
  trainers' coach thread) is sent to the server after every change, with the version it started from; a
  stale one is refused and that device takes the server's state. Other devices that are in the session
  mirror it; the rest offer "Continue" on Home and never jump in by themselves. A new session store must
  hold plain JSON data and be added to `STORES` there. The engine answers only in the code that handled
  the student's move, never from a store subscription, so a mirroring device can't move twice.
- Board sounds (`src/sound.ts`) follow whichever board is on screen: game, puzzle, drill, endgame or guess.

## Boards: the student can always draw

Every chessboard on screen takes the student's drawings: right-click drag on desktop, and on phones the
top bar's pencil (`src/components/DrawMode.tsx`): draw mode, where a tap circles and a drag draws an
arrow; a press off the boards or on the pencil ends it and keeps the drawings, and the next ordinary
tap on the board clears them. There is no two-finger drawing any more (phones cancel held touches). That covers the game board, analysis and review,
  Phone touch bugs can't be reproduced with scripted touches: set `SEND_FROM_PHONES` in `src/touchLog.ts`
  (dev builds; phones reload by themselves) and each phone streams its touches, holds, dialogs and errors to
  `phone-debug.log` in the project (`dev_log`, `server/src/devlog.rs`, when the server runs from the repo). `?touchlog` also shows it on screen.
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
  (`src/voice/confirm.ts`): rated games, rated puzzles and unsure readings by default; a long-press (right-click on desktop) on the mic turns it off or on for the rated ones. Phones need the https address.
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
