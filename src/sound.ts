// Board sounds. The built-in set is rendered once with Web Audio (modal synthesis of a wooden
// piece on a board); files in the custom sounds folder replace individual sounds.
import { invoke } from "@tauri-apps/api/core";
import { hasBackend } from "./db";
import { useSettings } from "./settings";
import { screen, useStore } from "./store";

export const SOUND_NAMES = ["move", "capture", "castle", "check", "game-end"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

const RATE = 48000;
let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const custom = new Set<SoundName>();

/** [frequency ratio, amplitude, ring time in seconds] for a small hardwood block. */
const WOOD_MODES: [number, number, number][] = [
  [1, 1, 0.05],
  [2.41, 0.5, 0.03],
  [4.36, 0.28, 0.018],
  [6.9, 0.12, 0.01],
];

/** One piece landing: a very short click exciting a few resonant modes. */
function strike(ac: BaseAudioContext, at: number, pitch: number, gain: number, out: AudioNode) {
  const click = ac.createBuffer(1, Math.ceil(ac.sampleRate * 0.003), ac.sampleRate);
  const data = click.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);

  for (const [ratio, amp, ring] of WOOD_MODES) {
    const src = ac.createBufferSource();
    src.buffer = click;
    const f = pitch * ratio;
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = f;
    // A bandpass rings for about Q / (pi * f) seconds.
    filter.Q.value = Math.PI * f * ring;
    const g = ac.createGain();
    // Narrow filters pass little energy; scale up so each mode lands near its amplitude.
    g.gain.value = gain * amp * Math.sqrt(filter.Q.value) * 2;
    src.connect(filter).connect(g).connect(out);
    src.start(at);
  }

  // The bright contact transient on top.
  const tick = ac.createBufferSource();
  tick.buffer = click;
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 3500;
  const tg = ac.createGain();
  tg.gain.value = gain * 0.25;
  tick.connect(hp).connect(tg).connect(out);
  tick.start(at);
}

function chime(ac: BaseAudioContext, at: number, freq: number, length: number, gain: number, out: AudioNode) {
  for (const [mult, amp] of [[1, 1], [2, 0.3], [3, 0.12]]) {
    const osc = ac.createOscillator();
    osc.frequency.value = freq * mult;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain * amp, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + length);
  }
}

const RECIPES: Record<SoundName, { length: number; peak: number; draw: (ac: BaseAudioContext, out: AudioNode) => void }> = {
  move: { length: 0.15, peak: 0.55, draw: (ac, out) => strike(ac, 0, 540, 1, out) },
  capture: {
    length: 0.2,
    peak: 0.75,
    draw: (ac, out) => {
      strike(ac, 0, 760, 0.7, out);
      strike(ac, 0.014, 420, 1, out);
    },
  },
  castle: {
    length: 0.25,
    peak: 0.55,
    draw: (ac, out) => {
      strike(ac, 0, 540, 1, out);
      strike(ac, 0.085, 500, 0.9, out);
    },
  },
  check: {
    length: 0.3,
    peak: 0.6,
    draw: (ac, out) => {
      strike(ac, 0, 540, 1, out);
      chime(ac, 0.02, 1318.5, 0.25, 0.18, out);
    },
  },
  "game-end": {
    length: 0.9,
    peak: 0.4,
    draw: (ac, out) => {
      chime(ac, 0, 523.25, 0.6, 0.3, out);
      chime(ac, 0.14, 783.99, 0.75, 0.3, out);
    },
  },
};

async function render(name: SoundName): Promise<AudioBuffer> {
  const { length, peak, draw } = RECIPES[name];
  const off = new OfflineAudioContext(1, Math.ceil(RATE * length), RATE);
  draw(off, off.destination);
  const buf = await off.startRendering();
  const data = buf.getChannelData(0);
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / max;
  return buf;
}

/** Renders the built-in set and loads any custom files over it. */
export async function loadSounds() {
  for (const name of SOUND_NAMES) buffers.set(name, await render(name));
  custom.clear();
  if (!hasBackend()) return;
  const decoder = new OfflineAudioContext(1, 1, RATE);
  for (const name of SOUND_NAMES) {
    try {
      const bytes = await invoke<ArrayBuffer>("custom_sound", { name });
      if (bytes.byteLength === 0) continue;
      buffers.set(name, await decoder.decodeAudioData(bytes));
      custom.add(name);
    } catch (e) {
      console.warn(`custom sound ${name} not loaded`, e);
    }
  }
}

export const customSounds = () => [...custom];
export const soundBuffer = (name: SoundName) => buffers.get(name);

export function play(name: SoundName) {
  if (!useSettings.getState().sounds) return;
  const buf = buffers.get(name);
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
