/**
 * Turning whatever a wallet, a node or a contract threw into something a member
 * can act on. `decodeError` returns a translation key and its parameters, never
 * English text, so the page says it in the member's language.
 *
 * Contract errors are decoded from the revert data against both ABIs. The data
 * hides in a different place depending on who threw (ethers, a wallet, a node,
 * the RPC gate), so `revertData` looks in all of them, and falls back to the
 * message text that Hardhat's own node writes.
 */
import { Interface } from "ethers";

import registryAbi from "../chain/abi/MemberRegistry.json" with { type: "json" };
import votingAbi from "../chain/abi/DirectDemocracy.json" with { type: "json" };

const contractErrors = new Interface([...votingAbi, ...registryAbi].filter((item) => item.type === "error"));
const STAGES = ["pending", "active", "closed", "finalised"];

/** Find revert data (0x…) wherever the thrower put it. */
export function revertData(error) {
  // Breadth first, so the shallowest revert data wins; bounded, so a cyclic or
  // enormous error object cannot hang the page.
  const seen = new Set();
  const queue = [[error, 0]];
  let visited = 0;
  while (queue.length && visited < 300) {
    const [item, depth] = queue.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    visited += 1;
    for (const key of ["data", "result", "returnData"]) {
      const value = item[key];
      if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) return value;
    }
    if (depth < 6) for (const value of Object.values(item)) if (value && typeof value === "object") queue.push([value, depth + 1]);
  }
  return null;
}

/** "reverted with custom error 'AlreadyVoted(5, \"0x…\")'" → { name, args } (Hardhat's own node writes this). */
function fromMessage(error) {
  const text = String(error?.message ?? error?.shortMessage ?? "");
  const match = /custom error '([A-Za-z0-9_]+)\(([^']*)\)'/.exec(text);
  if (!match) return null;
  return { name: match[1], args: match[2] ? match[2].split(/,\s*/).map((a) => a.replace(/^"|"$/g, "")) : [] };
}

function parseContractError(error) {
  if (error?.revert?.name) return { name: error.revert.name, args: [...(error.revert.args ?? [])] };
  const data = revertData(error);
  if (data) {
    try {
      const parsed = contractErrors.parseError(data);
      if (parsed) return { name: parsed.name, args: [...parsed.args] };
    } catch {
      /* not one of ours */
    }
  }
  return fromMessage(error);
}

const stage = (n) => STAGES[Number(n)] ?? "closed";
const text = (v) => (typeof v === "bigint" ? v.toString() : String(v));

/** Each contract error: which key to show and which of its arguments the sentence uses. */
const CONTRACT = {
  AlreadyVoted: (a) => ({ key: "errors.AlreadyVoted", params: { ballot: text(a[0]) } }),
  NotAMember: () => ({ key: "errors.NotAMember", params: {} }),
  VotingNotOpen: (a) => ({ key: `errors.VotingNotOpen.${stage(a[1])}`, params: { ballot: text(a[0]) } }),
  UnknownOption: () => ({ key: "errors.UnknownOption", params: {} }),
  UnknownProposal: (a) => ({ key: "errors.UnknownProposal", params: { ballot: text(a[0]) } }),
  VotingStillOpen: () => ({ key: "errors.VotingStillOpen", params: {} }),
  AlreadyFinalised: () => ({ key: "errors.AlreadyFinalised", params: {} }),
  ProposalIsCancelled: () => ({ key: "errors.ProposalIsCancelled", params: {} }),
  CannotCancelNow: () => ({ key: "errors.CannotCancelNow", params: {} }),
  NoReceipt: () => ({ key: "errors.NoReceipt", params: {} }),
  WindowInPast: () => ({ key: "errors.WindowInPast", params: {} }),
  WindowInverted: () => ({ key: "errors.WindowInverted", params: {} }),
  BadOptionCount: (a) => ({ key: "errors.BadOptionCount", params: { given: text(a[0]), min: 2, max: 16 } }),
  EmptyTitle: () => ({ key: "errors.EmptyTitle", params: {} }),
  QuorumTooHigh: () => ({ key: "errors.QuorumTooHigh", params: {} }),
  NoElectorate: () => ({ key: "errors.NoElectorate", params: {} }),
  AccessControlUnauthorizedAccount: () => ({ key: "errors.AccessControlUnauthorizedAccount", params: {} }),
  AccessControlBadConfirmation: () => ({ key: "errors.AccessControlBadConfirmation", params: {} }),
  AlreadyEnrolled: () => ({ key: "errors.AlreadyEnrolled", params: {} }),
  IdentifierAlreadyUsed: () => ({ key: "errors.IdentifierAlreadyUsed", params: {} }),
  NotEnrolled: () => ({ key: "errors.NotEnrolled", params: {} }),
  AlreadyActive: () => ({ key: "errors.AlreadyActive", params: {} }),
  AlreadySuspended: () => ({ key: "errors.AlreadySuspended", params: {} }),
  EmptyIdentifier: () => ({ key: "errors.EmptyIdentifier", params: {} }),
  LengthMismatch: () => ({ key: "errors.LengthMismatch", params: {} }),
};

function rpcCode(error) {
  for (const candidate of [error?.code, error?.error?.code, error?.info?.error?.code, error?.cause?.code]) {
    if (typeof candidate === "number") return candidate;
  }
  return null;
}

/**
 * @returns {{ kind: string, key: string, params: object, name?: string, technical: string }}
 *   kind: contract | wallet | funds | network | busy | unknown
 *   technical: the original message, for a "details" disclosure only
 */
export function decodeError(error) {
  const technical = String(error?.shortMessage || error?.message || error || "");

  // the member said no in their wallet
  if (error?.code === "ACTION_REJECTED" || rpcCode(error) === 4001 || /user (rejected|denied)/i.test(technical)) {
    return { kind: "wallet", key: "errors.walletRejected", params: {}, technical };
  }

  // a contract refused it
  const contract = parseContractError(error);
  if (contract && CONTRACT[contract.name]) {
    return { kind: "contract", name: contract.name, ...CONTRACT[contract.name](contract.args), technical };
  }

  // the public endpoint's own limits
  if (rpcCode(error) === -32005 || /too many requests|rate.?limit/i.test(technical)) {
    return { kind: "busy", key: "errors.rateLimited", params: {}, technical };
  }
  if (rpcCode(error) === -32601 && /not available on the public endpoint/i.test(technical)) {
    return { kind: "network", key: "errors.methodRefused", params: {}, technical };
  }

  // a network that charges for gas, and a wallet that holds none
  if (error?.code === "INSUFFICIENT_FUNDS" || /insufficient funds|doesn't have enough funds|have enough funds/i.test(technical)) {
    return { kind: "funds", key: "errors.noFunds", params: {}, technical };
  }

  if (error?.code === "NONCE_EXPIRED" || /nonce too low|nonce has already been used/i.test(technical)) {
    return { kind: "wallet", key: "errors.nonce", params: {}, technical };
  }
  if (error?.code === "REPLACEMENT_UNDERPRICED") return { kind: "wallet", key: "errors.pending", params: {}, technical };

  // a wallet on the wrong chain
  if (/chain ?id|network changed|unrecognized chain/i.test(technical) || error?.code === "NETWORK_ERROR") {
    return { kind: "network", key: "errors.wrongNetwork", params: {}, technical };
  }

  // reverted on chain with nothing we can name
  if (error?.code === "CALL_EXCEPTION" || /reverted|execution reverted/i.test(technical)) {
    return { kind: "contract", key: "errors.reverted", params: {}, technical };
  }

  if (error?.code === "TIMEOUT" || /timeout|timed out|failed to fetch|fetch failed|network error|ECONN|server response/i.test(technical)) {
    return { kind: "network", key: "errors.unreachable", params: {}, technical };
  }

  return { kind: "unknown", key: "errors.unknown", params: {}, technical };
}
