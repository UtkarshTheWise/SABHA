import { Contract, JsonRpcProvider, id, keccak256, toUtf8Bytes } from "ethers";

import registryAbi from "../chain/abi/MemberRegistry.json";
import votingAbi from "../chain/abi/DirectDemocracy.json";

export const ROLES = {
  registrar: id("REGISTRAR_ROLE"),
  proposer: id("PROPOSER_ROLE"),
  admin: "0x0000000000000000000000000000000000000000000000000000000000000000",
};

/**
 * Reads need no wallet and no account: any visitor's browser talks straight to
 * the network's public address. ethers folds calls made within a few
 * milliseconds into one HTTP request, up to 100 at a time by default; the public
 * gateway accepts 20, so stay well under it. The chain id is known, so there is
 * no need to ask for it again.
 */
export function readProvider(network) {
  return new JsonRpcProvider(network.rpcUrl, network.chainId, { staticNetwork: true, batchMaxCount: 10 });
}

export function contractsFor(runner, network) {
  return {
    registry: new Contract(network.contracts.MemberRegistry.address, registryAbi, runner),
    voting: new Contract(network.contracts.DirectDemocracy.address, votingAbi, runner),
  };
}

/** The contract returns BigInts and Result objects; the page wants plain numbers and arrays. */
export function normaliseBallot(p) {
  return {
    id: Number(p.id),
    title: p.title,
    description: p.description,
    options: [...p.options],
    tally: [...p.tally].map(Number),
    opensAt: Number(p.opensAt),
    closesAt: Number(p.closesAt),
    quorumBps: Number(p.quorumBps),
    electorate: Number(p.electorate),
    proposer: p.proposer,
    createdAt: Number(p.createdAt),
    cancelled: p.cancelled,
    finalised: p.finalised,
    quorumMet: p.quorumMet,
    tied: p.tied,
    winningOption: Number(p.winningOption),
    totalVotes: Number(p.totalVotes),
    state: Number(p.state),
  };
}

/** The hash an officer's register stores for a registration number: only this reaches the chain. */
export const identifierHash = (value) => keccak256(toUtf8Bytes(String(value).trim()));
