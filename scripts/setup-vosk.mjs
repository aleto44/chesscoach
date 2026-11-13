// Downloads the small English Vosk model (offline speech recognition for voice moves, Apache-2.0,
// alphacephei.com/vosk) into public/ once, packed the way vosk-browser loads it (~41 MB). The small
// models are the ones that take a grammar, which is what keeps recognition to chess words.
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";

const MODEL_URL = "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz";
const model = "public/vosk/model-en-us.tar.gz";
if (!existsSync(model)) {
  mkdirSync("public/vosk", { recursive: true });
  console.log("Downloading the Vosk speech model (~41 MB)...");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Vosk model download failed: ${res.status}`);
  writeFileSync(`${model}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${model}.part`, model);
}
