#!/usr/bin/env bash
# Chess Coach's deploys on laptop-server (docs/deployment.md): what runs is always main on GitHub.
# Installed as /usr/local/bin/chesscoach-deploy; chesscoach-deploy.timer runs `auto` every minute.
#
#   chesscoach-deploy auto      deploy main if it moved (skips a commit that already failed, and holds)
#   chesscoach-deploy now       the same, right away, and tries a failed commit again
#   chesscoach-deploy status    what's deployed, what's on main, failures, holds
#   chesscoach-deploy rollback  go back to the image before the last deploy; holds until main moves
#   chesscoach-deploy hold [why] / release   pause and resume automatic deploys
#
# A deploy builds the commit into a new image while the old container keeps running, then swaps
# containers and waits for the health check; if the new one isn't healthy, the old image comes
# back. A failure is kept in state/failed, which server-watch alerts on (chesscoach_deploy).
set -euo pipefail
HERE=/srv/services/chesscoach
REPO=$HERE/repo
STATE=$HERE/state
URL=https://github.com/aleto44/chesscoach.git
mkdir -p "$STATE"
cd "$HERE"

log() { echo "$(date '+%F %T') $*"; }

# One deploy at a time: the timer and a manual `now` wait for each other.
exec 9>"$STATE/lock"
flock 9

fetch() {
  [ -d "$REPO/.git" ] || git clone -q --no-checkout "$URL" "$REPO"
  git -C "$REPO" fetch -q origin main
  git -C "$REPO" rev-parse origin/main
}

# Hashes of what each part is built from, so a client knows whether a deploy changed *its* part.
ui_version() {
  git -C "$REPO" ls-tree -r "$1" -- src public index.html package.json package-lock.json vite.config.ts \
    tsconfig.json tsconfig.node.json patches scripts/copy-stockfish.mjs scripts/setup-maia.mjs \
    scripts/setup-vosk.mjs | sha1sum | cut -c1-12
}
shell_version() { git -C "$REPO" rev-parse "$1:src-tauri" | cut -c1-12; }

wait_healthy() {
  local state=missing
  for _ in $(seq 1 60); do
    state=$(docker inspect -f '{{.State.Health.Status}}' chesscoach 2>/dev/null || echo missing)
    [ "$state" = healthy ] && return 0
    sleep 2
  done
  log "chesscoach did not become healthy (state: $state)"
  docker logs --tail 40 chesscoach || true
  return 1
}

# Installs a file from the deployed source if it changed; prints the path when it did.
install_if_changed() { # src dest mode
  if ! sudo cmp -s "$1" "$2"; then sudo install -m "$3" "$1" "$2"; echo "$2"; fi
}

deploy() {
  local commit=$1 short=${1:0:7} subject ui shell
  subject=$(git -C "$REPO" log -1 --format=%s "$commit" | tr -d "'\"\$\`\\\\")
  ui=$(ui_version "$commit")
  shell=$(shell_version "$commit")
  log "deploying $short: $subject (ui $ui, shell $shell)"

  rm -rf src.new
  mkdir src.new
  git -C "$REPO" archive "$commit" | tar -x -C src.new

  # Build while the running container carries on; keep the current image for a rollback.
  if docker image inspect chesscoach:local >/dev/null 2>&1; then
    docker tag chesscoach:local chesscoach:previous
    [ -f .env ] && cp .env .env.previous
  fi
  if ! docker build --progress=plain -f src.new/deploy/Dockerfile --build-arg "CC_UI=$ui" -t chesscoach:local src.new     >"$STATE/build.log" 2>&1; then
    log "build failed for $short (state/build.log):"
    tail -n 30 "$STATE/build.log"
    docker image inspect chesscoach:previous >/dev/null 2>&1 && docker tag chesscoach:previous chesscoach:local
    echo "$commit build failed: $subject" >"$STATE/failed"
    rm -rf src.new
    return 1
  fi

  rm -rf src.old
  [ -d src ] && mv src src.old
  mv src.new src
  rm -rf src.old
  install -m 644 src/deploy/docker-compose.yml docker-compose.yml
  install -m 644 src/deploy/snapshot.conf snapshot.conf
  cat >.env <<EOF
CC_COMMIT=$commit
CC_SUBJECT='$subject'
CC_DEPLOYED_AT=$(date -Is)
CC_UI=$ui
CC_SHELL=$shell
EOF
  docker compose up -d --no-build --quiet-pull 2>&1 | grep -v '^ *$' || true
  if ! wait_healthy; then
    log "$short isn't healthy; going back to the previous image"
    echo "$commit not healthy after deploy: $subject" >"$STATE/failed"
    if docker image inspect chesscoach:previous >/dev/null 2>&1; then
      docker tag chesscoach:previous chesscoach:local
      [ -f .env.previous ] && cp .env.previous .env
      docker compose up -d --no-build 2>&1 | grep -v '^ *$' || true
      wait_healthy || log "the previous image isn't healthy either"
    fi
    return 1
  fi

  echo "$commit" >"$STATE/deployed"
  rm -f "$STATE/failed"
  docker image prune -f >/dev/null

  # This script and its timer come from the repo too.
  local changed
  changed=$(install_if_changed src/deploy/auto-deploy.sh /usr/local/bin/chesscoach-deploy 755
    install_if_changed src/deploy/systemd/chesscoach-deploy.service /etc/systemd/system/chesscoach-deploy.service 644
    install_if_changed src/deploy/systemd/chesscoach-deploy.timer /etc/systemd/system/chesscoach-deploy.timer 644)
  if grep -q systemd <<<"$changed"; then sudo systemctl daemon-reload; fi
  log "deployed $short"
}

cmd=${1:-auto}
case $cmd in
  auto|now)
    target=$(fetch)
    deployed=$(cat "$STATE/deployed" 2>/dev/null || true)
    if [ "$target" = "$deployed" ]; then [ "$cmd" = now ] && log "main ($target) is already deployed"; exit 0; fi
    if [ "$cmd" = auto ]; then
      # A hold names the commit it holds back ("*": every one until `release`), so after a rollback
      # the next commit on main deploys again.
      held=$(cut -d' ' -f1 "$STATE/hold" 2>/dev/null || true)
      [ "$held" = '*' ] || [ "$held" = "$target" ] && exit 0
      # A commit that failed waits for a newer one (or `now`), rather than rebuilding every minute.
      [ "$(cut -d' ' -f1 "$STATE/failed" 2>/dev/null)" = "$target" ] && exit 0
    fi
    rm -f "$STATE/hold"
    # A failed automatic deploy doesn't fail the unit: state/failed is the alert (server-watch).
    deploy "$target" || { [ "$cmd" = auto ] && exit 0; exit 1; }
    ;;
  status)
    echo "deployed: $(cat "$STATE/deployed" 2>/dev/null || echo none)"
    grep -E '^CC_(SUBJECT|DEPLOYED_AT|UI|SHELL)=' .env 2>/dev/null | sed 's/^CC_/  /' || true
    echo "main:     $(git -C "$REPO" rev-parse origin/main 2>/dev/null || echo unknown) (as last fetched)"
    [ -f "$STATE/failed" ] && echo "failed:   $(cat "$STATE/failed")"
    [ -f "$STATE/hold" ] && echo "on hold:  $(cat "$STATE/hold")"
    docker inspect -f 'container: {{.State.Status}} ({{.State.Health.Status}})' chesscoach 2>/dev/null || echo "container: missing"
    ;;
  rollback)
    docker image inspect chesscoach:previous >/dev/null || { echo "no previous image"; exit 1; }
    docker tag chesscoach:previous chesscoach:local
    [ -f .env.previous ] && cp .env.previous .env
    docker compose up -d --no-build
    wait_healthy
    prev=$(sed -n 's/^CC_COMMIT=//p' .env)
    echo "$prev" >"$STATE/deployed"
    echo "$(git -C "$REPO" rev-parse origin/main) rolled back to ${prev:0:7} on $(date -Is)" >"$STATE/hold"
    log "rolled back to ${prev:0:7}; the next commit on main deploys again ('chesscoach-deploy hold' to stop that)"
    ;;
  hold) echo "* ${2:-held by hand} ($(date -Is))" >"$STATE/hold"; log "automatic deploys are on hold" ;;
  release) rm -f "$STATE/hold"; log "automatic deploys are on" ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
