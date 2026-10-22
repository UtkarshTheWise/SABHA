/**
 * Takes the output of `besu operator generate-blockchain-config` and arranges
 * it into the directory layout docker-compose expects: one data directory per
 * validator, each holding its own private key, the same peer list and the same
 * node allowlist.
 *
 * Run through setup.sh, not directly.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NETWORK_FILES = join(HERE, "networkFiles");
const NODES_DIR = join(HERE, "nodes");

// Where each validator is reachable by its peers, as host or host:port. The
// default matches the fixed addresses in docker-compose.yml. Override it to
// place validators on different machines, e.g. one per office bearer.
const DEFAULT_HOSTS = ["172.28.0.11", "172.28.0.12", "172.28.0.13", "172.28.0.14"];
const DEFAULT_P2P_PORT = 30303;
const hosts = (process.env.BESU_VALIDATOR_HOSTS
  ? process.env.BESU_VALIDATOR_HOSTS.split(",").map((h) => h.trim())
  : DEFAULT_HOSTS
).map((h) => (h.includes(":") ? h : `${h}:${DEFAULT_P2P_PORT}`));

if (!existsSync(NETWORK_FILES)) {
  console.error("No networkFiles directory. Run setup.sh, which generates it with the Besu operator tool.");
  process.exit(1);
}

const keyDirs = readdirSync(join(NETWORK_FILES, "keys")).sort();
if (keyDirs.length !== hosts.length) {
  console.error(`Expected ${hosts.length} validator key directories, found ${keyDirs.length}.`);
  process.exit(1);
}

// The enode id is the node's public key with the 0x stripped.
const enodes = keyDirs.map((dir, i) => {
  const pub = readFileSync(join(NETWORK_FILES, "keys", dir, "key.pub"), "utf8").trim().replace(/^0x/, "");
  return `enode://${pub}@${hosts[i]}`;
});

// Node permissioning: a node outside this list cannot connect to the network,
// whatever it claims. It is the network-layer counterpart of the member roster.
const allowlist = `nodes-allowlist=[\n${enodes.map((e) => `  "${e}"`).join(",\n")}\n]\n`;

keyDirs.forEach((dir, i) => {
  const nodeDir = join(NODES_DIR, `node${i + 1}`);
  mkdirSync(nodeDir, { recursive: true });
  copyFileSync(join(NETWORK_FILES, "keys", dir, "key"), join(nodeDir, "key"));
  copyFileSync(join(NETWORK_FILES, "keys", dir, "key.pub"), join(nodeDir, "key.pub"));
  writeFileSync(join(nodeDir, "static-nodes.json"), `${JSON.stringify(enodes, null, 2)}\n`);
  writeFileSync(join(nodeDir, "permissions_config.toml"), allowlist);
  console.log(`node${i + 1}  validator ${dir}  ${hosts[i]}`);
});

copyFileSync(join(NETWORK_FILES, "genesis.json"), join(HERE, "genesis.json"));
writeFileSync(join(HERE, "static-nodes.json"), `${JSON.stringify(enodes, null, 2)}\n`);

console.log(`\ngenesis.json, static-nodes.json and the node allowlist written. ${enodes.length} validators ready.`);
console.log("Next: docker compose up -d");
