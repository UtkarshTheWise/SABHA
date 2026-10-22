/**
 * Pure helpers about a network description (the files in src/chain/networks).
 * No browser or Vite APIs, so the test suite can load this file directly.
 */

const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i;

export const isLocalUrl = (url) => LOCAL_URL.test(url || "");

/** Wallets want the chain id as hex with no leading zeros: 0x9f0d, 0x1. */
export const chainIdHex = (network) => `0x${Number(network.chainId).toString(16)}`;

/**
 * The argument to wallet_addEthereumChain. Wallets refuse plain-http RPC
 * addresses for anything but a local node, so say so here, in words, instead of
 * letting the wallet fail with its own message.
 */
export function addChainParams(network) {
  if (!network.rpcUrl) throw new Error(`${network.label} has no public RPC address configured.`);
  if (!/^https:\/\//i.test(network.rpcUrl) && !isLocalUrl(network.rpcUrl)) {
    throw new Error(`Wallets only accept an https address for ${network.label}, not ${network.rpcUrl}.`);
  }
  return {
    chainId: chainIdHex(network),
    chainName: network.label,
    nativeCurrency: network.currency,
    rpcUrls: [network.rpcUrl],
    ...(network.explorerUrl ? { blockExplorerUrls: [network.explorerUrl] } : {}),
  };
}

/** A link to a transaction on the network's explorer, or null if it has none. */
export function explorerTx(network, hash) {
  return network?.explorerUrl && hash ? `${network.explorerUrl}/tx/${hash}` : null;
}

export function explorerAddress(network, address) {
  return network?.explorerUrl && address ? `${network.explorerUrl}/address/${address}` : null;
}

/**
 * Members on a zero-gas network hold no currency, so a transaction has to say
 * so itself: a legacy transaction at gas price 0. Left to its defaults, a wallet
 * works out its own fee, finds the balance too small, and refuses to send.
 */
export function feeOverrides(network) {
  return network?.zeroGas ? { type: 0, gasPrice: 0n } : {};
}

/** Where polling is cheap, poll often; on a shared public endpoint, be gentle. */
export function pollInterval(network) {
  return isLocalUrl(network?.rpcUrl) ? 4000 : 12000;
}

/**
 * Hosted networks first for a visitor; the local node first for a developer
 * running `npm run frontend`, who deployed it a moment ago.
 */
export function orderNetworks(networks, { dev = false } = {}) {
  const order = dev ? ["localhost", "besu", "sepolia"] : ["besu", "sepolia", "localhost"];
  const rank = (n) => {
    const i = order.indexOf(n.key);
    return i === -1 ? order.length : i;
  };
  return [...networks].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}

/** Applies VITE_RPC_URL_<KEY> (and the older VITE_RPC_URL for localhost) over the baked-in address. */
export function withRpcOverride(network, env) {
  const specific = env[`VITE_RPC_URL_${network.key.toUpperCase()}`];
  const legacy = network.key === "localhost" ? env.VITE_RPC_URL : undefined;
  const override = specific || legacy;
  return override ? { ...network, rpcUrl: override } : network;
}
