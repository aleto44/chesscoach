import { Chess } from "chess.js";

export interface EngineLine {
  /** Centipawns from White's point of view; undefined when mate is set. */
  cp?: number;
  /** Mate in N from White's point of view (negative: Black mates). */
  mate?: number;
  depth: number;
  pv: string[]; // UCI
}

/** Stockfish (WASM, single-threaded) behind a job queue so concurrent tool calls don't interleave. */
class Engine {
  private worker = new Worker("/stockfish/stockfish-19-lite-single.js");
  private onLine: ((line: string) => void) | null = null;
  private queue: Promise<unknown>;

  constructor() {
    this.worker.onmessage = (e) => this.onLine?.(String(e.data));
    this.queue = this.run("uci", (l) => l === "uciok").then(() =>
      this.run("isready", (l) => l === "readyok"),
    );
  }

  private run(cmd: string, done: (line: string) => boolean, onInfo?: (line: string) => void) {
    return new Promise<void>((resolve) => {
      this.onLine = (line) => {
        if (done(line)) {
          this.onLine = null;
          resolve();
        } else onInfo?.(line);
      };
      this.worker.postMessage(cmd);
    });
  }

  analyze(fen: string, multipv: number, depth: number): Promise<EngineLine[]> {
    const job = this.queue.then(async () => {
      const lines = new Map<number, EngineLine>();
      const flip = fen.split(" ")[1] === "b" ? -1 : 1;
      this.worker.postMessage(`setoption name MultiPV value ${multipv}`);
      this.worker.postMessage(`position fen ${fen}`);
      await this.run(`go depth ${depth}`, (l) => l.startsWith("bestmove"), (l) => {
        const m = l.match(/^info .*?depth (\d+) .*?multipv (\d+) score (cp|mate) (-?\d+).*? pv (.+)$/);
        if (!m) return;
        const value = Number(m[4]) * flip;
        lines.set(Number(m[2]), {
          depth: Number(m[1]),
          cp: m[3] === "cp" ? value : undefined,
          mate: m[3] === "mate" ? value : undefined,
          pv: m[5].trim().split(" "),
        });
      });
      return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** A move to play, in UCI. `elo` null = full strength. */
  bestMove(fen: string, elo: number | null, movetime: number): Promise<string | null> {
    const job = this.queue.then(async () => {
      let best: string | null = null;
      this.worker.postMessage("setoption name MultiPV value 1");
      this.worker.postMessage(`setoption name UCI_LimitStrength value ${elo !== null}`);
      if (elo !== null) this.worker.postMessage(`setoption name UCI_Elo value ${elo}`);
      this.worker.postMessage(`position fen ${fen}`);
      await this.run(`go movetime ${movetime}`, (l) => {
        if (!l.startsWith("bestmove")) return false;
        const move = l.split(" ")[1];
        best = move && move !== "(none)" ? move : null;
        return true;
      });
      return best;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}

let engine: Engine | null = null;
/** For the coach's analysis. */
export const getEngine = () => (engine ??= new Engine());

let opponent: Engine | null = null;
/** A separate instance so the opponent never waits behind the coach's analysis. */
export const getOpponentEngine = () => (opponent ??= new Engine());

let review: Engine | null = null;
/** Post-game analysis runs in the background on its own instance. */
export const getReviewEngine = () => (review ??= new Engine());

/**
 * Stockfish's UCI_Elo (calibrated against engine rating lists) next to the chess.com rapid rating it
 * roughly plays like. Below ~2000 chess.com runs well under FIDE/CCRL numbers; above, a little over.
 * An estimate: tune it here. The ends are the UCI_Elo range this build accepts.
 */
const RATING_SCALE: [engineElo: number, chessCom: number][] = [
  [1320, 950],
  [1650, 1500],
  [2000, 2000],
  [2300, 2400],
  [3190, 3250],
];

function convert(x: number, from: 0 | 1, to: 0 | 1): number {
  const s = RATING_SCALE;
  if (x <= s[0][from]) return s[0][to];
  for (let i = 1; i < s.length; i++) {
    const [a, b] = [s[i - 1], s[i]];
    if (x <= b[from]) return a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
  }
  return s[s.length - 1][to];
}

/** The UCI_Elo to give Stockfish for a chess.com-scale rating. */
export const toEngineElo = (rating: number) => Math.round(convert(rating, 1, 0));
/** The chess.com-scale rating for a UCI_Elo, to the nearest 10. */
export const fromEngineElo = (elo: number) => Math.round(convert(elo, 0, 1) / 10) * 10;

/** The ratings Stockfish can play at, on the chess.com scale. */
export const STOCKFISH_RATING = { min: RATING_SCALE[0][1], max: RATING_SCALE[RATING_SCALE.length - 1][1] };

export function formatScore(l: Pick<EngineLine, "cp" | "mate">): string {
  if (l.mate !== undefined) return l.mate > 0 ? `#${l.mate}` : `#-${-l.mate}`;
  const p = (l.cp ?? 0) / 100;
  return (p > 0 ? "+" : "") + p.toFixed(2);
}

/** Converts a UCI principal variation to numbered SAN, e.g. "5...e6 6.Nf3 Nd7". */
export function pvToSan(fen: string, pv: string[], maxPlies = 10): string {
  const chess = new Chess(fen);
  const parts: string[] = [];
  for (const [i, uci] of pv.slice(0, maxPlies).entries()) {
    const [, turn, , , , full] = chess.fen().split(" ");
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    if (turn === "w") parts.push(`${full}.${m.san}`);
    else parts.push(i === 0 ? `${full}...${m.san}` : m.san);
  }
  return parts.join(" ");
}
