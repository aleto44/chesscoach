import { useEffect, useRef, useState } from "react";
import "../voice.css";
import { useSettings } from "../settings";
import { setHeld, toggleVoice, useVoice, voiceOn, voiceUnavailable } from "../voice/listen";

/** A press on the mic button shorter than this is a tap (on/off); longer, with push-to-talk, it was talking. */
const TAP_MS = 250;

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

  const title = unavailable
    ? unavailable
    : status === "error"
      ? `Voice moves: ${error}`
      : status === "loading"
        ? "Starting voice moves…"
        : on
          ? pushToTalk
            ? "Voice moves on: hold Space (or hold this button) and say a move. Tap to turn off."
            : 'Voice moves on: say a move ("knight f3", "castles"). Click to turn off.'
          : 'Voice moves: say your moves ("e4", "knight takes d5", "castles king side")';

  // Push-to-talk on a phone: holding the button talks, a quick tap turns voice on or off.
  const press = () => {
    pressedAt.current = performance.now();
    if (pushToTalk && status === "listening") setHeld(true);
  };
  const release = () => {
    if (!pushToTalk || status !== "listening") return;
    setHeld(false);
  };
  const click = () => {
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
        onContextMenu={(e) => e.preventDefault()}
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
      <Heard />
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
