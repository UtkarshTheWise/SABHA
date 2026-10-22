import { BrowserProvider, Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";

import deployment from "../chain/deployment.json";
import registryAbi from "../chain/MemberRegistry.abi.json";
import votingAbi from "../chain/DirectDemocracy.abi.json";

export const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
export const addresses = deployment.contracts;
export const deploymentInfo = deployment;

export const STATE = ["Pending", "Active", "Closed", "Decided"];

/**
 * Two ways in.
 *
 * "node" talks straight to an unlocked development node and signs with one of
 * its accounts, which is what makes a classroom demonstration possible without
 * eight browser profiles. "wallet" uses MetaMask and is what a real deployment
 * would use.
 */
export function readProvider() {
  return new JsonRpcProvider(RPC_URL);
}

export async function nodeAccounts(provider) {
  return provider.send("eth_accounts", []);
}

export async function walletProvider() {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or use node mode.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  return provider;
}

export function contracts(runner) {
  return {
    registry: new Contract(addresses.MemberRegistry.address, registryAbi, runner),
    voting: new Contract(addresses.DirectDemocracy.address, votingAbi, runner),
  };
}

export const identifierHash = (value) => keccak256(toUtf8Bytes(value.trim()));

export const short = (address) => `${address.slice(0, 6)}\u2026${address.slice(-4)}`;

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
