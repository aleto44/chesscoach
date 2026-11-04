// Downloads Maia-3 (the human-like opponent, github.com/CSSLab/maia3, AGPL-3.0) into public/ once:
// the browser ONNX export the Maia team serves on maiachess.com (~46 MB).
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";

const MODEL_URL =
  "https://github.com/CSSLab/maia-platform-frontend/raw/0013cc8e6ec52c88f5b3d694781d4cc8427cb91a/public/maia3/maia3_simplified.onnx";
const model = "public/maia3/maia3.onnx";
if (!existsSync(model)) {
  mkdirSync("public/maia3", { recursive: true });
  console.log("Downloading the Maia-3 model (~46 MB)...");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Maia-3 model download failed: ${res.status}`);
  writeFileSync(`${model}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${model}.part`, model);
}
