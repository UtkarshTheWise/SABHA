import { addChainParams, chainIdHex, orderNetworks, withRpcOverride } from "./networkParams";

export * from "./networkParams";

// One file per network, written by `npm run deploy` / `npm run publish:frontend`.
// A fresh clone may have none: the interface says so rather than crashing.
const files = import.meta.glob("../chain/networks/*.json", { eager: true, import: "default" });

export const NETWORKS = orderNetworks(
  Object.values(files).map((network) => withRpcOverride(network, import.meta.env)),
  { dev: import.meta.env.DEV }
);

const STORAGE_KEY = "sabha.network";

// Browser storage can throw (private windows, blocked cookies); a remembered
// choice is a convenience, never something the page depends on.
function remembered() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberNetwork(key) {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* fine */
  }
}

/** ?network=sepolia in the link wins, then the last choice, then the build's default. */
export function initialNetwork() {
  const asked = new URLSearchParams(window.location.search).get("network");
  const wanted = asked || remembered() || import.meta.env.VITE_DEFAULT_NETWORK;
  return NETWORKS.find((n) => n.key === wanted) || NETWORKS[0] || null;
}

// --- the member's wallet ------------------------------------------------------

export async function addToWallet(ethereum, network) {
  await ethereum.request({ method: "wallet_addEthereumChain", params: [addChainParams(network)] });
}

/** Ask the wallet to move to `network`, adding it first if the wallet has never heard of it. */
export async function switchWallet(ethereum, network) {
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex(network) }] });
  } catch (error) {
    const unknown = error?.code === 4902 || /unrecognized chain|not been added/i.test(error?.message || "");
    if (!unknown) throw error;
    await addToWallet(ethereum, network);
  }
}
