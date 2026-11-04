import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { formatMoves } from "../chess/line";
import { logout, useAuth } from "../coach/auth";
import { restartCoach, sendToCoach } from "../coach/bridge";
import { skipQuiz } from "../coach/quiz";
import { bestSan, nudgeQuestion, useNudge } from "../coach/nudge";
import { takeBack } from "../game/session";
import { hasBackend } from "../db";
import { useSettings } from "../settings";
import { goto, isLocked, openTangent, useStore, type ChatItem } from "../store";
import { Board } from "./Board";
import { askConfirm } from "./Confirm";
import { SignIn } from "./SignIn";
import { UsageMeter } from "./UsageMeter";

export function Chat() {
  const { chat, busy, meta } = useStore();
  const locked = isLocked(meta);
  const auth = useAuth();
  const { coachModel, activeModel } = useSettings();
  const signedIn = auth.status === "signed-in" || !hasBackend();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !signedIn || locked) return;
    setDraft("");
    sendToCoach(text);
  };

  return (
    <aside className="chat">
      <header>
        <span className={`status ${busy ? "busy" : ""}`} />
        <strong>Coach</strong>
        {auth.status === "signed-in" && <UsageMeter />}
        <span className="muted small coach-model" title="Change in Settings (⚙)">{activeModel ?? (coachModel || "default model")}</span>
        <span className="spacer" />
        {auth.status === "signed-in" && (
          <button
            onClick={async () => (await askConfirm({ title: "Sign out of Claude?", confirmLabel: "Sign out" })) && logout()}
            title={auth.email ?? "Signed in"}
          >
            Sign out
          </button>
        )}
        <button onClick={restartCoach} title="Start a fresh coach conversation (rereads coach.md)">
          Restart coach
        </button>
      </header>

      <div className="messages">
        {locked && (
          <div className="locked-note">
            <strong>Rated game: the coach is off.</strong> No engine, coach or takebacks until it ends, so this game
            shows how you really play. Afterwards the coach can go through it with you.
          </div>
        )}
        {!locked && chat.length === 0 && meta.mode === "rated" && (
          <p className="hint">Game over. Ask the coach to go through it with you, e.g. <em>“Where did I go wrong?”</em></p>
        )}
        {!locked && chat.length === 0 && meta.mode === "practice" && (
          <p className="hint">
            Play some moves, then ask about the position, e.g. <em>“What's the idea behind this move?”</em> or{" "}
            <em>“Why not …Nf6 here?”</em>
          </p>
        )}
        {chat.map((item) => (
          <ChatRow key={item.id} item={item} />
        ))}
        {busy && <Thinking />}
        {!signedIn && <SignIn />}
        <div ref={bottom} />
      </div>

      <NudgeNote signedIn={signedIn} />

      <div className="composer">
        <textarea
          value={draft}
          disabled={!signedIn || locked}
          placeholder={
            locked ? "The coach is off until this rated game ends" : "Ask the coach…  (Enter to send, Shift+Enter for a new line)"
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button onClick={send} disabled={busy || !signedIn || locked || !draft.trim()}>
          Send
        </button>
      </div>
    </aside>
  );
}

const TOOL_LABELS: Record<string, string> = {
  analyze: "Analyzing the position",
  show_line: "Checking the line",
  get_state: "Looking at the board",
  ask_move: "Waiting for your move on the board",
  setup_position: "Setting up a position",
  draw_arrows: "Drawing on the board",
  get_profile: "Looking at your history",
  query_games: "Going through your games",
  record_observation: "Making a note",
};

/** Animated "working" row: what the coach is doing and for how long. Hidden while text streams. */
function Thinking() {
  const { busySince, streaming, chat } = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (streaming) return null;
  const running = [...chat].reverse().find((c) => c.kind === "tool" && c.status === "running");
  const name = running?.kind === "tool" ? running.text.split(" ")[0] : null;
  const label = (name && TOOL_LABELS[name]) || "Thinking";
  const seconds = busySince ? Math.floor((Date.now() - busySince) / 1000) : 0;
  return (
    <div className="thinking" role="status" aria-live="polite">
      <span className="thinking-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="thinking-label">{label}…</span>
      {seconds >= 2 && <span className="thinking-time">{seconds}s</span>}
    </div>
  );
}

function ChatRow({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return <div className="msg user">{item.text}</div>;
    case "coach":
      return (
        <div className="msg coach">
          <Markdown>{item.text}</Markdown>
        </div>
      );
    case "tangent":
      return <TangentCard tangentId={item.tangentId} />;
    case "tool":
      return (
        <div className={`tool ${item.status}`} title={item.detail}>
          {item.status === "running" ? "⋯" : item.status === "ok" ? "✓" : "✗"} {item.text}
          {item.detail && <div className="detail">{item.detail}</div>}
        </div>
      );
    case "system":
      return <div className={`msg system ${item.error ? "error" : ""}`}>{item.text}</div>;
    case "quiz":
      return <QuizCard item={item} />;
  }
}

/** "That looked like a blunder": takeback, the better move, or one question to the coach. */
function NudgeNote({ signedIn }: { signedIn: boolean }) {
  const n = useNudge();
  const busy = useStore((s) => s.busy);
  if (!n) return null;
  const best = bestSan(n);
  return (
    <div className={`nudge ${n.severity}`} role="status">
      <div>
        <strong>{n.severity === "blunder" ? "That looks like a blunder." : "That might be a mistake."}</strong>{" "}
        <span className="muted">
          {n.san}: your chances went from {Math.round(n.before)}% to {Math.round(n.after)}%.
        </span>
        {n.showBest && best && <span> Better was {best}.</span>}
      </div>
      <div className="nudge-actions">
        <button onClick={takeBack}>↶ Take back</button>
        {!n.showBest && best && <button
            onClick={() => {
              useNudge.setState({ ...n, showBest: true });
              goto(n.ply);
            }}
          >
            Show better move
          </button>}
        {signedIn && (
          <button
            disabled={busy}
            onClick={() => {
              sendToCoach(nudgeQuestion(n));
              useNudge.setState(null, true);
            }}
          >
            Ask the coach why
          </button>
        )}
        <span className="spacer" />
        <button onClick={() => useNudge.setState(null, true)} title="Dismiss" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}

function QuizCard({ item }: { item: Extract<ChatItem, { kind: "quiz" }> }) {
  const active = useStore((s) => s.active === item.tangentId);
  return (
    <div className={`quiz-card ${item.status}`}>
      <div className="quiz-prompt">
        <span className="quiz-badge">Your move</span> {item.prompt}
      </div>
      {item.status === "waiting" && (
        <div className="quiz-actions">
          {!active && <button onClick={() => openTangent(item.tangentId)}>Open the position</button>}
          <span className="muted small">{active ? "Play your answer on the board." : ""}</span>
          <span className="spacer" />
          <button onClick={() => skipQuiz(item.tangentId)}>Skip</button>
        </div>
      )}
      {item.status === "checking" && <div className="muted small">Checking with the engine…</div>}
      {item.result && (
        <div className="quiz-result">
          {item.status === "right" ? "✓ " : item.status === "wrong" ? "✗ " : ""}
          {item.result}
        </div>
      )}
    </div>
  );
}

function TangentCard({ tangentId }: { tangentId: string }) {
  const tangent = useStore((s) => s.tangents[tangentId]);
  const active = useStore((s) => s.active === tangentId);
  if (!tangent) return null;
  const { line } = tangent;
  return (
    <button className={`tangent-card ${active ? "active" : ""}`} onClick={() => openTangent(tangentId)}>
      <Board
        fen={line.fens[line.fens.length - 1]}
        lastMove={line.lastMoves[line.lastMoves.length - 1]}
        orientation={useStore.getState().orientation}
        viewOnly
        coordinates={false}
        className="mini-board"
      />
      <div className="tangent-info">
        <div className="tangent-title">{tangent.title}</div>
        <div className="tangent-moves">{formatMoves(line)}</div>
        <div className="tangent-open">{active ? "Open on the board" : "Open on the board →"}</div>
      </div>
    </button>
  );
}
