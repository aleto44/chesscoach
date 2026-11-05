// Board sounds, played from the audio files the student puts in the sounds folder.
import { invoke } from "./backend";
import { hasBackend } from "./db";
import { useSettings } from "./settings";
import { screen, useStore } from "./store";
import type { Line } from "./chess/line";
import { usePuzzle } from "./puzzles/session";
import { useDrill } from "./analysis/drillSession";

export const SOUND_NAMES = ["move", "capture", "castle", "check", "promotion", "game-end"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

const RATE = 48000;
let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();

/** Sounds without their own file borrow the plain move sound; game-end stays silent. */
const FALLBACK: Partial<Record<SoundName, SoundName>> = { capture: "move", castle: "move", check: "move", promotion: "move" };

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
const bufferFor = (name: SoundName) => buffers.get(name) ?? (FALLBACK[name] && buffers.get(FALLBACK[name]));

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

export function soundForMove(san: string): SoundName {
  if (san.includes("+") || san.includes("#")) return "check";
  if (san.includes("=")) return "promotion";
  if (san.startsWith("O-O")) return "castle";
  if (san.includes("x")) return "capture";
  return "move";
}

/** The board on screen: a puzzle or drill replaces the game while it runs. */
function onScreen(): { line: Line; ply: number; key: unknown } {
  const puzzle = usePuzzle.getState();
  if (puzzle?.line) return { line: puzzle.line, ply: puzzle.view ?? puzzle.line.sans.length, key: puzzle.queue[puzzle.index] };
  const drill = useDrill.getState();
  if (drill?.line) return { line: drill.line, ply: drill.line.sans.length, key: drill.queue[drill.index] };
  const { line, ply } = screen();
  return { line, ply, key: useStore.getState().gameId };
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
    if (now.key === prev.key && now.ply > 0 && now.line.fens[now.ply - 1] === prevFen) play(soundForMove(now.line.sans[now.ply - 1]));
    prev = now;
    prevFen = fen;
  };
  useStore.subscribe((s, before) => {
    check();
    if (s.meta.result && !before.meta.result && s.gameId === before.gameId) window.setTimeout(() => play("game-end"), 250);
  });
  usePuzzle.subscribe(check);
  useDrill.subscribe(check);
}
