/**
 * What a QBFT block header says about the consensus that produced it. Besu keeps
 * the validator set in the header's extraData, so the page can show who the
 * validators are without calling the qbft_* methods, which the public endpoint
 * (rightly) does not serve.
 *
 * The whole of extraData is one RLP list (checked against a real header from a
 * four-validator Besu 26.10.1 network):
 *
 *   [ vanity (32 bytes), validators[], vote, round, committedSeals[] ]
 *
 * Besu writes its own version into the vanity ("besu 26.10.1"), and a block's
 * `miner` field is the validator that proposed it.
 */
import { decodeRlp, getAddress, getBytes, hexlify } from "ethers";

export function decodeQbftExtraData(extraData) {
  let list;
  try {
    list = decodeRlp(hexlify(getBytes(extraData)));
  } catch {
    throw new Error("extraData is not RLP, so it is not a QBFT header");
  }
  if (!Array.isArray(list) || list.length < 5 || !Array.isArray(list[1])) {
    throw new Error("extraData is not a QBFT validator list");
  }

  const [vanity, validators, , round, seals] = list;
  return {
    // printable bytes only, so a binary vanity shows as nothing rather than noise
    client: vanityText(vanity),
    validators: validators.map((address) => getAddress(address)),
    round: typeof round === "string" && round !== "0x" ? parseInt(round, 16) : 0,
    sealCount: Array.isArray(seals) ? seals.length : 0,
  };
}

function vanityText(hex) {
  if (typeof hex !== "string") return "";
  const bytes = getBytes(hex);
  return Array.from(bytes)
    .filter((b) => b >= 0x20 && b < 0x7f)
    .map((b) => String.fromCharCode(b))
    .join("")
    .trim();
}

/** Average seconds between blocks over a run of {number, timestamp}, oldest or newest first. */
export function averageBlockTime(blocks) {
  if (blocks.length < 2) return null;
  const sorted = [...blocks].sort((a, b) => a.number - b.number);
  const span = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
  return span / (sorted.length - 1);
}

/** How many of the last blocks each address proposed, most active first. */
export function proposerCounts(blocks) {
  const counts = new Map();
  for (const { miner } of blocks) {
    if (!miner) continue;
    counts.set(miner, (counts.get(miner) ?? 0) + 1);
  }
  return [...counts.entries()].map(([address, count]) => ({ address, count })).sort((a, b) => b.count - a.count);
}
