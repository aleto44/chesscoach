# Chess Coach — Plan

Carried over from the planning discussion in the Claude app.

## 1. LLM backend: Claude subscription via `claude -p`

Don't call the API directly. The app spawns the Claude Code CLI headless as a child process:

```
claude -p --input-format stream-json --output-format stream-json \
  --mcp-config chess-tools.json --allowedTools "mcp__chess__*" \
  --system-prompt "$(cat coach.md)" --resume <session_id>
```

- Streamed, long-running conversation, custom tools, resumable sessions, billed to the existing login.
- Policy: fine for personal/local use. A product with paying users should move to API keys.
  Re-check the Help Center page before building:
  https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Keep the LLM behind a small `CoachBackend` interface so switching to an API key is a config change.

**Stack:** Rust/Tauri + React (same as Dijon). Rust owns the Claude process, engines and SQLite; React owns the UI.

## 2. Tool surface (the core design)

| Tool | Purpose |
|---|---|
| `get_state` | FEN, move list, side to move, mode, current focus (e.g. "Caro-Kann, Advance") |
| `analyze(fen, multipv, depth)` | Stockfish top lines + evals. System prompt forbids stating any eval without calling it |
| `show_line(title, start_fen, moves[], notes[])` | Validates every move with chess.js, opens a tangent card. Illegal moves return an error so the coach self-corrects |
| `setup_position(fen, purpose)` | Sandbox board for side lessons |
| `ask_move(fen, prompt, accepted[], wrong_feedback{})` | Blocks until the user moves. **The app grades**, not the LLM: correct if in `accepted` or within ~30cp of engine best. Result goes back to the coach |
| `play_move` / `take_back` / `draw_arrows` | Main board control |
| `book_lookup(fen)` | Repertoire move + move popularity (local book or Lichess explorer) |
| `get_profile` / `query_games` / `record_observation(tag, evidence, ±)` | Long-term memory |

The coach never picks opponent moves itself. Maia (human-like at a set rating) or reduced-strength Stockfish
chooses them; the coach can steer via `book_lookup` into the opening being worked on.

## 3. UI

- Main board left, chat right. Coach messages can embed small interactive boards, not coordinate lists.
- Tangents are a stack with breadcrumbs: `Game › Why not …Nf6? › What if White plays e5`.
  Each tangent is a full board with step-through and can branch. "Return to game" pops back.
  Store tangents as a tree (like PGN variations), not a flat list.
- Board: Chessground (lichess's library) — animation, arrows, highlights, drag-and-drop.

## 4. Modes

1. **Spar** — play Maia, coach watches; speaks only on meaningful events (leaving repertoire, eval swing past
   threshold, a tagged weakness appears). Can pause to quiz before you move.
2. **Opening drill** — walks the repertoire tree with `ask_move`, explains main lines, tangents on mistakes.
3. **Review** — app finds 3–5 critical moments deterministically; coach goes through them Socratically.
4. **Lesson** — open conversation, free use of sandbox boards.

## 5. Strengths / weaknesses tracking

- **Measured by code:** per-move centipawn loss by phase/opening/position type, blunders, ply left book,
  time used, drill pass/fail. No LLM needed.
- **Tagged by the coach** from a fixed tag set (`tactics.fork`, `endgame.rook`, `opening.caro_kann.advance`,
  `plans.minority_attack`, `calc.depth`, …) so stats aggregate across games.

Tables: `games`, `moves` (FEN, eval before/after, cp loss, tags), `repertoire` (tree keyed by FEN+move),
`drill_items` (SRS: due, interval, ease, lapses), `skill_observations`, `skill_stats`, `coach_notes`.

Before each session, build a ~400-token profile (focus areas, 3 weakest tags, drills due, trends) into the
system prompt. Details stay behind `query_games`. What to test is mostly code (SRS due + weakest tags + focus);
the coach turns it into a lesson plan.

## 6. Cheap and fast

Call Claude only on events (user messages, critical moments, game end), never every move. Send position +
last few moves + engine summary, not the whole PGN.

## Build order

1. Board, chess.js, Stockfish (WASM or native), `claude -p` bridge with `get_state`, `analyze`, `show_line`.
   Tangent cards working. Proves the concept.
2. `ask_move` grading + opening drill mode with hand-entered repertoire.
3. SQLite game storage, review mode, skill tags, profile summary.
4. Maia opponent, SRS drill scheduling, spar-mode triggers.

**Main risk:** prompt discipline in step 1 — making Claude verify lines with tools instead of quoting from
memory. Prototype the system prompt early against tricky opening positions.
