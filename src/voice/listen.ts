import { create } from "zustand";
import type { KaldiRecognizer, Model } from "vosk-browser";
import { useSettings } from "../settings";
import { vocabulary } from "./parse";

/**
 * Voice moves: the microphone, and Vosk recognizing on this device (offline, desktop and phone
 * alike; public/vosk, scripts/setup-vosk.mjs). The recognizer gets a grammar of chess words only,
 * which is what keeps it accurate with noise around: it can only answer with words a move is made of.
 * What it hears goes to the board on screen that takes moves (Board.tsx), or to the mic test in
 * Settings while that runs.
 */

export type VoiceStatus = "off" | "loading" | "listening" | "error";

interface VoiceState {
  status: VoiceStatus;
  error: string | null;
  /** What's being heard right now, before the recognizer settles on it. */
  partial: string;
  /** The last thing it settled on, shown under the mic button for a moment, and when. */
  last: string;
  lastAt: number;
  /** Microphone level, 0..1 (RMS of the last chunk). */
  level: number;
  /** Push-to-talk is held. */
  held: boolean;
}

export const useVoice = create<VoiceState>(() => ({ status: "off", error: null, partial: "", last: "", lastAt: 0, level: 0, held: false }));

/** Why voice can't work here, or null. Browsers only give a page the microphone over https or on localhost. */
export function voiceUnavailable(): string | null {
  if (!window.isSecureContext)
    return "Voice moves need the microphone, which phones only allow over https: open Chess Coach from your computer's Tailscale address.";
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") return "This browser doesn't give pages the microphone.";
  return null;
}

/** A word or phrase the recognizer settled on, with how sure it was of its least sure word (0..1). */
export interface Utterance {
  text: string;
  conf: number;
}

/** Boards taking spoken moves, latest mounted last; the last one on screen gets them (like typed moves). */
const hearers: { el: () => HTMLElement | null; hear: (u: Utterance) => void }[] = [];
export function addHearer(h: (typeof hearers)[number]): () => void {
  hearers.push(h);
  return () => void hearers.splice(hearers.indexOf(h), 1);
}
/** The mic test in Settings takes what's heard while it runs, instead of the boards. */
let capture: ((u: Utterance) => void) | null = null;

/** Hands what was said on (exported for testing without a microphone). */
export function deliver(u: Utterance) {
  useVoice.setState({ last: u.text, lastAt: Date.now(), partial: "" });
  if (capture) return capture(u);
  for (let i = hearers.length - 1; i >= 0; i--) {
    const el = hearers[i].el();
    if (!el?.isConnected || !el.getClientRects().length) continue;
    return hearers[i].hear(u);
  }
}

let model: Promise<Model> | null = null;
function loadModel(): Promise<Model> {
  // The worker runs from a blob, so the model's address has to be absolute.
  // vosk-browser is a UMD bundle: depending on how it was bundled its exports are on the module or on `default`.
  model ??= import("vosk-browser").then((v) => {
    const vosk = (v as unknown as { default?: typeof v }).default?.createModel ? (v as unknown as { default: typeof v }).default : v;
    return vosk.createModel(new URL("/vosk/model-en-us.tar.gz", location.href).href, -1);
  });
  model.catch(() => (model = null));
  return model;
}

interface Mic {
  stream: MediaStream;
  ctx: AudioContext;
  node: ScriptProcessorNode;
  recognizer: KaldiRecognizer;
  grammar: string;
}
let mic: Mic | null = null;
let starting: Promise<void> | null = null;
/** Who has the microphone open: the mic button, the mic test. It closes when nobody does. */
const users = new Set<string>();

const grammarNow = () => {
  const s = useSettings.getState();
  return JSON.stringify([...vocabulary({ confirm: s.voiceConfirmWords, cancel: s.voiceCancelWords }), "[unk]"]);
};

function newRecognizer(m: Model, sampleRate: number, grammar: string): KaldiRecognizer {
  const r = new m.KaldiRecognizer(sampleRate, grammar);
  r.setWords(true);
  r.on("partialresult", (msg) => {
    if (msg.event !== "partialresult") return;
    const partial = msg.result.partial.replace(/\[unk\]/g, "").trim();
    if (partial !== useVoice.getState().partial) useVoice.setState({ partial });
  });
  r.on("result", (msg) => {
    if (msg.event !== "result") return;
    const words = (msg.result.result ?? []).filter((w) => w.word !== "[unk]");
    const text = words.map((w) => w.word).join(" ");
    if (!text) return useVoice.setState({ partial: "" });
    deliver({ text, conf: Math.min(...words.map((w) => w.conf)) });
  });
  return r;
}

async function open(): Promise<void> {
  const why = voiceUnavailable();
  if (why) throw new Error(why);
  useVoice.setState({ status: "loading", error: null });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  try {
    const m = await loadModel();
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor is old but works everywhere this runs, and Vosk takes the buffers it hands out.
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const grammar = grammarNow();
    const recognizer = newRecognizer(m, ctx.sampleRate, grammar);
    mic = { stream, ctx, node, recognizer, grammar };
    const silence = new Float32Array(4096);
    node.onaudioprocess = (e) => {
      if (!mic) return;
      const data = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const level = Math.sqrt(sum / data.length);
      useVoice.setState({ level });
      const s = useSettings.getState();
      // Push-to-talk: only what's said while held. The gate: room noise reads as silence, so the
      // recognizer ends an utterance when the student stops instead of hearing the room as words.
      const off = !capture && ((s.voicePushToTalk && !useVoice.getState().held) || level < s.voiceGate);
      mic.recognizer.acceptWaveformFloat(off ? silence.subarray(0, data.length) : data, ctx.sampleRate);
    };
    source.connect(node);
    node.connect(ctx.destination);
    useVoice.setState({ status: "listening" });
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
}

function close() {
  if (!mic) return;
  mic.node.disconnect();
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close().catch(() => {});
  mic.recognizer.remove();
  mic = null;
  useVoice.setState({ status: "off", partial: "", level: 0, held: false });
}

/** Opens the microphone for `who` (it stays open while anyone holds it). */
export async function startListening(who: string): Promise<void> {
  users.add(who);
  if (mic) return;
  starting ??= open().finally(() => (starting = null));
  try {
    await starting;
  } catch (e) {
    users.delete(who);
    const msg =
      e instanceof DOMException && e.name === "NotAllowedError"
        ? "Chess Coach wasn't allowed the microphone. Allow it for this app and try again."
        : e instanceof Error
          ? e.message
          : String(e);
    useVoice.setState({ status: "error", error: msg, lastAt: Date.now() });
    throw e;
  }
  if (!users.size) close();
}

export function stopListening(who: string) {
  users.delete(who);
  if (!users.size) close();
}

export const voiceOn = () => users.has("button");

/** The mic button: voice moves on or off. */
export function toggleVoice() {
  if (users.has("button")) stopListening("button");
  else startListening("button").catch(() => {});
}

/** Push-to-talk released: what was said is finished, so it's read now rather than after a pause. */
export function setHeld(held: boolean) {
  if (useVoice.getState().held === held) return;
  useVoice.setState({ held });
  if (!held) mic?.recognizer.retrieveFinalResult();
}

// New confirm or cancel words are new grammar: the recognizer is made again with them.
useSettings.subscribe((s, prev) => {
  if (!mic || (s.voiceConfirmWords === prev.voiceConfirmWords && s.voiceCancelWords === prev.voiceCancelWords)) return;
  const grammar = grammarNow();
  if (grammar === mic.grammar) return;
  loadModel().then((m) => {
    if (!mic) return;
    mic.recognizer.remove();
    mic.recognizer = newRecognizer(m, mic.ctx.sampleRate, grammar);
    mic.grammar = grammar;
  });
});

/**
 * The mic test: the next thing the student says (null after `ms` with nothing), with the
 * microphone open for it and the boards left out.
 */
export async function listenOnce(ms = 6000): Promise<Utterance | null> {
  await startListening("check");
  // Only one listener at a time: an earlier one still waiting ends with nothing rather than
  // taking this one's words.
  superseded?.();
  return new Promise((resolve) => {
    const done = (u: Utterance | null) => {
      clearTimeout(timer);
      if (capture === done) capture = null;
      if (superseded === end) superseded = null;
      resolve(u);
    };
    const end = () => done(null);
    const timer = setTimeout(end, ms);
    capture = done;
    superseded = end;
  });
}
let superseded: (() => void) | null = null;

/** The mic test: the room's level over `ms`, as the loudness most of it stays under. */
export async function measureRoom(ms = 2500): Promise<number> {
  await startListening("check");
  const levels: number[] = [];
  const unsub = useVoice.subscribe((s) => levels.push(s.level));
  // What's said meanwhile isn't for the boards.
  capture = () => {};
  await new Promise((r) => setTimeout(r, ms));
  unsub();
  capture = null;
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length * 0.9)] ?? 0;
}

export function endCheck() {
  capture = null;
  stopListening("check");
}
