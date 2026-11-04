// Maia-3 (github.com/CSSLab/maia3): a network trained on Lichess games to predict the move a player
// of a given rating would make. No search, so it plays like a person: sound habits, human blunders.
import { Chess, type Square } from "chess.js";
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// Threads need cross-origin isolation, which the app doesn't have.
ort.env.wasm.numThreads = 1;

const PIECES = "pnbrqk";
const FILES = "abcdefgh";
const square = (i: number) => (FILES[i % 8] + (Math.floor(i / 8) + 1)) as Square;
const mirror = (uci: string) =>
  uci[0] + (9 - Number(uci[1])) + uci[2] + (9 - Number(uci[3])) + uci.slice(4);

/** The model's move vocabulary: every from-to pair, then every promotion from the 7th rank to the 8th. */
const MOVE_INDEX = new Map<string, number>();
for (let from = 0; from < 64; from++)
  for (let to = 0; to < 64; to++) MOVE_INDEX.set(square(from) + square(to), MOVE_INDEX.size);
for (const from of FILES)
  for (const to of FILES) for (const p of "qrbn") MOVE_INDEX.set(`${from}7${to}8${p}`, MOVE_INDEX.size);

/**
 * One row of 12 per square (a1 first): the mover's pieces in 0–5, the other side's in 6–11. With
 * Black to move the board is mirrored, so the model always sees itself playing up the board.
 */
function tokens(chess: Chess): Float32Array {
  const out = new Float32Array(64 * 12);
  const flip = chess.turn() === "b";
  for (let i = 0; i < 64; i++) {
    const piece = chess.get(square(flip ? i ^ 56 : i));
    if (piece) out[i * 12 + PIECES.indexOf(piece.type) + (piece.color === chess.turn() ? 0 : 6)] = 1;
  }
  return out;
}

/** chess.com rapid next to the Lichess rapid rating that's roughly the same level. */
const LICHESS_SCALE: [chessCom: number, lichess: number][] = [
  [400, 900],
  [1000, 1400],
  [1500, 1750],
  [2000, 2100],
  [2500, 2500],
];

function toLichess(rating: number): number {
  const s = LICHESS_SCALE;
  if (rating <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    const [a, b] = [s[i - 1], s[i]];
    if (rating <= b[0]) return a[1] + ((rating - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return s[s.length - 1][1];
}

/** Sampling leaves out the unlikeliest moves that make up the last 5% of the probability. */
const TOP_P = 0.95;

let session: Promise<ort.InferenceSession> | null = null;
const getSession = () =>
  (session ??= ort.InferenceSession.create("/maia3/maia3.onnx").catch((e) => {
    session = null;
    throw e;
  }));

/** Starts loading the model so the first move isn't slow. */
export const preloadMaia = () => void getSession().catch(() => undefined);

/** A move a player of this chess.com-scale rating might play, in UCI. Samples, so it varies. */
export async function maiaMove(fen: string, rating: number): Promise<string | null> {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ""));
  if (!legal.length) return null;
  const flip = chess.turn() === "b";

  const elo = new Float32Array([toLichess(rating)]);
  const out = await (await getSession()).run({
    tokens: new ort.Tensor("float32", tokens(chess), [1, 64, 12]),
    elo_self: new ort.Tensor("float32", elo, [1]),
    elo_oppo: new ort.Tensor("float32", elo, [1]),
  });
  const logits = out.logits_move.data as Float32Array;

  const scored = legal.map((uci) => ({ uci, logit: logits[MOVE_INDEX.get(flip ? mirror(uci) : uci)!] }));
  const max = Math.max(...scored.map((m) => m.logit));
  const weights = scored.map((m) => ({ uci: m.uci, p: Math.exp(m.logit - max) })).sort((a, b) => b.p - a.p);
  const total = weights.reduce((t, m) => t + m.p, 0);
  const pool: typeof weights = [];
  let kept = 0;
  for (const m of weights) {
    if (kept >= TOP_P * total) break;
    pool.push(m);
    kept += m.p;
  }
  let r = Math.random() * kept;
  return pool.find((m) => (r -= m.p) <= 0)?.uci ?? pool[0].uci;
}
