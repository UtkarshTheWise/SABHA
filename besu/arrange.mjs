/**
 * Takes the output of `besu operator generate-blockchain-config` and arranges
 * it into the directory layout docker-compose expects: one data directory per
 * validator, each holding its own private key and the same peer list.
 *
 * Run through setup.sh, not directly.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NETWORK_FILES = join(HERE, "networkFiles");
const NODES_DIR = join(HERE, "nodes");

// Must match the addresses in docker-compose.yml.
const IPS = ["172.28.0.11", "172.28.0.12", "172.28.0.13", "172.28.0.14"];
const P2P_PORT = 30303;

if (!existsSync(NETWORK_FILES)) {
  console.error("No networkFiles directory. Run setup.sh, which generates it with the Besu operator tool.");
  process.exit(1);
}

const keyDirs = readdirSync(join(NETWORK_FILES, "keys")).sort();
if (keyDirs.length !== IPS.length) {
  console.error(`Expected ${IPS.length} validator key directories, found ${keyDirs.length}.`);
  process.exit(1);
}

// The enode id is the node's public key with the 0x stripped.
const enodes = keyDirs.map((dir, i) => {
  const pub = readFileSync(join(NETWORK_FILES, "keys", dir, "key.pub"), "utf8").trim().replace(/^0x/, "");
  return `enode://${pub}@${IPS[i]}:${P2P_PORT}`;
});

keyDirs.forEach((dir, i) => {
  const nodeDir = join(NODES_DIR, `node${i + 1}`);
  mkdirSync(nodeDir, { recursive: true });
  copyFileSync(join(NETWORK_FILES, "keys", dir, "key"), join(nodeDir, "key"));
  copyFileSync(join(NETWORK_FILES, "keys", dir, "key.pub"), join(nodeDir, "key.pub"));
  writeFileSync(join(nodeDir, "static-nodes.json"), `${JSON.stringify(enodes, null, 2)}\n`);
  console.log(`node${i + 1}  validator ${dir}  ${IPS[i]}`);
});

copyFileSync(join(NETWORK_FILES, "genesis.json"), join(HERE, "genesis.json"));
writeFileSync(join(HERE, "static-nodes.json"), `${JSON.stringify(enodes, null, 2)}\n`);

console.log(`\ngenesis.json and static-nodes.json written. ${enodes.length} validators ready.`);
console.log("Next: docker compose up -d");
