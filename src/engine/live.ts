// Live analysis for the eval bar: its own Stockfish, always analyzing the position on screen.
import { create } from "zustand";
import { useSettings } from "../settings";
import { isLocked, screenFen, useStore } from "../store";
import type { EngineLine } from "./stockfish";

const MAX_DEPTH = 20;

interface EvalState {
  fen: string | null;
  /** The best line (the eval bar's). */
  line: EngineLine | null;
  /** Best first: just `line`, or the top few when a board asked for several (the analysis board). */
  lines: EngineLine[];
}

export const useEval = create<EvalState>(() => ({ fen: null, line: null, lines: [] }));

class LiveAnalysis {
  private worker: Worker | null = null;
  private searching = false;
  private current: string | null = null;
  private pending: string | null = null;
  private multipv = 1;
  private pendingMultipv = 1;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker("/stockfish/stockfish-19-lite-single.js");
    w.onmessage = (e) => this.onLine(String(e.data));
    w.postMessage("uci");
    this.worker = w;
    return w;
  }

  analyze(fen: string, multipv = 1) {
    this.pending = fen;
    this.pendingMultipv = multipv;
    if (this.searching) this.ensure().postMessage("stop");
    else this.start();
  }

  stop() {
    this.pending = null;
    if (this.searching) this.worker?.postMessage("stop");
  }

  private start() {
    if (!this.pending) return;
    const w = this.ensure();
    this.current = this.pending;
    this.multipv = this.pendingMultipv;
    this.pending = null;
    this.searching = true;
    w.postMessage(`setoption name MultiPV value ${this.multipv}`);
    w.postMessage(`position fen ${this.current}`);
    w.postMessage(`go depth ${MAX_DEPTH}`);
  }

  private onLine(line: string) {
    if (line.startsWith("bestmove")) {
      this.searching = false;
      this.start();
      return;
    }
    // Lines arriving after a stop belong to the old position.
    if (this.pending || !this.current) return;
    const m = line.match(/^info .*?depth (\d+) .*?(?:multipv (\d+) .*?)?score (cp|mate) (-?\d+).*? pv (.+)$/);
    if (!m) return;
    const k = Number(m[2] ?? 1) - 1;
    if (k >= this.multipv) return;
    const flip = this.current.split(" ")[1] === "b" ? -1 : 1;
    const value = Number(m[4]) * flip;
    const found: EngineLine = {
      depth: Number(m[1]),
      cp: m[3] === "cp" ? value : undefined,
      mate: m[3] === "mate" ? value : undefined,
      pv: m[5].trim().split(" "),
    };
    const prev = useEval.getState();
    const lines = prev.fen === this.current ? prev.lines.slice() : [];
    lines[k] = found;
    useEval.setState({ fen: this.current, line: lines[0] ?? null, lines: lines.filter(Boolean) });
  }
}

const live = new LiveAnalysis();

/** A board of its own (the why-screen) that wants the eval, whatever the main board's setting. */
let focus: string | null = null;
let focusLines = 1;
let update = () => {};

/** Analyze this position instead of the main board's (`lines`: how many top moves); null hands the engine back. */
export function setEvalFocus(fen: string | null, lines = 1) {
  focus = fen;
  focusLines = fen ? lines : 1;
  update();
}

/** Follows the on-screen position while the eval bar is shown (never during a rated game). */
export function initLiveEval() {
  let last: string | null = null;
  update = () => {
    if (isLocked() || (!focus && !useSettings.getState().showEval)) {
      live.stop();
      last = null;
      return;
    }
    const fen = focus ?? screenFen();
    const key = `${focusLines} ${fen}`;
    if (key === last) return;
    last = key;
    useEval.setState({ fen, line: null, lines: [] });
    live.analyze(fen, focusLines);
  };
  useStore.subscribe(update);
  useSettings.subscribe(update);
  update();
}

/** White's expected score in percent, the usual logistic mapping from centipawns. */
export function whiteWinPercent(line: Pick<EngineLine, "cp" | "mate">): number {
  if (line.mate !== undefined) return line.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * (line.cp ?? 0))) - 1);
}
