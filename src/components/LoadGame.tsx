// Utility › Load game: paste or open a FEN, a PGN or a move list, or a picture of a board (a
// screenshot, a book diagram, a photo of a real board) that the coach reads. The result shows on a
// board to check (and fix, for a picture) before it opens on the analysis board.
import { useEffect, useMemo, useRef, useState } from "react";
import { buildLine } from "../chess/line";
import type { Key } from "chessground/types";
import { openAnalysis } from "../analysis/layer";
import { useSettings } from "../settings";
import {
  castlingFor,
  clearLoad,
  fenFrom,
  fenProblem,
  loadFile,
  loadImage,
  loadText,
  openHistory,
  pickGame,
  refreshHistory,
  removeHistory,
  setLoadPly,
  setLoadText,
  setOrientation,
  setPosition,
  useLoad,
  type HistoryEntry,
} from "../utility/load";
import { pieceUrl } from "../visuals";
import { Board } from "./Board";
import { MoveList } from "./BoardPanel";
import { BoardSteps } from "./StepButtons";
import type { Step } from "../chess/view";

/** The preview's step, for the arrow keys (App.tsx) as well as its buttons. */
export function loadStep(s: Step) {
  const { loaded, ply } = useLoad.getState();
  const n = loaded?.line.sans.length ?? 0;
  setLoadPly(s === "start" ? 0 : s === "end" ? n : Math.max(0, Math.min(n, Math.min(ply, n) + s)));
}

const EXAMPLE = `FEN:  r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
PGN:  [White "…"] 1. e4 e5 2. Nf3 Nc6 …
Moves: e4 e5 Nf3 Nc6  or  e2e4 e7e5 g1f3`;

export function LoadGame() {
  const { text, loaded, games, error, reading, image, ply } = useLoad();
  const file = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // A picture or text pasted anywhere on the screen (outside the text box, which takes its own paste).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (img) {
        e.preventDefault();
        loadImage(img);
        return;
      }
      if ((e.target as HTMLElement | null)?.closest?.("textarea, input")) return;
      const t = e.clipboardData?.getData("text");
      if (t?.trim()) {
        e.preventDefault();
        setLoadText(t);
        loadText(t);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) return void loadFile(f);
    const t = e.dataTransfer.getData("text");
    if (t) (setLoadText(t), loadText(t));
  };

  return (
    <div
      className={`load-game ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <h2 className="section-title">Load game</h2>
      <p className="section-lede muted">
        Paste a FEN, a PGN or a list of moves, open a file, or give a picture of a board: a screenshot, a diagram or a photo. Then check it and
        open it on the analysis board.
      </p>
      <textarea
        className="pgn-input"
        rows={4}
        value={text}
        placeholder={EXAMPLE}
        onChange={(e) => setLoadText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) loadText();
        }}
      />
      <div className="load-actions">
        <button className="primary" onClick={() => loadText()} disabled={!text.trim()} title="Ctrl+Enter">
          Load
        </button>
        <button onClick={() => file.current?.click()} disabled={reading}>
          Open a file or picture…
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".pgn,.fen,.epd,.txt,image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) loadFile(f);
          }}
        />
        {(text || loaded || image) && (
          <button className="link" onClick={clearLoad}>
            Clear
          </button>
        )}
        <span className="muted small">You can also paste or drop a picture here.</span>
      </div>
      {reading && <p className="load-reading">Reading the board in the picture…</p>}
      {error && <p className="load-error">{error}</p>}
      {games.length > 0 && <GamePicker games={games} />}
      {loaded && <Preview ply={ply} image={image} />}
      {!loaded && image && !reading && <img className="load-image" src={image} alt="The picture that was read" />}
      <History />
    </div>
  );
}

/** Earlier loads on this device, newest first: open one again without re-reading its picture. */
function History() {
  const history = useLoad((l) => l.history);
  const current = useLoad((l) => l.historyId);
  // The other device may have loaded something since this screen was last open.
  useEffect(() => void refreshHistory(), []);
  if (!history.length) return null;
  return (
    <section className="load-history">
      <div className="game-head">
        <h3 className="sub-title">Recent</h3>
        <span className="spacer" />
        <button className="link" onClick={() => removeHistory()}>
          Clear history
        </button>
      </div>
      <div className="history-list">
        {history.map((e) => (
          <HistoryRow key={e.id} entry={e} current={e.id === current} />
        ))}
      </div>
    </section>
  );
}

function HistoryRow({ entry: e, current }: { entry: HistoryEntry; current: boolean }) {
  const moves = Math.ceil(e.sans.length / 2);
  // A game shows where it ends, the position that was loaded to be looked at.
  const fen = useMemo(() => {
    const b = e.sans.length ? buildLine(e.startFen, e.sans) : null;
    return b && "line" in b ? b.line.fens[b.line.fens.length - 1] : e.startFen;
  }, [e.startFen, e.sans]);
  const when = new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className={`history-row load-history-row ${current ? "on" : ""}`}>
      <button className="load-history-open" onClick={() => openHistory(e.id)}>
        {e.thumb ? (
          <img className="load-history-thumb" src={e.thumb} alt="" />
        ) : (
          <Board fen={fen} orientation={e.orientation} preview coordinates={false} className="load-history-thumb" />
        )}
        <span className="history-main">
          <strong>{e.title}</strong>
          <span className="muted small">
            {e.kind} · {e.sans.length ? `${moves} move${moves === 1 ? "" : "s"}` : "position"} · {when}
          </span>
        </span>
      </button>
      <button className="icon" onClick={() => removeHistory(e.id)} title="Remove from history" aria-label="Remove from history">
        ×
      </button>
    </div>
  );
}

/** Several games in one PGN: one row each. */
function GamePicker({ games }: { games: string[] }) {
  const label = (pgn: string) => {
    const h = (k: string) => pgn.match(new RegExp(`\\[${k}\\s+"([^"]*)"`))?.[1];
    return `${h("White") ?? "?"} – ${h("Black") ?? "?"} ${h("Result") ?? ""}${h("Date") ? ` · ${h("Date")}` : ""}`;
  };
  return (
    <>
      <h3 className="sub-title">{games.length} games: pick one</h3>
      <div className="history-list load-games">
        {games.map((g, i) => (
          <button key={i} className="history-row" onClick={() => pickGame(i)}>
            {label(g)}
          </button>
        ))}
      </div>
    </>
  );
}

type Tool = { color: "w" | "b"; piece: "K" | "Q" | "R" | "B" | "N" | "P" } | "erase" | null;

/** The board as read: step through a game's moves; a position (no moves) can be edited square by square. */
function Preview({ ply, image }: { ply: number; image: string | null }) {
  const loaded = useLoad((l) => l.loaded)!;
  const { line, orientation, kind, title } = loaded;
  const n = line.sans.length;
  const at = Math.min(ply, n);
  const fen = line.fens[at];
  const problem = fenProblem(line.startFen);
  const [tool, setTool] = useState<Tool>(null);
  const editable = n === 0;
  const turn = fen.split(" ")[1] as "w" | "b";

  const step = loadStep;

  const onSquare = (key: Key) => {
    if (!editable || !tool) return;
    const grid = toGrid(fen.split(" ")[0]);
    const f = key.charCodeAt(0) - 97;
    const r = 8 - Number(key[1]);
    const put = tool === "erase" ? null : tool.color === "w" ? tool.piece : tool.piece.toLowerCase();
    // Tapping a square that already has the chosen piece takes it off.
    grid[r][f] = grid[r][f] === put ? null : put;
    setPosition(fenFrom(fromGrid(grid), turn));
  };

  return (
    <section className="load-preview">
      <div className="load-board">
        <div className="board-frame">
          <Board fen={fen} orientation={orientation} viewOnly lastMove={at > 0 ? line.lastMoves[at - 1] : undefined} onSquare={onSquare} />
          {n > 0 && (
            <BoardSteps onStep={step}>
              <button className="icon" onClick={() => setOrientation(orientation === "white" ? "black" : "white")} title="Flip board" aria-label="Flip board">
                ⇅
              </button>
            </BoardSteps>
          )}
        </div>
        {image && <img className="load-image" src={image} alt="The picture that was read" />}
      </div>
      <div className="load-side">
        <div className="game-head">
          <strong>{title}</strong>
          <span className="spacer" />
          <span className="muted small">{kind}</span>
        </div>
        {n > 0 ? (
          <div className="load-moves">
            <MoveList sans={line.sans} fens={line.fens} ply={at} onGoto={setLoadPly} />
          </div>
        ) : null}
        {n > 0 ? (
          <div className="side-controls">
            <div className="nav-buttons">
              <button onClick={() => step("start")} title="Start (Home)" aria-label="Start">⏮</button>
              <button onClick={() => step(-1)} title="Back (←)" aria-label="Back">◀</button>
              <button onClick={() => step(1)} title="Forward (→)" aria-label="Forward">▶</button>
              <button onClick={() => step("end")} title="End (End)" aria-label="End">⏭</button>
            </div>
            <button className="icon" onClick={() => setOrientation(orientation === "white" ? "black" : "white")} title="Flip board" aria-label="Flip board">
              ⇅
            </button>
          </div>
        ) : (
          <>
            {image && <p className="muted small">Check the board against the picture. Pick a piece below, then tap squares to fix any it misread.</p>}
            <div className="segmented">
              {(["w", "b"] as const).map((c) => (
                <button key={c} className={turn === c ? "on" : ""} onClick={() => setPosition(fenFrom(fen.split(" ")[0], c))}>
                  {c === "w" ? "White to move" : "Black to move"}
                </button>
              ))}
            </div>
            <div className="segmented">
              {(["white", "black"] as const).map((c) => (
                <button key={c} className={orientation === c ? "on" : ""} onClick={() => setOrientation(c)}>
                  {c === "white" ? "White at the bottom" : "Black at the bottom"}
                </button>
              ))}
            </div>
            <Palette tool={tool} setTool={setTool} />
            <p className="muted small load-fen" title="The position as FEN">
              {fen.split(" ")[0]} {turn} {castlingFor(fen.split(" ")[0])}
            </p>
          </>
        )}
        {problem && <p className="load-error">Not a legal position yet: {problem}.</p>}
        <button className="primary load-analyze" disabled={!!problem} onClick={openAnalysis}>
          Analyze{n > 0 && at < n ? (at ? ` from move ${Math.ceil(at / 2)}` : " from the start") : ""} ›
        </button>
      </div>
    </section>
  );
}

/** A piece to place, the eraser, or nothing (the board takes drawings then, as always). */
function Palette({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const set = useSettings((s) => s.pieceSet);
  const same = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);
  const pick = (t: Tool) => setTool(same(tool, t) ? null : t);
  return (
    <div className="load-palette" role="toolbar" aria-label="Set up pieces">
      {(["w", "b"] as const).map((color) => (
        <div key={color} className="load-palette-row">
          {(["K", "Q", "R", "B", "N", "P"] as const).map((piece) => (
            <button
              key={piece}
              className={same(tool, { color, piece }) ? "on" : ""}
              onClick={() => pick({ color, piece })}
              aria-label={`${color === "w" ? "White" : "Black"} ${piece}`}
            >
              <img src={pieceUrl(set, color, piece)} alt="" />
            </button>
          ))}
        </div>
      ))}
      <div className="load-palette-row">
        <button className={tool === "erase" ? "on" : ""} onClick={() => pick("erase")}>
          Erase
        </button>
        <button onClick={() => setPosition(fenFrom("8/8/8/8/8/8/8/8", "w"))}>Empty</button>
        <button onClick={() => setPosition(fenFrom("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", "w"))}>Start</button>
      </div>
    </div>
  );
}

function toGrid(placement: string): (string | null)[][] {
  return placement.split("/").map((row) => {
    const out: (string | null)[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null);
      else out.push(ch);
    }
    return out;
  });
}

function fromGrid(grid: (string | null)[][]): string {
  return grid
    .map((row) => {
      let s = "";
      let empty = 0;
      for (const c of row) {
        if (c) {
          if (empty) s += empty;
          s += c;
          empty = 0;
        } else empty++;
      }
      return empty ? s + empty : s;
    })
    .join("/");
}
