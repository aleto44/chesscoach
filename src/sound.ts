// Board sounds, played from the audio files the student puts in the sounds folder.
import { invoke } from "./backend";
import { hasBackend } from "./db";
import { useSettings } from "./settings";
import { screen, useStore, type Color } from "./store";
import { sideToMove, type Line } from "./chess/line";
import { usePuzzle } from "./puzzles/session";
import { viewedPly } from "./chess/view";
import { useDrill } from "./analysis/drillSession";
import { endgameOf, useEndgame } from "./endgames/session";
import { openingSetOf, useOpening } from "./openings/session";
import { useGuess } from "./guess/session";

/**
 * Each event plays `<name>.mp3` (or .wav/.ogg/...) from the sounds folder. Any file that's missing
 * falls back along FALLBACK, so a folder with just move.mp3 still works.
 */
export const SOUND_NAMES = [
  "move",
  "move-self",
  "move-opponent",
  "capture",
  "castle",
  "check",
  "checkmate",
  "promotion",
  "premove",
  "game-start",
  "game-end",
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

const RATE = 48000;
let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();

/** Sounds without their own file borrow another (followed until one loads); premove, game-start and game-end stay silent. */
const FALLBACK: Partial<Record<SoundName, SoundName>> = {
  "move-self": "move",
  "move-opponent": "move",
  capture: "move",
  castle: "move",
  check: "move",
  checkmate: "check",
  promotion: "move",
};

/** Why a sound file didn't load, shown in Settings (on a phone there's no console to look at). */
const failures = new Map<SoundName, string>();

/**
 * Loads the student's sound files; there are no built-in sounds. Decoded with the playing context
 * rather than an OfflineAudioContext, which Brave's fingerprinting protection interferes with.
 * Creating it outside a touch is fine: it just starts suspended until unlockOnTouch resumes it.
 */
export async function loadSounds() {
  buffers.clear();
  failures.clear();
  if (!hasBackend()) return;
  ctx ??= new AudioContext();
  for (const name of SOUND_NAMES) {
    try {
      const bytes = await invoke<ArrayBuffer>("custom_sound", { name });
      if (bytes.byteLength === 0) continue;
      buffers.set(name, await ctx.decodeAudioData(bytes));
    } catch (e) {
      failures.set(name, e instanceof Error ? e.message || e.name : String(e));
      console.warn(`sound ${name} not loaded`, e);
    }
  }
}

/** The sounds that have their own file. */
export const customSounds = () => SOUND_NAMES.filter((n) => buffers.has(n));
export const soundFailures = () => [...failures].map(([name, why]) => `${name} (${why})`);
function bufferFor(name: SoundName): AudioBuffer | undefined {
  for (let n: SoundName | undefined = name; n; n = FALLBACK[n]) {
    const buf = buffers.get(n);
    if (buf) return buf;
  }
}

/**
 * Phone browsers keep a page's audio off until it is started during a touch, and a sound first
 * played on the opponent's (timer-driven) move would leave it off for good. So every touch makes
 * sure it's running, including the first one after the phone wakes up.
 */
function unlockOnTouch() {
  const unlock = () => {
    ctx ??= new AudioContext();
    if (ctx.state === "running") return;
    ctx.resume().catch(() => {});
    // A silent sound started inside the gesture is what some phones need to count it.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, RATE);
    src.connect(ctx.destination);
    src.start();
  };
  for (const ev of ["pointerdown", "touchend", "keydown"]) window.addEventListener(ev, unlock, { capture: true, passive: true });
}

export function play(name: SoundName) {
  if (!useSettings.getState().sounds) return;
  const buf = bufferFor(name);
  if (!buf) return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

/** `self`: the move was the student's (plain moves sound different for each side). */
export function soundForMove(san: string, self: boolean): SoundName {
  if (san.includes("#")) return "checkmate";
  if (san.includes("+")) return "check";
  if (san.includes("=")) return "promotion";
  if (san.startsWith("O-O")) return "castle";
  if (san.includes("x")) return "capture";
  return self ? "move-self" : "move-opponent";
}

/** The board on screen: a puzzle or drill replaces the game while it runs. */
function onScreen(): { line: Line; ply: number; key: unknown; student: Color | "both" } {
  const puzzle = usePuzzle.getState();
  if (puzzle?.line) return { line: puzzle.line, ply: viewedPly(puzzle.line.sans.length, puzzle.view), key: puzzle.queue[puzzle.index], student: puzzle.color };
  const drill = useDrill.getState();
  if (drill?.line) {
    const card = drill.queue[drill.index];
    return { line: drill.line, ply: viewedPly(drill.line.sans.length, drill.view), key: card, student: card?.color ?? "both" };
  }
  const endgame = useEndgame.getState();
  if (endgame)
    return { line: endgame.line, ply: viewedPly(endgame.line.sans.length, endgame.view), key: endgame.line.startFen + endgame.id, student: endgameOf(endgame).side };
  const opening = useOpening.getState();
  if (opening)
    return {
      line: opening.line,
      ply: viewedPly(opening.line.sans.length, opening.view),
      key: opening.setId + opening.line.startFen,
      student: openingSetOf(opening).color,
    };
  const guess = useGuess.getState();
  if (guess) return { line: guess.line, ply: viewedPly(guess.line.sans.length, guess.view), key: guess.game, student: guess.side };
  const { line, ply } = screen();
  const s = useStore.getState();
  return { line, ply, key: s.gameId, student: s.meta.studentColor };
}

/** Plays a sound whenever the board on screen advances by exactly one move (played or stepped). */
export function initSounds() {
  unlockOnTouch();
  loadSounds().catch((e) => console.warn("sounds not loaded", e));
  let prev = onScreen();
  let prevFen = prev.line.fens[prev.ply];
  const check = () => {
    const now = onScreen();
    const fen = now.line.fens[now.ply];
    if (fen === prevFen && now.key === prev.key) return;
    // Same game / puzzle / drill and one move further: a move sound. Anything else is a new board.
    if (now.key === prev.key && now.ply > 0 && now.line.fens[now.ply - 1] === prevFen) {
      const mover = sideToMove(now.line.fens[now.ply - 1]);
      play(soundForMove(now.line.sans[now.ply - 1], now.student === "both" || now.student === mover));
    }
    prev = now;
    prevFen = fen;
  };
  useStore.subscribe((s, before) => {
    check();
    // A mate already played the checkmate sound on its move; game-end is for every other ending.
    const mated = s.game.sans[s.game.sans.length - 1]?.includes("#") && buffers.has("checkmate");
    if (s.meta.result && !before.meta.result && s.gameId === before.gameId && !mated) window.setTimeout(() => play("game-end"), 250);
  });
  usePuzzle.subscribe(check);
  useDrill.subscribe(check);
  useEndgame.subscribe(check);
  useOpening.subscribe(check);
  useGuess.subscribe(check);
}
