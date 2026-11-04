// Board sounds, played from the audio files the student puts in the sounds folder.
import { invoke } from "@tauri-apps/api/core";
import { hasBackend } from "./db";
import { useSettings } from "./settings";
import { screen, useStore } from "./store";

export const SOUND_NAMES = ["move", "capture", "castle", "check", "promotion", "game-end"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

const RATE = 48000;
let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();

/** Sounds without their own file borrow the plain move sound; game-end stays silent. */
const FALLBACK: Partial<Record<SoundName, SoundName>> = { capture: "move", castle: "move", check: "move", promotion: "move" };

/** Loads the student's sound files; there are no built-in sounds. */
export async function loadSounds() {
  buffers.clear();
  if (!hasBackend()) return;
  const decoder = new OfflineAudioContext(1, 1, RATE);
  for (const name of SOUND_NAMES) {
    try {
      const bytes = await invoke<ArrayBuffer>("custom_sound", { name });
      if (bytes.byteLength === 0) continue;
      buffers.set(name, await decoder.decodeAudioData(bytes));
    } catch (e) {
      console.warn(`sound ${name} not loaded`, e);
    }
  }
}

/** The sounds that have their own file. */
export const customSounds = () => SOUND_NAMES.filter((n) => buffers.has(n));
const bufferFor = (name: SoundName) => buffers.get(name) ?? (FALLBACK[name] && buffers.get(FALLBACK[name]));

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

/** Plays a sound whenever the board on screen advances by exactly one move (played or stepped). */
export function initSounds() {
  loadSounds().catch((e) => console.warn("sounds not loaded", e));
  let prevFen = screen().line.fens[screen().ply];
  useStore.subscribe((s, prev) => {
    const { line, ply } = screen();
    const fen = line.fens[ply];
    if (fen === prevFen) return;
    if (ply > 0 && line.fens[ply - 1] === prevFen && s.gameId === prev.gameId) play(soundForMove(line.sans[ply - 1]));
    prevFen = fen;
    if (s.meta.result && !prev.meta.result && s.gameId === prev.gameId) window.setTimeout(() => play("game-end"), 250);
  });
}
