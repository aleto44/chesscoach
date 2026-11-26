#!/usr/bin/env bash
# Runs on laptop-server, started by scripts/deploy.ps1: unpacks the source it sent into
# /srv/services/chesscoach/src, puts the compose file and snapshot.conf next to it, then rebuilds
# and restarts the container and waits until it's healthy.
# usage: install.sh /tmp/chesscoach-src.tgz
set -euo pipefail
TGZ=$1
HERE=/srv/services/chesscoach
mkdir -p "$HERE/data/sounds" "$HERE/claude"

rm -rf "$HERE/src.new"
mkdir "$HERE/src.new"
tar -xzf "$TGZ" -C "$HERE/src.new"
rm -rf "$HERE/src.old"
[ -d "$HERE/src" ] && mv "$HERE/src" "$HERE/src.old"
mv "$HERE/src.new" "$HERE/src"
rm -rf "$HERE/src.old" "$TGZ"

install -m 644 "$HERE/src/deploy/docker-compose.yml" "$HERE/docker-compose.yml"
install -m 644 "$HERE/src/deploy/snapshot.conf" "$HERE/snapshot.conf"

cd "$HERE"
echo "Building (the first build takes a while; later ones reuse the cache)..."
docker compose up -d --build

for i in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' chesscoach 2>/dev/null || echo missing)
  if [ "$state" = healthy ]; then
    echo "chesscoach is healthy"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done
echo "chesscoach did not become healthy (state: $state)"
docker logs --tail 40 chesscoach
exit 1
