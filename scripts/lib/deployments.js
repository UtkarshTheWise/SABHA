const fs = require("fs");
const path = require("path");
const { resolve: resolveNetwork, env } = require("../../config/networks");

const ROOT = path.resolve(__dirname, "..", "..");

// Contracts whose ABI the frontend needs.
const CONTRACTS = ["MemberRegistry", "DirectDemocracy"];

// Read at call time so tests can point these somewhere disposable.
const deploymentsDir = () => (env("SABHA_DEPLOYMENTS_DIR") ? path.resolve(env("SABHA_DEPLOYMENTS_DIR")) : path.join(ROOT, "deployments"));
const chainDir = () => (env("SABHA_CHAIN_DIR") ? path.resolve(env("SABHA_CHAIN_DIR")) : path.join(ROOT, "frontend", "src", "chain"));

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
};

function recordPath(networkName) {
  return path.join(deploymentsDir(), `${networkName}.json`);
}

function save(networkName, record) {
  return writeJson(recordPath(networkName), record);
}

function load(networkName) {
  const file = recordPath(networkName);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No deployment found for network "${networkName}". Run: SABHA_NETWORK=${networkName} npm run deploy`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * ABIs are the same on every network, so they are written once, and committed:
 * a fresh clone can build the frontend without compiling anything.
 */
function publishAbis(hre) {
  const dir = path.join(chainDir(), "abi");
  for (const name of CONTRACTS) {
    writeJson(path.join(dir, `${name}.json`), hre.artifacts.readArtifactSync(name).abi);
  }
  return dir;
}

/**
 * What the browser is told about one network. Everything in here ends up in a
 * public JavaScript bundle, so it is built from an allowlist of fields and then
 * checked against the secrets in this process's environment.
 */
function networkFile(networkName, record) {
  const net = resolveNetwork(networkName);
  if (!net) throw new Error(`"${networkName}" is not a network the frontend can use.`);
  if (!net.publicRpcUrl) {
    throw new Error(
      `No public RPC URL for "${networkName}". Set PUBLIC_RPC_URL_${networkName.toUpperCase()} in .env: ` +
        `the browser needs an address it can reach, and the URL scripts use may carry an API key.`
    );
  }

  const file = {
    key: networkName,
    label: net.label,
    chainId: record.chainId ?? net.chainId,
    rpcUrl: net.publicRpcUrl,
    explorerUrl: net.explorerUrl,
    zeroGas: net.zeroGas,
    currency: net.currency,
    logChunk: net.logChunk,
    deployedAt: record.deployedAt,
    admin: record.admin,
    contracts: record.contracts,
  };

  // Belt and braces: nothing secret may ride along, whatever got put in `record`.
  const text = JSON.stringify(file);
  const secrets = [env("DEPLOYER_PRIVATE_KEY"), env("BESU_PRIVATE_KEY"), env("DEMO_MNEMONIC"), env("ETHERSCAN_API_KEY")];
  if (net.rpcUrl && net.rpcUrl !== net.publicRpcUrl) secrets.push(net.rpcUrl);
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && text.includes(secret.replace(/^0x/i, ""))) {
      throw new Error(`Refusing to publish "${networkName}": its frontend file would contain a secret from .env.`);
    }
  }
  return file;
}

/** Writes the shared ABIs and this network's file into the frontend. */
function publishToFrontend(hre, networkName, record) {
  const file = networkFile(networkName, record); // validate before writing anything
  publishAbis(hre);
  writeJson(path.join(chainDir(), "networks", `${networkName}.json`), file);
  return chainDir();
}

/**
 * The off-chain register of names against addresses, for the local demo only.
 * It holds registration numbers, which the README promises never leave the
 * society's own machine, so it is never written for a hosted network and the
 * frontend bundle never includes it.
 */
function saveDirectory(networkName, entries) {
  if (networkName !== "localhost") return null;
  return writeJson(path.join(chainDir(), "directory.json"), entries);
}

module.exports = {
  CONTRACTS,
  save,
  load,
  publishAbis,
  networkFile,
  publishToFrontend,
  saveDirectory,
  deploymentsDir,
  chainDir,
};
