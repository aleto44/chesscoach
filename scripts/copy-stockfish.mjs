// Copies the lite single-threaded Stockfish build into public/ so Vite and Tauri serve it.
import { copyFileSync, mkdirSync } from "node:fs";

const src = "node_modules/stockfish/bin";
const dest = "public/stockfish";
mkdirSync(dest, { recursive: true });
for (const f of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) {
  copyFileSync(`${src}/${f}`, `${dest}/${f}`);
}
