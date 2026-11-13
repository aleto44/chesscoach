// Maia-3 (github.com/CSSLab/maia3): a network trained on Lichess games to predict the move a player
// of a given rating would make. No search, so it plays like a person: sound habits, human blunders.
import { Chess } from "chess.js";
import { policyFrom, tokens } from "./maiaInput";
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { toLichess } from "../rating";

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// Threads need cross-origin isolation, which the app doesn't have.
ort.env.wasm.numThreads = 1;

/** Sampling leaves out the unlikeliest moves that make up the last 5% of the probability. */
const TOP_P = 0.95;

let session: Promise<ort.InferenceSession> | null = null;
const getSession = () =>
  (session ??= ort.InferenceSession.create("/maia3/maia3.onnx").catch((e) => {
    session = null;
    throw e;
  }));

/** Starts loading the model so the first move isn't slow. */
export const preloadMaia = () => getSession().then(() => true, () => false);

/**
 * How likely a player of this chess.com-scale rating is to play each legal move, likeliest first
 * (UCI, probabilities summing to 1).
 */
export async function maiaPolicy(fen: string, rating: number): Promise<{ uci: string; p: number }[]> {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ""));
  if (!legal.length) return [];
  const flip = chess.turn() === "b";

  const elo = new Float32Array([toLichess(Math.max(400, Math.min(2500, rating)))]);
  const out = await (await getSession()).run({
    tokens: new ort.Tensor("float32", tokens(chess), [1, 64, 12]),
    elo_self: new ort.Tensor("float32", elo, [1]),
    elo_oppo: new ort.Tensor("float32", elo, [1]),
  });
  return policyFrom(out.logits_move.data as Float32Array, legal, flip);
}

/** A move a player of this chess.com-scale rating might play, in UCI. Samples, so it varies. */
export async function maiaMove(fen: string, rating: number): Promise<string | null> {
  const weights = await maiaPolicy(fen, rating);
  if (!weights.length) return null;
  const pool: typeof weights = [];
  let kept = 0;
  for (const m of weights) {
    if (kept >= TOP_P) break;
    pool.push(m);
    kept += m.p;
  }
  let r = Math.random() * kept;
  return pool.find((m) => (r -= m.p) <= 0)?.uci ?? pool[0].uci;
}
