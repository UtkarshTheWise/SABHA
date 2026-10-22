#!/usr/bin/env bash
#
# Generates the four-validator QBFT network: keys, genesis block and peer list.
# Needs Docker. Safe to re-run; it wipes the previous network first.
#
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="hyperledger/besu:24.12.2"

echo "Clearing any previous network..."
rm -rf networkFiles nodes genesis.json static-nodes.json

echo "Generating validator keys and genesis block with the Besu operator tool..."
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PWD":/data \
  "$IMAGE" \
  operator generate-blockchain-config \
  --config-file=/data/qbft-config.json \
  --to=/data/networkFiles \
  --private-key-file-name=key

echo "Arranging node directories..."
node arrange.mjs

echo
echo "Network files are ready. Start the validators with:"
echo "  cd besu && docker compose up -d"
