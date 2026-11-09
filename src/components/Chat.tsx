import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { formatMoves } from "../chess/line";
import { rehypeSquares } from "../chess/squareRefs";
import { logout, useAuth } from "../coach/auth";
import { restartCoach, sendToCoach } from "../coach/bridge";
import { skipQuiz } from "../coach/quiz";
import { bestSan, nudgeQuestion, useNudge } from "../coach/nudge";
import { useTrainerChat, type TrainerItem } from "../coach/trainerChat";
import { takeBack } from "../game/session";
import { hasBackend } from "../db";
import { saveSetting, useSettings } from "../settings";
import { goto, isLocked, openTangent, tangentOrientation, useStore, type ChatItem } from "../store";
import { anySession, go, peekScenario, useNav } from "../nav";
import { useBoardBottom, useChromeHeights, usePhone, useSheet, type Sheet } from "../phone";
import { Board } from "./Board";
import { SquareRef } from "./SquareText";
import { askConfirm } from "./Confirm";
import { SignIn } from "./SignIn";
import { UsageMeter } from "./UsageMeter";

/** The game's chat with the trainer's messages slotted in where they came, so a follow-up sits under what it follows. */
function interleave(chat: ChatItem[], trainer: TrainerItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  let t = 0;
  chat.forEach((c, i) => {
    while (t < trainer.length && trainer[t].after <= i) out.push(trainer[t++]);
    out.push(c);
  });
  return out.concat(trainer.slice(t));
}

export function Chat() {
  const { chat, busy, meta } = useStore();
  // A trainer's own thread (the opening trainer's explanations): shown among the game's chat, never saved into it.
  const trainer = useTrainerChat();
  const locked = isLocked(meta);
  const auth = useAuth();
  const phone = usePhone();
  const { coachModel, activeModel, chatCollapsed } = useSettings();
  const collapsed = chatCollapsed && !phone;
  const signedIn = auth.status === "signed-in" || !hasBackend();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const sheet = useSheet((s) => s.sheet);
  useBoardBottom(phone);
  useChromeHeights(phone);

  // Minimized on a phone: a question asked from a button (Ask the coach) opens it to show the answer.
  const thinking = busy || trainer.thinkingSince !== null;
  useEffect(() => {
    if (phone && thinking && useSheet.getState().sheet === "tab") openSheet("half");
  }, [thinking]);

  useEffect(() => {
    // Scrolls the messages list only; scrollIntoView would also scroll the phone's page.
    const list = bottom.current?.parentElement;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat, sheet, trainer]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !signedIn || locked) return;
    setDraft("");
    sendToCoach(text);
    // On a phone the answer shows under the board, which stays in view.
    if (phone && sheet === "closed") openSheet("half");
  };

  return (
    <>
    <aside className={`chat ${phone ? `sheet sheet-${sheet}` : ""} ${collapsed ? "collapsed" : ""}`} aria-hidden={collapsed || undefined}>
      {phone ? <SheetBar /> : <ResizeHandle />}
      <header>
        <span className={`status ${busy || trainer.thinkingSince !== null ? "busy" : ""}`} />
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
        {!phone && (
          <button className="chat-hide" onClick={() => saveSetting("chatCollapsed", true)} title="Hide the coach (it stays as a tab on the right)" aria-label="Hide the coach">
            »
          </button>
        )}
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
        {!locked && chat.length === 0 && trainer.items.length === 0 && meta.mode === "practice" && (
          <p className="hint">
            Play some moves, then ask about the position, e.g. <em>“What's the idea behind this move?”</em> or{" "}
            <em>“Why not …Nf6 here?”</em>
          </p>
        )}
        {interleave(chat, trainer.items).map((item) => (
          <ChatRow key={item.id} item={item} />
        ))}
        {busy && <Thinking />}
        {trainer.thinkingSince !== null && <Thinking since={trainer.thinkingSince} />}
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
          onFocus={() => phone && sheet === "closed" && openSheet("half")}
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
    {collapsed && <CoachTab busy={busy || trainer.thinkingSince !== null} count={chat.length + trainer.items.length} />}
    {phone && sheet === "tab" && <PhoneCoachTab busy={thinking} count={chat.length + trainer.items.length} />}
    </>
  );
}

/**
 * Desktop: the hidden coach's tab on the right edge. A dot shows while it's thinking, and another
 * when something new came in since it was hidden.
 */
/** Phones: the coach minimized to a tab in the bottom corner; a tap opens it under the board. */
function PhoneCoachTab({ busy, count }: { busy: boolean; count: number }) {
  const [seen] = useState(count);
  return (
    <button className="phone-coach-tab" onClick={() => openSheet("half")} aria-label="Show the coach">
      <span className={`status ${busy ? "busy" : ""}`} />
      Coach
      {count > seen && !busy && <span className="coach-tab-new" aria-label="New messages" />}
      <span aria-hidden>▴</span>
    </button>
  );
}

function CoachTab({ busy, count }: { busy: boolean; count: number }) {
  const [seen] = useState(count);
  return (
    <button className="coach-tab" onClick={() => saveSetting("chatCollapsed", false)} title="Show the coach">
      <span className={`status ${busy ? "busy" : ""}`} />
      Coach
      {count > seen && !busy && <span className="coach-tab-new" aria-label="New messages" />}
    </button>
  );
}

const MIN_CHAT_W = 280;
const MAX_CHAT_W = 900;

/** Desktop: drag the coach column's left edge to resize it; double-click puts it back to the default. */
function ResizeHandle() {
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const app = handle.closest(".app");
    app?.classList.add("resizing");
    // Leaves the board column at least 360px; the CSS clamps the same way when the window shrinks.
    const widthAt = (x: number) =>
      Math.round(Math.max(MIN_CHAT_W, Math.min(MAX_CHAT_W, window.innerWidth - 360, window.innerWidth - x)));
    const move = (ev: PointerEvent) => useSettings.setState({ chatWidth: widthAt(ev.clientX) });
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      app?.classList.remove("resizing");
      // Saved once, when the drag ends.
      saveSetting("chatWidth", useSettings.getState().chatWidth);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  return (
    <div
      className="chat-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the coach"
      title="Drag to resize · double-click to reset"
      onPointerDown={start}
      onDoubleClick={() => saveSetting("chatWidth", 420)}
    />
  );
}

const TOOL_LABELS: Record<string, string> = {
  analyze: "Analyzing the position",
  show_line: "Checking every move of the line",
  evaluate_moves: "Comparing moves with the engine",
  position_facts: "Looking over the position",
  get_state: "Looking at the board",
  ask_move: "Waiting for your move on the board",
  setup_position: "Setting up a position",
  draw_arrows: "Drawing on the board",
  get_profile: "Looking at your history",
  query_games: "Going through your games",
  record_observation: "Making a note",
};

/**
 * Animated "working" row: what the coach is doing and for how long. Hidden while text streams.
 * `since` is for a one-off answer (a trainer's), which has no tools or streaming.
 */
function Thinking({ since }: { since?: number }) {
  const store = useStore();
  const { streaming, chat } = since === undefined ? store : { streaming: false, chat: [] as ChatItem[] };
  const busySince = since ?? store.busySince;
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
          <Markdown components={MARKDOWN} rehypePlugins={[rehypeSquares]}>{item.text}</Markdown>
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

/**
 * The coach links to its scenarios as [words](#s2); those become buttons that open them on the board.
 * Squares and moves it names show on the board while hovered: a square highlighted, a move as an arrow.
 */
const MARKDOWN: Components = {
  span: ({ node: _node, ...props }) => {
    const ref = (props as { "data-ref"?: string })["data-ref"];
    return ref ? <SquareRef {...props} squareRef={ref} /> : <span {...props} />;
  },
  a: ({ href, children }) => {
    const key = href?.match(/^#(s\d+)$/)?.[1];
    if (key) return <ScenarioLink scenarioKey={key}>{children}</ScenarioLink>;
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

function ScenarioLink({ scenarioKey, children }: { scenarioKey: string; children: ReactNode }) {
  const tangentId = useStore((s) => {
    const card = s.chat.find((c) => c.kind === "tangent" && c.key === scenarioKey);
    return card?.kind === "tangent" ? card.tangentId : null;
  });
  const active = useStore((s) => !!tangentId && s.active === tangentId);
  if (!tangentId) return <>{children}</>;
  return (
    <button className={`scenario-link ${active ? "active" : ""}`} onClick={() => openScenario(tangentId)} title="Show this on the board">
      <span className="scenario-icon" aria-hidden>
        ♞
      </span>
      {children}
    </button>
  );
}

/**
 * Opens a coach scenario on the main board. Over a puzzle, drill or trainer it's a peek: the
 * session keeps running and the scenario's return button goes back to it.
 */
function openScenario(tangentId: string) {
  if (anySession()) peekScenario(tangentId);
  else {
    if (useNav.getState().view !== "board") go("board");
    openTangent(tangentId);
  }
  // On a phone, the board must be in view: the sheet drops to under it.
  if (useSheet.getState().sheet === "full") openSheet("half");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const openSheet = (sheet: Sheet) => useSheet.setState({ sheet });

/**
 * Phones: the chat is a sheet over the bottom of the screen. Closed it's a bar with the latest
 * message; half-open it fills the space under the board, so the coach's boards stay in view
 * while you read; full it covers the screen for long answers. The move buttons belong to the
 * board (a row under it), not to this bar.
 */
function SheetBar() {
  const sheet = useSheet((s) => s.sheet);
  const { chat, busy: gameBusy } = useStore();
  const trainer = useTrainerChat();
  const busy = gameBusy || trainer.thinkingSince !== null;
  const signedIn = useAuth((a) => a.status === "signed-in");
  const last = [...chat, ...trainer.items].reverse().find((c) => c.kind === "coach");
  const preview = last?.kind === "coach" ? last.text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_#`>]/g, "").trim() : "";
  // The bar opens and closes the sheet; the size button switches between half and full.
  const open = sheet === "half" || sheet === "full";
  return (
    <div className="sheet-bar">
      <button className="sheet-handle" onClick={() => openSheet(open ? "closed" : "half")} aria-label={open ? "Close the chat" : "Open the chat"}>
        <span className="sheet-grip" aria-hidden />
        <span className={`status ${busy ? "busy" : ""}`} />
        <strong>Coach</strong>
        {!open && <span className="sheet-preview muted">{busy ? "Thinking…" : preview || "Ask about the position"}</span>}
        <span className="spacer" />
        <span aria-hidden>{open ? "▾" : "▴"}</span>
      </button>
      {/* The chat's own header (and its usage ring) is hidden on phones, so the ring lives here. */}
      {signedIn && <UsageMeter />}
      {!open && (
        <button className="sheet-size" onClick={() => openSheet("tab")} aria-label="Minimize the coach" title="Minimize the coach">
          –
        </button>
      )}
      {open && (
        <button
          className="sheet-size"
          onClick={() => openSheet(sheet === "full" ? "half" : "full")}
          aria-label={sheet === "full" ? "Show the board" : "Full screen"}
          title={sheet === "full" ? "Show the board" : "Full screen"}
        >
          {sheet === "full" ? "⤡" : "⤢"}
        </button>
      )}
    </div>
  );
}

function TangentCard({ tangentId }: { tangentId: string }) {
  const tangent = useStore((s) => s.tangents[tangentId]);
  const active = useStore((s) => s.active === tangentId);
  const orientation = useStore((s) => tangentOrientation(s, tangentId));
  if (!tangent) return null;
  const { line } = tangent;
  return (
    <button className={`tangent-card ${active ? "active" : ""}`} onClick={() => openScenario(tangentId)}>
      <Board
        fen={line.fens[line.fens.length - 1]}
        lastMove={line.lastMoves[line.lastMoves.length - 1]}
        orientation={orientation}
        preview
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
