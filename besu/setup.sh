#!/usr/bin/env bash
#
# Generates the four-validator QBFT network: keys, genesis block, peer list and
# the node allowlist. Needs Docker and Node. Safe to re-run; it wipes the
# previous network first, which means a NEW CHAIN. Never run it on a network
# that holds real results unless you mean to start over.
#
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created besu/.env from .env.example. Review it, then re-run if you changed anything."
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${BESU_VERSION:?BESU_VERSION is not set in besu/.env}"
IMAGE="hyperledger/besu:${BESU_VERSION}"

if [ -d nodes ] && [ "${SABHA_CONFIRM_RESET:-}" != "yes" ] && [ -t 0 ]; then
  read -r -p "This deletes the existing network (keys and chain data). Type 'reset' to continue: " answer
  [ "$answer" = "reset" ] || { echo "Left the existing network alone."; exit 1; }
fi

echo "Clearing any previous network..."
rm -rf networkFiles nodes genesis.json static-nodes.json .qbft-config.generated.json

echo "Rendering the genesis config..."
node render-config.mjs

echo "Generating validator keys and genesis block with Besu ${BESU_VERSION}..."
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PWD":/data \
  "$IMAGE" \
  operator generate-blockchain-config \
  --config-file=/data/.qbft-config.generated.json \
  --to=/data/networkFiles \
  --private-key-file-name=key

echo "Arranging node directories..."
node arrange.mjs

echo
echo "Network files are ready. Start the validators with:"
echo "  cd besu && docker compose up -d"
