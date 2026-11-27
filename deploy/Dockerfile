# syntax=docker/dockerfile:1
# Chess Coach's server image (docs/deployment.md). Built on laptop-server by deploy/auto-deploy.sh
# from the commit on main it deploys.

# 1. The server binary. Only server/ is built (the desktop shell's Tauri crate isn't needed here),
#    so the workspace is cut down to it. Cache mounts keep the registry and target between builds.
FROM rust:1-bookworm AS server
WORKDIR /build
COPY Cargo.lock ./
COPY server ./server
COPY coach.md ./
RUN printf '[workspace]\nmembers = ["server"]\nresolver = "3"\n' > Cargo.toml
# Thin LTO: most of the speed of a full LTO build for a fraction of the build time on the laptop.
ENV CARGO_PROFILE_RELEASE_LTO=thin CARGO_PROFILE_RELEASE_CODEGEN_UNITS=8 CARGO_PROFILE_RELEASE_STRIP=true
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release -p chesscoach-server && cp target/release/chesscoach-server /chesscoach-server

# 2. The frontend every client loads (phones and the desktop app). npm ci also fetches the engines'
#    models into public/ (postinstall); that layer only reruns when the dependencies change.
#    `npm run build` type-checks first, so a commit that doesn't compile never deploys.
FROM node:24-bookworm-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
COPY patches ./patches
COPY scripts/copy-stockfish.mjs scripts/setup-maia.mjs scripts/setup-vosk.mjs ./scripts/
RUN npm ci
COPY . .
# Which frontend this is (auto-deploy.sh: a hash of what the frontend is built from). The page
# compares it with the server's /api/version to know when it's out of date (src/update.ts).
ARG CC_UI=dev
ENV VITE_UI_VERSION=$CC_UI
RUN npm run build

# 3. The runtime: the server, the frontend and the `claude` CLI for the coach. Runs as uid 1000
#    (alex on the host), so the data and the coach's sign-in on the host stay alex's.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bash git \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 -s /bin/bash coach \
    && mkdir -p /data /claude && chown coach:coach /data /claude
USER coach
# The coach's Claude Code; its sign-in lives in /claude (a volume), so a rebuild keeps it.
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=/home/coach/.local/bin:$PATH \
    CLAUDE_CONFIG_DIR=/claude \
    CHESSCOACH_CLAUDE=/home/coach/.local/bin/claude \
    DISABLE_AUTOUPDATER=1
COPY --from=server /chesscoach-server /usr/local/bin/chesscoach-server
COPY --from=web /build/dist /app/web
WORKDIR /data
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS -o /dev/null http://127.0.0.1:8765/api/ping || exit 1
CMD ["chesscoach-server", "--data", "/data", "--port", "8765", "--web", "/app/web"]
