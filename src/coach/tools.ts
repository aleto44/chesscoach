// Handlers for the tools declared in src-tauri/src/tools.rs.
import { invoke } from "../backend";
import { Chess } from "chess.js";
import { buildLine, formatMoves, sideToMove, type Line } from "../chess/line";
import type { DrawShape } from "chessground/draw";
import { formatScore, getEngine, pvToSan } from "../engine/stockfish";
import { clockLeft, formatClock } from "../game/clock";
import { gamesText, profileText } from "./profile";
import { continuations, openingName } from "../openings/book";
import { START_FEN } from "../chess/line";
import { getRepertoire } from "../openings/repertoire";
import { askMove } from "./quiz";
import { findPuzzles, openingLabel, openingTag, refreshPuzzleDb, themeKey, themeLabel, usePuzzleDb } from "../puzzles/puzzles";
import { puzzleContext, startCoachSet, usePuzzle } from "../puzzles/session";
import { drillContext, useDrill } from "../analysis/drillSession";
import { openingContext, openingSetOf, useOpening } from "../openings/session";
import { endgameContext, endgameOf, useEndgame } from "../endgames/session";
import { guessContext, useGuess } from "../guess/session";
import { peeking } from "../nav";
import { fromLichess, toLichess } from "../rating";
import { evalWords, lineReport, materialChange, positionFacts, storedEval, topMoves } from "./insight";
import { explainCached } from "../analysis/explain";
import { lossFromEvals, classify } from "../analysis/review";
import type { Key } from "chessground/types";
import {
  addTangent,
  boardOrientation,
  openTangent,
  gameDescription,
  isLocked,
  newId,
  nextScenarioKey,
  pushChat,
  screen,
  screenFen,
  tangentPath,
  useStore,
  type Color,
} from "../store";

export interface ToolResult {
  text: string;
  isError?: boolean;
}

type Args = Record<string, unknown>;

const handlers: Record<string, (args: Args) => Promise<ToolResult>> = {
  async get_state() {
    const s = useStore.getState();
    const { tangent } = screen();
    const state = {
      mode: gameDescription(),
      focus: null,
      onScreenFen: boardFen(),
      game: {
        fen: s.game.fens[s.gamePly],
        moves: formatMoves(s.game),
        viewingPly: s.gamePly,
        totalPlies: s.game.sans.length,
        sideToMove: sideToMove(s.game.fens[s.gamePly]),
        clock: s.meta.timeControl && {
          white: formatClock(clockLeft("white")!),
          black: formatClock(clockLeft("black")!),
          // Seconds each move took, for spotting time trouble or rushed moves.
          moveTimes: moveTimes(),
        },
      },
      openTangent: tangent && {
        breadcrumbs: ["Game", ...tangentPath(tangent.id).map((t) => t.title)].join(" > "),
        startFen: tangent.line.startFen,
        moves: formatMoves(tangent.line),
        viewingPly: tangent.ply,
        fen: tangent.line.fens[tangent.ply],
        author: tangent.author,
      },
    };
    return { text: JSON.stringify(state, null, 2) };
  },

  async analyze(args) {
    const fen = typeof args.fen === "string" && args.fen ? args.fen : boardFen();
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch (e) {
      return { text: `Invalid FEN: ${(e as Error).message}`, isError: true };
    }
    if (chess.isGameOver()) {
      const why = chess.isCheckmate() ? "checkmate" : chess.isStalemate() ? "stalemate" : "draw";
      return { text: `No analysis: the position is over (${why}).` };
    }
    const multipv = clamp(Number(args.multipv ?? 3), 1, 5);
    const depth = clamp(Number(args.depth ?? 16), 8, 22);
    const lines = await getEngine().analyze(fen, multipv, depth);
    const head = `Position ${fen} (${sideToMove(fen)} to move).`;
    const body = lines.map((l, i) => {
      // What the line comes to in material, so "wins a piece" is read off, not guessed.
      const end = pvEnd(fen, l.pv, 10);
      return `${i + 1}. ${evalWords(storedEval(l))} (raw ${formatScore(l)}, depth ${l.depth})  ${pvToSan(fen, l.pv)}\n   Over these moves: ${materialChange(fen, end)}.`;
    });
    return { text: [head, ...body, "Position facts:", ...positionFacts(fen).map((f) => `- ${f}`)].join("\n") };
  },

  async show_line(args) {
    const start = typeof args.start_fen === "string" && args.start_fen ? args.start_fen : boardFen();
    const moves = Array.isArray(args.moves) ? args.moves.map(String) : [];
    const notes = Array.isArray(args.notes) ? args.notes.map(String) : [];
    if (moves.length === 0) return { text: "moves is empty.", isError: true };
    const built = buildLine(start, moves, notes);
    if ("error" in built) return { text: built.error, isError: true };

    const drawn = parseShapes(args, moves.length);
    if ("error" in drawn) return { text: drawn.error, isError: true };

    const title = String(args.title ?? "Line");
    const ply = clamp(Number(args.ply ?? 0), 0, moves.length);
    const open = args.open === true;
    const { key } = addScenario(title, built.line, ply, drawn.shapes, open, sideArg(args));
    const end = built.line.fens[built.line.fens.length - 1];
    // The engine's verdict on every move, so what the coach says about the line matches it.
    const report = await lineReport(built.line.fens, built.line.sans);
    return {
      text:
        `Scenario ${key} "${title}"${open ? ", open on the student's board" : ""}: ${formatMoves(built.line)}\n` +
        `Final position: ${end}\n${report}\n${linkHint(key)}`,
    };
  },
};

const SQUARE = /^[a-h][1-8]$/;
const BRUSHES: Record<string, string> = { green: "green", red: "red", blue: "blue", yellow: "yellow" };

/** A coach board (tangent) with its chat card, key, drawings and the side at the bottom. */
function addScenario(title: string, line: Line, ply: number, shapes: Record<number, DrawShape[]>, open: boolean, side: Color | null) {
  const key = nextScenarioKey();
  const tangent = addTangent({ parentId: useStore.getState().active, title, author: "coach", line, ply });
  pushChat({ kind: "tangent", id: newId("c"), tangentId: tangent.id, key, shapes, orientation: side ?? screenSide() });
  if (open) openTangent(tangent.id);
  return { key, tangent };
}

/** The coach's `side` argument: whose point of view the board shows. */
const sideArg = (args: Args): Color | null => (args.side === "white" || args.side === "black" ? args.side : null);

/**
 * The side at the bottom of the board the student is looking at: a puzzle's or drill's side, else
 * the main board's (the game's, or the open scenario's). New scenarios keep it, so a position the
 * student had as Black is shown from Black's side.
 */
export function screenSide(): Color {
  if (!peeking()) {
    const puzzle = usePuzzle.getState();
    if (puzzle) return puzzle.color;
    const d = useDrill.getState();
    const drill = d?.queue[d.index];
    if (drill) return drill.color;
    const opening = useOpening.getState();
    if (opening) return openingSetOf(opening).color;
    const endgame = useEndgame.getState();
    if (endgame) return endgameOf(endgame).side;
    const guess = useGuess.getState();
    if (guess) return guess.side;
  }
  return boardOrientation();
}

/**
 * The position the student is looking at: a puzzle's, drill's or trainer's when one is on the
 * board, else the main board's. The tools' default when the coach gives no FEN.
 */
function boardFen(): string {
  if (!peeking()) {
    const trainer = puzzleContext() ?? drillContext() ?? openingContext() ?? endgameContext() ?? guessContext();
    if (trainer) return trainer.fen;
  }
  return screenFen();
}

const linkHint = (key: string) =>
  `In your reply, put a link on the words that talk about it, [words](#${key}): the student taps it to open it on the board.`;

/**
 * A scenario's `arrows` and `circles`. Each may give `at`: how many of the line's moves have been
 * played when it shows (0, the default, is the starting position).
 */
function parseShapes(args: Args, plies: number): { shapes: Record<number, DrawShape[]> } | { error: string } {
  const shapes: Record<number, DrawShape[]> = {};
  const bad: string[] = [];
  const at = (v: unknown) => clamp(Number(v ?? 0), 0, plies);
  const add = (ply: number, shape: DrawShape) => (shapes[ply] ??= []).push(shape);
  for (const a of Array.isArray(args.arrows) ? (args.arrows as Args[]) : []) {
    const { from, to, color } = a as Record<string, string>;
    if (!SQUARE.test(from) || !SQUARE.test(to) || from === to) bad.push(`${from}-${to}`);
    else add(at(a.at), { orig: from as Key, dest: to as Key, brush: BRUSHES[color] ?? "green" });
  }
  for (const c of Array.isArray(args.circles) ? (args.circles as Args[]) : []) {
    const { square, color } = c as Record<string, string>;
    if (!SQUARE.test(square)) bad.push(square);
    else add(at(c.at), { orig: square as Key, brush: BRUSHES[color] ?? "green" });
  }
  return bad.length ? { error: `Not squares: ${bad.join(", ")}. Use e.g. "e4". Nothing was shown.` } : { shapes };
}

Object.assign(handlers, {
  async ask_move(args: Args) {
    const fen = typeof args.fen === "string" && args.fen ? args.fen : boardFen();
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch (e) {
      return { text: `Invalid FEN: ${(e as Error).message}`, isError: true };
    }
    if (chess.isGameOver()) return { text: "That position is already over; nothing to ask.", isError: true };
    const accept = Array.isArray(args.accept) ? args.accept.map(String) : [];
    const legal = new Set(chess.moves());
    const bad = accept.filter((m) => !legal.has(m));
    if (bad.length) return { text: `Not legal here: ${bad.join(", ")}. Legal: ${[...legal].join(" ")}`, isError: true };
    const text = await askMove({
      fen,
      prompt: String(args.prompt ?? "What would you play here?"),
      title: String(args.title ?? "Your move"),
      accept,
      tolerance: clamp(Number(args.tolerance_cp ?? 30), 0, 200),
    });
    return { text };
  },

  async book_lookup(args: Args) {
    let sans: string[];
    if (Array.isArray(args.moves)) sans = args.moves.map(String);
    else {
      const { line, ply } = screen();
      if (line.startFen !== START_FEN) return { text: "The board isn't a line from the starting position, so the book doesn't apply." };
      sans = line.sans.slice(0, ply);
    }
    const built = buildLine(START_FEN, sans);
    if ("error" in built) return { text: built.error, isError: true };
    const name = openingName(sans);
    const next = continuations(sans);
    const moves = [...new Set(next.map((n) => n.move))];
    const out = [
      name ? `Opening: ${name.name} (${name.eco})${name.moves.length < sans.length ? ", now out of the named line" : ""}.` : "No named opening.",
      moves.length
        ? `Book continuations: ${moves.map((m) => `${m} (${next.filter((n) => n.move === m).map((n) => n.opening.name).join(" / ")})`).join("; ")}.`
        : "The book has nothing further from here.",
    ];
    const rep = (await getRepertoire()).filter((r) => r.moves.length > sans.length && r.moves.slice(0, sans.length).every((m, i) => m === sans[i]));
    if (rep.length) out.push(`Student's repertoire continues: ${rep.map((r) => `${r.moves[sans.length]} (${r.color}, ${r.name})`).join("; ")}.`);
    return { text: out.join("\n") };
  },

  async setup_position(args: Args) {
    const fen = String(args.fen ?? "").trim();
    try {
      new Chess(fen);
    } catch (e) {
      return { text: `Invalid FEN: ${(e as Error).message}`, isError: true };
    }
    const built = buildLine(fen, []);
    if ("error" in built) return { text: built.error, isError: true };
    const drawn = parseShapes(args, 0);
    if ("error" in drawn) return { text: drawn.error, isError: true };
    const title = String(args.title ?? "Position");
    const note = typeof args.note === "string" ? args.note : "";
    const open = args.open !== false;
    const { key } = addScenario(title, { ...built.line, notes: [] }, 0, drawn.shapes, open, sideArg(args));
    if (note) pushChat({ kind: "system", id: newId("c"), text: note });
    return {
      text: `Scenario ${key} "${title}"${open ? ", open on the student's board" : ""} (${sideToMove(fen)} to move).\n${linkHint(key)}`,
    };
  },

  async draw_arrows(args: Args) {
    const shapes: { orig: Key; dest?: Key; brush: string }[] = [];
    const bad: string[] = [];
    for (const a of Array.isArray(args.arrows) ? args.arrows : []) {
      const { from, to, color } = a as Record<string, string>;
      if (!SQUARE.test(from) || !SQUARE.test(to) || from === to) bad.push(`${from}-${to}`);
      else shapes.push({ orig: from as Key, dest: to as Key, brush: BRUSHES[color] ?? "green" });
    }
    for (const c of Array.isArray(args.circles) ? args.circles : []) {
      const { square, color } = c as Record<string, string>;
      if (!SQUARE.test(square)) bad.push(square);
      else shapes.push({ orig: square as Key, brush: BRUSHES[color] ?? "green" });
    }
    if (bad.length) return { text: `Not squares: ${bad.join(", ")}. Use e.g. "e4".`, isError: true };
    useStore.setState({ arrows: shapes.length ? { fen: screenFen(), shapes } : null });
    return { text: shapes.length ? `Drew ${shapes.length} on the board.` : "Cleared." };
  },

  async find_puzzles(args: Args) {
    if (!usePuzzleDb.getState().loaded) await refreshPuzzleDb();
    const pdb = usePuzzleDb.getState();
    if (!pdb.installed) return { text: "The puzzle set isn't downloaded yet. Tell the student to open Puzzles in the top bar and download it." };
    if (isLocked()) return { text: "A rated game is in progress; puzzles have to wait until it's over.", isError: true };
    const asked = Array.isArray(args.themes) ? args.themes.map(String).filter(Boolean) : [];
    const themes = asked.map((t) => themeKey(t)).filter((t): t is string => !!t);
    const unknown = asked.filter((t) => !themeKey(t));
    if (unknown.length && !themes.length) {
      const known = pdb.tags.filter((t) => t.kind === "theme").map((t) => t.tag);
      return { text: `Unknown theme${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Themes: ${known.join(", ")}`, isError: true };
    }
    let opening: string | null = null;
    if (typeof args.opening === "string" && args.opening.trim()) {
      opening = openingTag(args.opening);
      if (!opening) return { text: `No puzzles are tagged with an opening like "${args.opening}". Try the opening's family name.`, isError: true };
    }
    const center = pdb.rating;
    // The coach speaks chess.com ratings; the puzzle set is rated on Lichess's scale.
    const min = Number.isFinite(Number(args.rating_min)) && args.rating_min !== undefined ? toLichess(Number(args.rating_min)) : center - 150;
    const max = Number.isFinite(Number(args.rating_max)) && args.rating_max !== undefined ? toLichess(Number(args.rating_max)) : Math.max(min + 100, center + 150);
    const count = clamp(Number(args.count ?? 5), 1, 10);
    let found = await findPuzzles({ themes, opening, minRating: min, maxRating: max, limit: count });
    let widened = false;
    if (found.length < count && args.rating_min === undefined && args.rating_max === undefined) {
      const more = await findPuzzles({ themes, opening, minRating: center - 500, maxRating: center + 500, limit: count - found.length, exclude: found.map((p) => p.id) });
      widened = more.length > 0;
      found = [...found, ...more];
    }
    if (!found.length) return { text: "No unseen puzzles match that. Loosen the rating range, themes or opening." };
    const fallbackTitle = themes.length ? themes.map(themeLabel).join(", ") : opening ? openingLabel(opening) : "Puzzles";
    const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : fallbackTitle;
    startCoachSet(title, found);
    return {
      text:
        `Opened "${title}" in the puzzle trainer: ${found.length} puzzles (student's puzzle rating ${fromLichess(pdb.rating)}` +
        `${widened ? "; widened the rating range to find enough" : ""}${unknown.length ? `; ignored unknown themes ${unknown.join(", ")}` : ""}).\n` +
        found.map((p) => `  ${p.id} rated ${fromLichess(p.rating)}: ${p.themes.join(", ")}`).join("\n") +
        "\nThe app grades them; don't solve them for the student. When they finish, they can send you the results.",
    };
  },

  async get_profile() {
    return { text: await profileText() };
  },

  async query_games(args: Args) {
    const mode = ["rated", "practice", "all"].includes(String(args.mode)) ? String(args.mode) : "rated";
    const gameId = Number.isFinite(Number(args.game_id)) && args.game_id !== undefined ? Number(args.game_id) : null;
    return { text: await gamesText(mode, clamp(Number(args.limit ?? 5), 1, 20), gameId) };
  },

  async record_observation(args: Args) {
    const tag = String(args.tag ?? "").trim();
    const note = String(args.note ?? "").trim();
    if (!tag || !note) return { text: "tag and note are required.", isError: true };
    await invoke("db_record_observation", {
      gameId: useStore.getState().gameId,
      tag,
      note,
      fen: typeof args.fen === "string" && args.fen ? args.fen : null,
    });
    return { text: "Saved." };
  },
} satisfies typeof handlers);

/** A best or good move's result: any material it wins, and that the position holds. */
function soundVerdict(verdict: string, afterCp: number): string {
  // Only the generic "gets better / chances drop" verdict is wrong here; a sound sacrifice's
  // "You lose a knight" stays.
  if (!/position gets .*better: your winning chances drop/.test(verdict)) return verdict;
  const won = verdict.match(/^You do win (.+?), but/);
  const holds = `the position stays about where it was (${evalWords(afterCp)})`;
  return won ? `a sound move: you win ${won[1]}, and ${holds}.` : `a sound move: ${holds}.`;
}

/** Where a UCI line ends, at most `plies` moves in. */
function pvEnd(fen: string, pv: string[], plies: number): string {
  const chess = new Chess(fen);
  for (const uci of pv.slice(0, plies)) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
  }
  return chess.fen();
}

Object.assign(handlers, {
  async position_facts(args: Args) {
    const fen = typeof args.fen === "string" && args.fen ? args.fen : boardFen();
    try {
      new Chess(fen);
    } catch (e) {
      return { text: `Invalid FEN: ${(e as Error).message}`, isError: true };
    }
    return { text: [`Position ${fen}:`, ...positionFacts(fen).map((f) => `- ${f}`)].join("\n") };
  },

  /**
   * Candidate moves judged against the engine's best: the eval after each, how much it gives away,
   * the opponent's best answer played out to where the material settles, with a note per move.
   */
  async evaluate_moves(args: Args) {
    const fen = typeof args.fen === "string" && args.fen ? args.fen : boardFen();
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch (e) {
      return { text: `Invalid FEN: ${(e as Error).message}`, isError: true };
    }
    if (chess.isGameOver()) return { text: "That position is already over.", isError: true };
    const moves = (Array.isArray(args.moves) ? args.moves.map(String) : []).slice(0, 4);
    const legal = new Set(chess.moves());
    const bad = moves.filter((m) => !legal.has(m));
    if (!moves.length) return { text: "moves is empty.", isError: true };
    if (bad.length) return { text: `Not legal here: ${bad.join(", ")}. Legal: ${[...legal].join(" ")}`, isError: true };
    const depth = clamp(Number(args.depth ?? 14), 10, 20);
    const mover = sideToMove(fen);
    const top = await topMoves(fen, 3, depth);
    const best = top.lines[0];
    const before = best ? storedEval(best) : 0;
    const bestUci = best?.pv[0] ?? null;
    const out = [`Position ${fen}, ${mover} to move. Engine's top moves: ${top.text}.`];
    let shownBetter = false;
    for (const san of moves) {
      const m = new Chess(fen).move(san);
      const uci = m.from + m.to + (m.promotion ?? "");
      const after = new Chess(m.after);
      let afterCp: number;
      if (after.isCheckmate()) afterCp = mover === "white" ? 10000 : -10000;
      else if (after.isGameOver()) afterCp = 0;
      else {
        const [l] = await getEngine().analyze(m.after, 1, depth);
        afterCp = l ? storedEval(l) : before;
      }
      const loss = lossFromEvals(before, afterCp, mover);
      const cls = classify(loss, uci === bestUci);
      const ex = await explainCached({ fenBefore: fen, uci, bestUci, evalBefore: before, evalAfter: afterCp });
      const sound = cls === "best" || cls === "good";
      out.push(
        `\n${m.san}: ${evalWords(before)} → ${evalWords(afterCp)}, ${cls} (gives away ${loss.toFixed(1)} points of winning chances; winning chances ${ex.winBefore}% → ${ex.winAfter}% for ${mover}).`,
        `What happens (notes say "You" for ${mover}): ${ex.played.steps.map((s) => `${s.label} ${s.note}`).join(" ")}`,
        // The why-screen's verdict assumes a bad move ("the position gets better for them, your
        // chances drop"), which read as nonsense for a sound move that wins material: say what the
        // move does and that the position holds.
        `Result: ${sound ? soundVerdict(ex.played.verdict, afterCp) : ex.played.verdict}`,
      );
      if (ex.better && !shownBetter) {
        shownBetter = true;
        if (ex.alternatives.length > 1)
          out.push(
            `No single best move: several sound moves instead, each with the reply: ` +
              ex.alternatives.map((a) => `${a.steps.map((s) => `${s.label} ${s.note}`).join(" ")} (${a.verdict})`).join("; "),
          );
        else out.push(`Engine's move instead: ${ex.better.steps.map((s) => `${s.label} ${s.note}`).join(" ")} Result: ${ex.better.verdict}`);
      }
    }
    return { text: out.join("\n") };
  },
});

export async function handleTool(name: string, args: Args): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) return { text: `Unknown tool ${name}`, isError: true };
  try {
    return await handler(args);
  } catch (e) {
    return { text: `${name} failed: ${(e as Error).message}`, isError: true };
  }
}

/** One-line label for the chat's tool log. */
export function describeCall(name: string, args: Args): string {
  if (name === "show_line") return `show_line "${args.title ?? ""}"`;
  if (name === "analyze") return `analyze${args.depth ? ` depth ${args.depth}` : ""}`;
  if (name === "setup_position") return `setup_position "${args.title ?? ""}"`;
  if (name === "ask_move") return `ask_move "${args.title ?? ""}"`;
  if (name === "evaluate_moves") return `evaluate_moves ${Array.isArray(args.moves) ? args.moves.join(", ") : ""}`;
  if (name === "find_puzzles") return `find_puzzles${Array.isArray(args.themes) && args.themes.length ? ` ${args.themes.join(", ")}` : ""}`;
  return name;
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo;
}

/** "12. Nf3 (8s, 4:31 left)" for each move of a game with a clock. */
function moveTimes(): string[] {
  const { game, clocks, meta } = useStore.getState();
  if (!meta.timeControl) return [];
  const initial = meta.timeControl.initial * 1000;
  const inc = meta.timeControl.increment * 1000;
  return game.sans.map((san, i) => {
    const after = clocks[i];
    if (after === null || after === undefined) return san;
    const before = i >= 2 ? (clocks[i - 2] ?? initial) : initial;
    const spent = Math.max(0, before - (after - inc));
    const [, turn, , , , full] = game.fens[i].split(" ");
    return `${full}${turn === "w" ? "." : "..."} ${san} (${Math.round(spent / 1000)}s, ${formatClock(after)} left)`;
  });
}
