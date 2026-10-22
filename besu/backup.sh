#!/usr/bin/env bash
#
# Backs up what cannot be re-created, without stopping the network.
#
#   ./backup.sh /var/backups/sabha             keys and settings, then chain data
#   ./backup.sh /var/backups/sabha --keys-only keys and settings only (instant)
#
# Keys and settings are the part that matters: with the validators' keys you can
# rebuild everything else from the other validators. They go into one archive
# that is readable only by you, because the keys sign blocks. Copy it OFF this
# machine (scp, rclone, anything); a backup on the same disk is not a backup.
#
# The chain data is then copied one validator at a time. Four validators
# tolerate one being down, so each is stopped, archived and started again, and
# the script waits for it to rejoin before it touches the next. Never run two
# copies of this at once: with two validators down the chain stops producing
# blocks (nothing is lost, but nobody can vote until one returns).
#
# Validator 1 serves the public endpoint, so it goes last and the dashboard
# loses its connection for a short while at the end.
#
set -euo pipefail
cd "$(dirname "$0")"

DEST="${1:-}"
MODE="${2:-}"
if [ -z "$DEST" ] || { [ -n "$MODE" ] && [ "$MODE" != "--keys-only" ]; }; then
  echo "usage: ./backup.sh <destination-directory> [--keys-only]" >&2
  exit 2
fi
if [ ! -d nodes ]; then
  echo "No nodes/ directory here. Run this from the besu directory of a set-up network." >&2
  exit 1
fi

umask 077
mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# Host ports of the validators' RPC, in order node1..node4 (see docker-compose.yml).
# Overridable so the wait below can be tested against another layout.
read -r -a PORTS <<< "${BESU_NODE_PORTS:-${BESU_LOCAL_RPC_PORT:-8545} 8546 8547 8548}"

echo "Archiving keys and settings..."
KEYS="$DEST/sabha-keys-$STAMP.tgz"
tar czf "$KEYS" \
  $( [ -f .env ] && echo .env ) \
  genesis.json static-nodes.json \
  nodes/*/key nodes/*/key.pub nodes/*/permissions_config.toml nodes/*/static-nodes.json
echo "  $KEYS"

if [ "$MODE" = "--keys-only" ]; then
  echo "Done (keys only)."
  exit 0
fi

# Block until a validator reports all its peers again, or give up after ~2 minutes.
wait_for_peers() {
  local port="$1"
  node -e '
    const port = process.argv[1];
    const deadline = Date.now() + 120000;
    (async function poll() {
      try {
        const r = await fetch("http://127.0.0.1:" + port, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "net_peerCount", params: [] }),
          signal: AbortSignal.timeout(5000),
        });
        const j = await r.json();
        if (j.result && parseInt(j.result, 16) >= 3) process.exit(0);
      } catch {}
      if (Date.now() > deadline) process.exit(1);
      setTimeout(poll, 2000);
    })();
  ' "$port"
}

# Wait for every validator to be healthy before starting, so we never begin with one already down.
for i in 0 1 2 3; do
  if ! wait_for_peers "${PORTS[$i]}"; then
    echo "node$((i + 1)) is not healthy (port ${PORTS[$i]}). Not stopping anything. Fix that first." >&2
    exit 1
  fi
done

for n in 4 3 2 1; do
  echo "Archiving node$n (stopping it for a moment; the other three keep the chain running)..."
  docker compose stop "node$n"
  tar czf "$DEST/sabha-node$n-$STAMP.tgz" -C nodes "node$n" || {
    # Whatever went wrong with the archive, never leave a validator stopped.
    docker compose start "node$n"
    echo "Archiving node$n failed; it has been started again." >&2
    exit 1
  }
  docker compose start "node$n"
  if ! wait_for_peers "${PORTS[$((n - 1))]}"; then
    echo "node$n did not rejoin within two minutes. Stopping here so a second validator is not taken down." >&2
    echo "Check: docker compose logs node$n" >&2
    exit 1
  fi
  echo "  $DEST/sabha-node$n-$STAMP.tgz  (rejoined)"
done

echo "Done. Now copy $DEST off this machine."
