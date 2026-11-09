import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error type error without @types/node package
import { createHash } from "node:crypto";
const host = process.env.TAURI_DEV_HOST;

/**
 * Browsers keep node_modules files for good, under a version that only changes with the
 * dependencies, so a new patch (patches/, patch-package) would never reach an open page or the
 * phone. Plugin names go into that version: this one's carries a hash of the patches. It also
 * restarts the dev server when a patch changes, since Vite doesn't reread node_modules on its own.
 */
function patchedDeps() {
  const hash = createHash("sha1");
  for (const f of readdirSync("patches").sort()) hash.update(f).update(readFileSync(`patches/${f}`));
  return {
    name: `patched-deps-${hash.digest("hex").slice(0, 8)}`,
    configureServer(server: { watcher: any; restart: () => Promise<void> }) {
      server.watcher.add("patches");
      // The watcher can report the path relative to the project ("patches\x.patch"), with no
      // folder in front of "patches/".
      const isPatch = (file: string) => /(^|\/)patches\//.test(file.replaceAll("\\", "/"));
      for (const ev of ["add", "change", "unlink"])
        server.watcher.on(ev, (file: string) => isPatch(file) && server.restart());
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), patchedDeps()],
  // Chessground is patched in place (patches/, patch-package). Vite's pre-bundled copy wouldn't
  // see a new patch, so serve it from node_modules as is; it's plain ES modules already.
  optimizeDeps: { exclude: ["chessground"] },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
