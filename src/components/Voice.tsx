import { useEffect, useRef, useState } from "react";
import "../voice.css";
import { useSettings } from "../settings";
import { setHeld, toggleVoice, useVoice, voiceOn, voiceUnavailable } from "../voice/listen";
import { ratedConfirms, ratedOnScreen, toggleRatedConfirm } from "../voice/confirm";
import { touchNote } from "../touchLog";

/** A press on the mic button shorter than this is a tap (on/off); longer, with push-to-talk, it was talking. */
const TAP_MS = 250;
/** A touch held this long on the mic in a rated game or puzzle flips confirmations (the phone's right-click). */
const LONG_PRESS_MS = 550;

/**
 * The top bar's mic: voice moves on or off. With push-to-talk, Space (desktop) or holding this
 * button (phones) is when it listens. What it hears shows under it for a moment.
 */
export function VoiceButton() {
  const status = useVoice((v) => v.status);
  const error = useVoice((v) => v.error);
  const level = useVoice((v) => v.level);
  const held = useVoice((v) => v.held);
  const pushToTalk = useSettings((s) => s.voicePushToTalk);
  const unavailable = voiceUnavailable();
  const on = status === "listening" || status === "loading";
  const pressedAt = useRef(0);
  useSettings((s) => s.voiceConfirm); // re-render the title when confirmations flip
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flipped = useRef(false);
  const pointer = useRef("mouse");
  const [note, setNote] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);
  const flipConfirm = () => {
    const on = toggleRatedConfirm();
    setNote({ text: on ? "Rated games and puzzles: confirm moves on" : "Rated games and puzzles: confirm moves off", at: Date.now() });
    navigator.vibrate?.(30);
  };

  // Space held = talking, when push-to-talk is on and nothing else wants the key.
  useEffect(() => {
    if (!pushToTalk || status !== "listening") return;
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest?.("textarea, input, select, button, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e)) return;
      e.preventDefault();
      setHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => setHeld(false));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [pushToTalk, status]);

  const rated = ratedOnScreen();
  const confirmHint = rated
    ? ` ${pushToTalk ? "Right-click" : "Right-click or long-press"} to turn confirmations ${ratedConfirms() ? "off" : "on"}.`
    : "";
  const title = (unavailable
    ? unavailable
    : status === "error"
      ? `Voice moves: ${error}`
      : status === "loading"
        ? "Starting voice moves…"
        : on
          ? pushToTalk
            ? "Voice moves on: hold Space (or hold this button) and say a move. Tap to turn off."
            : 'Voice moves on: say a move ("knight f3", "castles"). Click to turn off.'
          : 'Voice moves: say your moves ("e4", "knight takes d5", "castles king side")') + confirmHint;

  // Push-to-talk on a phone: holding the button talks, a quick tap turns voice on or off.
  const press = (e: React.PointerEvent) => {
    pressedAt.current = performance.now();
    pointer.current = e.pointerType;
    flipped.current = false;
    touchNote(`MIC down ${e.pointerType} btn=${e.button} rated=${ratedOnScreen()} ptt=${pushToTalk} ${status}`);
    if (e.button !== 0) return; // the right button is the confirm toggle, not talking
    if (pushToTalk && status === "listening") return setHeld(true);
    // A held touch in a rated game flips confirmations (with push-to-talk on, holding talks instead).
    if (e.pointerType !== "mouse" && ratedOnScreen()) {
      longPress.current = setTimeout(() => {
        touchNote("MIC long-press: flip confirmations");
        flipped.current = true;
        flipConfirm();
      }, LONG_PRESS_MS);
    }
  };
  const release = (e: React.PointerEvent) => {
    touchNote(`MIC ${e.type} after ${Math.round(performance.now() - pressedAt.current)}ms`);
    clearTimeout(longPress.current);
    if (!pushToTalk || status !== "listening") return;
    setHeld(false);
  };
  const click = () => {
    if (flipped.current) return void (flipped.current = false);
    // Phones have no hover, so a disabled button couldn't say why: the tap shows it.
    if (unavailable) return useVoice.setState({ status: "error", error: unavailable, lastAt: Date.now() });
    const quick = performance.now() - pressedAt.current < TAP_MS;
    if (pushToTalk && voiceOn() && !quick) return;
    toggleVoice();
  };

  // Loudness as a ring around the mic while it listens.
  const ring = on && (!pushToTalk || held) ? Math.min(1, level * 12) : 0;
  return (
    <span className="voice-wrap">
      <button
        className={`icon voice-button ${on ? "on" : ""} ${status} ${held ? "held" : ""}`}
        onClick={click}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onContextMenu={(e) => {
          e.preventDefault();
          // Touch long-presses are timed in `press`; this is the mouse's right-click.
          if (pointer.current === "mouse" && ratedOnScreen()) flipConfirm();
        }}
        title={title}
        aria-label="Voice moves"
        aria-pressed={on}
        style={{ ["--voice-level" as string]: ring }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          {status === "error" && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
      </button>
      {note ? <span className="voice-heard" role="status">{note.text}</span> : <Heard />}
    </span>
  );
}

/** What the recognizer is hearing, then what it settled on, under the mic. */
function Heard() {
  const partial = useVoice((v) => v.partial);
  const last = useVoice((v) => v.last);
  const lastAt = useVoice((v) => v.lastAt);
  const status = useVoice((v) => v.status);
  const error = useVoice((v) => v.error);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!lastAt) return;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), status === "error" ? 5000 : 2500);
    return () => clearTimeout(t);
  }, [lastAt]);
  const text = status === "error" ? (fresh ? error : "") : partial || (fresh ? last : "");
  if (!text || (status === "off" && !partial)) return null;
  return (
    <span className={`voice-heard ${partial ? "partial" : ""} ${status === "error" ? "error" : ""}`} role="status">
      {status === "error" ? text : `“${text}”`}
    </span>
  );
}
