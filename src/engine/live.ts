// Live analysis for the eval bar: its own Stockfish, always analyzing the position on screen.
import { create } from "zustand";
import { useSettings } from "../settings";
import { isLocked, screenFen, useStore } from "../store";
import type { EngineLine } from "./stockfish";

const MAX_DEPTH = 20;

interface EvalState {
  fen: string | null;
  line: EngineLine | null;
}

export const useEval = create<EvalState>(() => ({ fen: null, line: null }));

class LiveAnalysis {
  private worker: Worker | null = null;
  private searching = false;
  private current: string | null = null;
  private pending: string | null = null;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker("/stockfish/stockfish-19-lite-single.js");
    w.onmessage = (e) => this.onLine(String(e.data));
    w.postMessage("uci");
    w.postMessage("setoption name MultiPV value 1");
    this.worker = w;
    return w;
  }

  analyze(fen: string) {
    this.pending = fen;
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
    this.pending = null;
    this.searching = true;
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
    const m = line.match(/^info .*?depth (\d+) .*?score (cp|mate) (-?\d+).*? pv (.+)$/);
    if (!m || / multipv (?!1 )/.test(line)) return;
    const flip = this.current.split(" ")[1] === "b" ? -1 : 1;
    const value = Number(m[3]) * flip;
    useEval.setState({
      fen: this.current,
      line: {
        depth: Number(m[1]),
        cp: m[2] === "cp" ? value : undefined,
        mate: m[2] === "mate" ? value : undefined,
        pv: m[4].trim().split(" "),
      },
    });
  }
}

const live = new LiveAnalysis();

/** A board of its own (the why-screen) that wants the eval, whatever the main board's setting. */
let focus: string | null = null;
let update = () => {};

/** Analyze this position instead of the main board's; null hands the engine back. */
export function setEvalFocus(fen: string | null) {
  focus = fen;
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
    if (fen === last) return;
    last = fen;
    useEval.setState({ fen, line: null });
    live.analyze(fen);
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
