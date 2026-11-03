// Board sounds, synthesized with Web Audio (no audio files to ship).
import { useSettings } from "./settings";
import { screen, useStore } from "./store";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useSettings.getState().sounds) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** A short filtered noise burst: sounds like a piece set down on wood. */
function knock(ac: AudioContext, at: number, freq: number, gain: number, length = 0.06) {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * length), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.6;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.001, at + length);
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(at);

  // A little low body under the click.
  const body = ac.createOscillator();
  body.frequency.setValueAtTime(freq / 7, at);
  const bodyAmp = ac.createGain();
  bodyAmp.gain.setValueAtTime(gain * 0.5, at);
  bodyAmp.gain.exponentialRampToValueAtTime(0.001, at + length);
  body.connect(bodyAmp).connect(ac.destination);
  body.start(at);
  body.stop(at + length);
}

function tone(ac: AudioContext, at: number, freq: number, length: number, gain = 0.12) {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(amp).connect(ac.destination);
  osc.start(at);
  osc.stop(at + length);
}

export function playMoveSound(san: string) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  if (san.startsWith("O-O")) {
    knock(ac, t, 1400, 0.5);
    knock(ac, t + 0.08, 1300, 0.45);
  } else if (san.includes("x")) {
    knock(ac, t, 800, 0.8, 0.09);
    knock(ac, t + 0.03, 1600, 0.35);
  } else {
    knock(ac, t, 1400, 0.55);
  }
  if (san.includes("+") || san.includes("#")) tone(ac, t + 0.05, 880, 0.15, 0.08);
}

export function playGameEndSound() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.25;
  [523.25, 659.25, 783.99].forEach((f, i) => tone(ac, t + i * 0.11, f, 0.5));
}

/** Plays a sound whenever the board on screen advances by exactly one move (played or stepped). */
export function initSounds() {
  let prevFen = screen().line.fens[screen().ply];
  useStore.subscribe((s, prev) => {
    const { line, ply } = screen();
    const fen = line.fens[ply];
    if (fen === prevFen) return;
    if (ply > 0 && line.fens[ply - 1] === prevFen && s.gameId === prev.gameId) playMoveSound(line.sans[ply - 1]);
    prevFen = fen;
    if (s.meta.result && !prev.meta.result && s.gameId === prev.gameId) playGameEndSound();
  });
}
