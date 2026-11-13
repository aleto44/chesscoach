import { useEffect, useState } from "react";
import "../voice.css";
import { saveSetting, useSettings } from "../settings";
import { endCheck, listenOnce, measureRoom, useVoice, voiceUnavailable } from "../voice/listen";
import { hearMove, sayMove } from "../voice/parse";

/** The noise filter sits this far above the room's level: quieter than that is the room, not the student. */
const GATE_OVER_ROOM = 1.6;

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const words = (s: string) =>
  s
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

/** Settings → Voice moves: when a heard move waits for a yes, the words for yes and no, push-to-talk, and the mic test. */
export function VoiceSettings() {
  const { voiceConfirm, voiceConfirmWords, voiceCancelWords, voicePushToTalk, voiceGate } = useSettings();
  const [yes, setYes] = useState(voiceConfirmWords.join(", "));
  const [no, setNo] = useState(voiceCancelWords.join(", "));
  const [testing, setTesting] = useState(false);
  const unavailable = voiceUnavailable();

  const saveWords = () => {
    const y = words(yes);
    const n = words(no);
    if (y.length && y.join() !== voiceConfirmWords.join()) saveSetting("voiceConfirmWords", y);
    if (n.length && n.join() !== voiceCancelWords.join()) saveSetting("voiceCancelWords", n);
  };

  return (
    <div className="field">
      <span>Voice moves</span>
      <span className="muted small">
        Turn it on with the mic in the top bar, then say moves the way you would to a friend: "e4", "knight takes d5",
        "b knight to d2", "castles queen side", "e8 promote to queen". It listens on this device, offline.
      </span>
      {unavailable && <span className="error small">{unavailable}</span>}
      <label className="field">
        <span className="muted small">Ask me to confirm a move</span>
        <select value={voiceConfirm} onChange={(e) => saveSetting("voiceConfirm", e.target.value as typeof voiceConfirm)}>
          <option value="rated">In rated games, and when it isn't sure</option>
          <option value="unsure">Only when it isn't sure</option>
          <option value="always">Every move</option>
        </select>
      </label>
      <div className="voice-words">
        <label className="field">
          <span className="muted small">Confirm with</span>
          <input className="text-input" value={yes} onChange={(e) => setYes(e.target.value)} onBlur={saveWords} placeholder="yes, confirm" />
        </label>
        <label className="field">
          <span className="muted small">Cancel with</span>
          <input className="text-input" value={no} onChange={(e) => setNo(e.target.value)} onBlur={saveWords} placeholder="no, cancel" />
        </label>
      </div>
      <span className="muted small">
        Separate several with commas. Pick words that sound nothing like a move ("go" is close to "g"). Tapping the move
        on the board or pressing Enter confirms too.
      </span>
      <label className="toggle">
        <input type="checkbox" checked={voicePushToTalk} onChange={(e) => saveSetting("voicePushToTalk", e.target.checked)} />
        <span>Push to talk: listen only while I hold Space or the mic button (best with noise around)</span>
      </label>
      {testing ? (
        <MicTest onDone={() => setTesting(false)} />
      ) : (
        <div className="voice-actions">
          <button onClick={() => setTesting(true)} disabled={!!unavailable}>
            Test my mic…
          </button>
          {voiceGate > 0 && <button onClick={() => saveSetting("voiceGate", 0)}>Turn off the noise filter</button>}
        </div>
      )}
      {!testing && (
        <span className="muted small">
          {voiceGate > 0
            ? "Room noise is filtered out (set by the mic test). "
            : "The mic test listens to your room for a moment to filter its noise out, then shows what it hears you say."}
        </span>
      )}
    </div>
  );
}

/**
 * The mic test: the room's noise first, which sets the noise filter (`voiceGate`), then whatever the
 * student says, shown as heard and as it reads (a move from the starting position, yes, no).
 */
function MicTest({ onDone }: { onDone: () => void }) {
  const confirm = useSettings((s) => s.voiceConfirmWords);
  const cancel = useSettings((s) => s.voiceCancelWords);
  const [phase, setPhase] = useState<"room" | "talk">("room");
  const [gate, setGate] = useState(0);
  const [heard, setHeard] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const level = useVoice((v) => v.level);
  const partial = useVoice((v) => v.partial);

  useEffect(() => {
    // Each run has its own flag: React runs this twice in development, and only one may listen.
    let stopped = false;
    (async () => {
      try {
        const room = await measureRoom();
        if (stopped) return;
        const g = room * GATE_OVER_ROOM;
        setGate(g);
        await saveSetting("voiceGate", g);
        setPhase("talk");
        while (!stopped) {
          const u = await listenOnce(60_000);
          if (stopped) return;
          if (u) setHeard((h) => [u.text, ...h].slice(0, 8));
        }
      } catch (e) {
        // listen.ts words the error for the student (e.g. a refused microphone).
        if (!stopped) setError(useVoice.getState().error ?? (e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => {
      stopped = true;
      endCheck();
    };
  }, []);

  /** How a phrase reads: a move from the starting position, a yes or no, or just words. */
  const reads = (text: string) => {
    const h = hearMove(START, text, { confirm, cancel });
    if (h.kind === "confirm") return "confirms a move";
    if (h.kind === "cancel") return "cancels a move";
    if (h.kind === "move") return h.moves.length === 1 ? sayMove(START, h.moves[0]) : `${h.moves.length} possible moves`;
    return null;
  };

  return (
    <div className="voice-check">
      {error ? (
        <span className="error small">{error}</span>
      ) : (
        <>
          <span className="muted small">
            {phase === "room"
              ? "Stay quiet for a moment: listening to the room…"
              : 'Now talk: say a few moves ("knight f3", "e4", "castles"), or your yes and no words.'}
          </span>
          <div className="voice-meter" aria-hidden>
            <span style={{ width: `${Math.min(100, level * 600)}%` }} />
            {gate > 0 && <i style={{ left: `${Math.min(100, gate * 600)}%` }} title="Noise filter" />}
          </div>
          {phase === "talk" && (
            <span className="muted small">
              {partial ? `Hearing "${partial}"…` : "Listening… The bar should jump well past the red line when you speak."}
            </span>
          )}
          {heard.length > 0 && (
            <div className="voice-heard-list">
              {heard.map((t, i) => {
                const r = reads(t);
                return (
                  <div key={heard.length - i} className="small">
                    “{t}” {r ? <span className="muted">→ {r}</span> : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <div className="voice-actions">
        <button onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
