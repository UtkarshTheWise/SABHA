/**
 * Fills the environment-specific values into qbft-config.json and writes the
 * file Besu's operator tool reads (.qbft-config.generated.json, git-ignored).
 *
 * The template holds everything that is the same on every deployment. Only the
 * chain id and the idle block period vary, and both come from besu/.env.
 *
 * Run through setup.sh, not directly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const chainId = Number(process.env.BESU_CHAIN_ID);
if (!Number.isInteger(chainId) || chainId <= 0) {
  console.error("BESU_CHAIN_ID must be a positive integer (set it in besu/.env).");
  process.exit(1);
}

const emptyBlockSeconds = Number(process.env.BESU_EMPTY_BLOCK_SECONDS ?? 0);
if (!Number.isInteger(emptyBlockSeconds) || emptyBlockSeconds < 0) {
  console.error("BESU_EMPTY_BLOCK_SECONDS must be 0 or a positive integer.");
  process.exit(1);
}

const template = JSON.parse(readFileSync(join(HERE, "qbft-config.json"), "utf8"));
const config = template.genesis.config;

config.chainId = chainId;
if (emptyBlockSeconds > 0) {
  config.qbft.emptyblockperiodseconds = emptyBlockSeconds;
} else {
  delete config.qbft.emptyblockperiodseconds;
}

writeFileSync(join(HERE, ".qbft-config.generated.json"), `${JSON.stringify(template, null, 2)}\n`);
console.log(
  `chain id ${chainId}, block every ${config.qbft.blockperiodseconds}s with transactions, ` +
    (emptyBlockSeconds > 0 ? `every ${emptyBlockSeconds}s when idle` : "every block period when idle")
);
