import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { formatMoves } from "../chess/line";
import { newSession, sendToCoach } from "../coach/bridge";
import { openTangent, useStore, type ChatItem } from "../store";
import { Board } from "./Board";

export function Chat() {
  const { chat, busy } = useStore();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    sendToCoach(text);
  };

  return (
    <aside className="chat">
      <header>
        <span className={`status ${busy ? "busy" : ""}`} />
        <strong>Coach</strong>
        <span className="spacer" />
        <button onClick={newSession} title="Start a new coach session (rereads coach.md)">
          New session
        </button>
      </header>

      <div className="messages">
        {chat.length === 0 && (
          <p className="hint">
            Play some moves, then ask about the position, e.g. <em>“What's the idea behind this move?”</em> or{" "}
            <em>“Why not …Nf6 here?”</em>
          </p>
        )}
        {chat.map((item) => (
          <ChatRow key={item.id} item={item} />
        ))}
        {busy && <div className="typing">Coach is thinking…</div>}
        <div ref={bottom} />
      </div>

      <div className="composer">
        <textarea
          value={draft}
          placeholder="Ask the coach…  (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button onClick={send} disabled={busy || !draft.trim()}>
          Send
        </button>
      </div>
    </aside>
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
  }
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
