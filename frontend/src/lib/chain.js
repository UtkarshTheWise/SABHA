import { BrowserProvider, Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";

import registryAbi from "../chain/abi/MemberRegistry.json";
import votingAbi from "../chain/abi/DirectDemocracy.json";
import { feeOverrides } from "./networkParams";
import { switchWallet } from "./networks";

export const STATE = ["Pending", "Active", "Closed", "Decided"];

/**
 * Two ways in.
 *
 * "node" talks straight to an unlocked development node and signs with one of
 * its accounts, which is what makes a classroom demonstration possible without
 * eight browser profiles. It exists only on the local network. "wallet" uses a
 * browser wallet and is what a real deployment uses.
 */
export function readProvider(network) {
  // ethers folds calls made within a few milliseconds into one HTTP request, up
  // to 100 at a time by default. The public gateway accepts 20, so stay well
  // under it. The chain id is known, so there is no need to ask for it again.
  return new JsonRpcProvider(network.rpcUrl, network.chainId, { staticNetwork: true, batchMaxCount: 10 });
}

export async function nodeAccounts(provider) {
  return provider.send("eth_accounts", []);
}

/**
 * Connect the browser wallet, moving it to `network` first if it is elsewhere.
 * Returns a signer whose transactions carry the network's fee settings.
 */
export async function walletSigner(network) {
  if (!window.ethereum) {
    throw new Error("No browser wallet found. Open this page in your wallet app's browser, or install a wallet.");
  }
  let provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);

  const current = parseInt(await provider.send("eth_chainId", []), 16);
  if (current !== network.chainId) {
    await switchWallet(window.ethereum, network);
    // ethers remembers the network it first saw and refuses a changed one.
    provider = new BrowserProvider(window.ethereum);
  }

  const signer = await provider.getSigner();
  const fees = feeOverrides(network);
  if (Object.keys(fees).length > 0) {
    const send = signer.sendTransaction.bind(signer);
    signer.sendTransaction = (transaction) => send({ ...transaction, ...fees });
  }
  return signer;
}

export function contracts(runner, network) {
  return {
    registry: new Contract(network.contracts.MemberRegistry.address, registryAbi, runner),
    voting: new Contract(network.contracts.DirectDemocracy.address, votingAbi, runner),
  };
}

export const identifierHash = (value) => keccak256(toUtf8Bytes(value.trim()));

export const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function countdown(closesAt, now = Math.floor(Date.now() / 1000)) {
  let seconds = Number(closesAt) - now;
  if (seconds <= 0) return "closed";

  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);

  if (days > 0) return `closes in ${days}d ${hours}h`;
  if (hours > 0) return `closes in ${hours}h ${minutes}m`;
  if (minutes > 0) return `closes in ${minutes}m`;
  return "closes in under a minute";
}

/** Turn a revert into something a member can act on. */
export function explain(error) {
  const name = error?.revert?.name || error?.info?.error?.data?.name;
  const messages = {
    AlreadyVoted: "You have already been counted on this ballot.",
    NotAMember: "This wallet is not on the member roster.",
    VotingNotOpen: "Voting is not open on this ballot right now.",
    UnknownOption: "That option is not on this ballot.",
    VotingStillOpen: "The window has not closed yet.",
    AlreadyFinalised: "This ballot has already been counted.",
    AlreadyEnrolled: "That wallet is already on the roster.",
    IdentifierAlreadyUsed: "That registration number is already linked to another wallet.",
    AccessControlUnauthorizedAccount: "This wallet does not hold the role that action needs.",
    NoElectorate: "Enrol at least one member before opening a ballot.",
    WindowInPast: "Pick a closing time in the future.",
    WindowInverted: "The ballot cannot close before it opens.",
  };
  if (name && messages[name]) return messages[name];
  if (error?.code === "ACTION_REJECTED") return "You cancelled the transaction in your wallet.";
  return error?.shortMessage || error?.message || "The transaction failed.";
}
