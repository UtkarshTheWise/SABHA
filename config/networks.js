/**
 * One table of networks, read by hardhat.config.js, the deploy scripts and the
 * code that generates the frontend's network files. Everything that varies
 * between machines comes from environment variables (see .env.example); nothing
 * here is a secret.
 *
 * Two RPC URLs per network, on purpose:
 *   - rpcUrl        what scripts use. May carry a provider API key, never
 *                   leaves this machine.
 *   - publicRpcUrl  what the browser uses. Written into the frontend build, so
 *                   it must be safe to publish.
 */
require("dotenv").config({ quiet: true });
const { HDNodeWallet } = require("ethers");

// The public Hardhat/Anvil mnemonic. Everyone on the internet has these keys:
// fine for a chain on your own laptop, never for anything hosted.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const ACCOUNT_COUNT = 20;

const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i;

const env = (name, fallback) => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
};

const isLocalUrl = (url) => LOCAL_URL.test(url || "");

/**
 * name         key used by --network and SABHA_NETWORK
 * rpcEnv       env var holding the URL scripts use
 * defaultRpc   fallback, only ever a local development node
 * publicRpcEnv env var holding the URL published to the browser
 * explorerEnv  env var holding the block explorer base URL (optional)
 * zeroGas      members never hold the native token; transactions go out at 0
 * logChunk     largest eth_getLogs block range the endpoint is expected to allow
 */
const NETWORKS = {
  localhost: {
    label: "Local node",
    chainId: 31337,
    rpcEnv: "LOCALHOST_RPC_URL",
    defaultRpc: "http://127.0.0.1:8545",
    publicRpcEnv: "PUBLIC_RPC_URL_LOCALHOST",
    explorerEnv: "EXPLORER_URL_LOCALHOST",
    zeroGas: false,
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    logChunk: 10000,
  },
  besu: {
    label: "Sabha network (Besu QBFT)",
    chainId: Number(env("BESU_CHAIN_ID", 1337)),
    rpcEnv: "BESU_RPC_URL",
    defaultRpc: "http://127.0.0.1:8545",
    publicRpcEnv: "PUBLIC_RPC_URL_BESU",
    explorerEnv: "EXPLORER_URL_BESU",
    zeroGas: true,
    currency: { name: "Sabha Gas", symbol: "SBH", decimals: 18 },
    logChunk: 5000,
  },
  sepolia: {
    label: "Sepolia testnet",
    chainId: 11155111,
    rpcEnv: "SEPOLIA_RPC_URL",
    defaultRpc: null, // no default: a public RPC is a choice the deployer makes
    publicRpcEnv: "PUBLIC_RPC_URL_SEPOLIA",
    explorerEnv: "EXPLORER_URL_SEPOLIA",
    zeroGas: false,
    currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    logChunk: 2000,
  },
};

/** The names a deployment record can be published under. */
const NETWORK_NAMES = Object.keys(NETWORKS);

function resolve(name) {
  const spec = NETWORKS[name];
  if (!spec) return null;

  const rpcUrl = env(spec.rpcEnv, spec.defaultRpc);
  let publicRpcUrl = env(spec.publicRpcEnv, null);
  // A local node is safe to publish as-is; a hosted one only when stated.
  if (!publicRpcUrl && rpcUrl && isLocalUrl(rpcUrl)) publicRpcUrl = rpcUrl;

  return {
    name,
    label: spec.label,
    chainId: spec.chainId,
    rpcUrl,
    publicRpcUrl,
    explorerUrl: (env(spec.explorerEnv, "") || "").replace(/\/+$/, "") || null,
    zeroGas: spec.zeroGas,
    currency: spec.currency,
    logChunk: spec.logChunk,
  };
}

const normaliseKey = (raw, source) => {
  const key = raw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    // Never echo the value: a malformed key is still somebody's key.
    throw new Error(`${source} is not a 32-byte hex private key.`);
  }
  return `0x${key}`;
};

function derivedKeys(mnemonic, from, to) {
  const keys = [];
  for (let i = from; i < to; i++) {
    keys.push(HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${i}`).privateKey);
  }
  return keys;
}

/**
 * Signers for a network.
 *
 *   DEPLOYER_PRIVATE_KEY  becomes signer 0 (the deployer and first officer).
 *   DEMO_MNEMONIC         supplies the remaining signers: officers, members and
 *                         the throwaway voters the demo needs.
 *
 * A network that is not on this machine never falls back to the public test
 * mnemonic. With nothing configured it gets no accounts at all, and deploy.js
 * stops with an explanation rather than deploying as a well-known address.
 */
function accountsFor(name) {
  const spec = NETWORKS[name];
  const rpcUrl = env(spec.rpcEnv, spec.defaultRpc);

  const legacy = name === "besu" ? env("BESU_PRIVATE_KEY", null) : null;
  const deployerRaw = env("DEPLOYER_PRIVATE_KEY", null) || legacy;
  const mnemonic = env("DEMO_MNEMONIC", null);

  if (deployerRaw) {
    const deployer = normaliseKey(deployerRaw, "DEPLOYER_PRIVATE_KEY");
    return [deployer, ...(mnemonic ? derivedKeys(mnemonic, 1, ACCOUNT_COUNT) : [])];
  }
  if (mnemonic) return { mnemonic, count: ACCOUNT_COUNT };
  if (isLocalUrl(rpcUrl)) return { mnemonic: TEST_MNEMONIC, count: ACCOUNT_COUNT };
  return [];
}

/** The `networks` block for hardhat.config.js. */
function hardhatNetworks() {
  const networks = {
    // In-process chain used by `hardhat test` and the CI demo run.
    hardhat: { accounts: { mnemonic: TEST_MNEMONIC, count: ACCOUNT_COUNT } },
  };

  for (const name of NETWORK_NAMES) {
    const net = resolve(name);
    // Hardhat refuses a network with no URL, so an unconfigured hosted network
    // is left out; scripts/hh.js explains what to set.
    if (!net.rpcUrl) continue;
    networks[name] = {
      url: net.rpcUrl,
      chainId: net.chainId,
      accounts: accountsFor(name),
      ...(net.zeroGas ? { gasPrice: 0 } : {}),
    };
  }
  return networks;
}

/** Throws with a plain explanation if `name` cannot be used from this machine. */
function assertUsable(name) {
  if (name === "hardhat") return;
  const spec = NETWORKS[name];
  if (!spec) {
    throw new Error(`Unknown network "${name}". Known networks: hardhat, ${NETWORK_NAMES.join(", ")}.`);
  }
  const net = resolve(name);
  if (!net.rpcUrl) {
    throw new Error(`Network "${name}" has no RPC URL. Set ${spec.rpcEnv} in .env (see .env.example).`);
  }
  const accounts = accountsFor(name);
  const empty = Array.isArray(accounts) ? accounts.length === 0 : false;
  if (empty) {
    throw new Error(
      `Network "${name}" is not on this machine and no signing key is configured.\n` +
        `Set DEPLOYER_PRIVATE_KEY (and DEMO_MNEMONIC for the demo) in .env. The public test mnemonic is deliberately not used here.`
    );
  }
}

module.exports = {
  NETWORKS,
  NETWORK_NAMES,
  TEST_MNEMONIC,
  ACCOUNT_COUNT,
  env,
  isLocalUrl,
  resolve,
  accountsFor,
  hardhatNetworks,
  assertUsable,
};
