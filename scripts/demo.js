/**
 * Walks the nine-step workflow from the design document against a live chain
 * and prints the transaction hash, block number and gas for every write, so the
 * demonstration is auditable rather than narrated.
 *
 *   npx hardhat run scripts/demo.js --network localhost
 */
const hre = require("hardhat");
const { resolve: resolveNetwork } = require("../config/networks");
const { load } = require("./lib/deployments");
const { deployContracts, seedChain } = require("./lib/bootstrap");
const { ensureFunded } = require("./lib/funding");
const { estimating } = require("./lib/estimating");

const line = (n) => console.log("\u2500".repeat(n));

function step(n, text) {
  console.log("");
  line(72);
  console.log(`STEP ${n}  ${text}`);
  line(72);
}

async function report(label, txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`  ${label}`);
  console.log(`    tx ${receipt.hash}`);
  console.log(`    block ${receipt.blockNumber}   gas ${receipt.gasUsed}   status ${receipt.status === 1 ? "confirmed" : "failed"}`);
  return receipt;
}

async function expectRejection(label, promise) {
  try {
    const tx = await promise;
    await tx.wait();
    console.log(`  ${label}\n    UNEXPECTED: the transaction went through`);
    process.exitCode = 1;
  } catch (error) {
    const reason = error.shortMessage || error.message.split("\n")[0];
    console.log(`  ${label}`);
    console.log(`    rejected: ${reason}`);
  }
}

async function timeTravel(provider, seconds) {
  try {
    await provider.send("evm_increaseTime", [seconds]);
    await provider.send("evm_mine", []);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { ethers, network } = hre;
  // The in-process network starts empty and is gone when this script exits (that
  // is what CI runs), so deploy and seed inside it first. Every other network
  // must already have been deployed and seeded with `npm run deploy` and `seed`.
  let record;
  if (network.name === "hardhat") {
    record = await deployContracts(hre, { log: () => {} });
    await seedChain(hre, record, { log: () => {} });
    console.log("(in-process chain: deployed and seeded just now)");
  } else {
    record = load(network.name);
  }
  const signers = await ethers.getSigners();
  const admin = signers[0];

  const registry = await ethers.getContractAt("MemberRegistry", record.contracts.MemberRegistry.address, admin);
  const voting = await ethers.getContractAt("DirectDemocracy", record.contracts.DirectDemocracy.address, admin);

  const chain = await ethers.provider.getNetwork();

  step(0, "Network and contracts");
  console.log(`  chain id         ${chain.chainId}`);
  console.log(`  rpc              ${network.config.url || "in-process"}`);
  console.log(`  block height     ${await ethers.provider.getBlockNumber()}`);
  console.log(`  MemberRegistry   ${await registry.getAddress()}`);
  console.log(`  DirectDemocracy  ${await voting.getAddress()}`);
  console.log(`  electorate       ${await registry.activeMemberCount()} active members`);

  // A network that charges for gas needs each transaction to carry its own gas
  // limit, or Hardhat's fallback asks wallets to hold far more than a vote costs.
  const known = resolveNetwork(network.name);
  const charges = Boolean(known && !known.zeroGas);
  const forSending = (signer) => (charges && signer ? estimating(signer) : signer);

  const roster = await registry.roster();
  if (roster.length < 5) {
    throw new Error("Run scripts/seed.js first: this demo needs at least five enrolled members.");
  }
  const found = roster.slice(0, 5).map((address) => signers.find((s) => s.address === address));
  if (found.some((v) => v === undefined)) {
    throw new Error("The enrolled members are not signers on this node. Re-run scripts/seed.js.");
  }
  const voters = found.map(forSending);
  const outsider = forSending(signers.find((s) => !roster.includes(s.address) && s.address !== admin.address));

  // --- funding (public testnets only) -----------------------------------------
  // Where gas is free, or every account already holds plenty, this does nothing.
  if (charges) {
    const funded = await ensureFunded(ethers, admin, voters, {
      minimum: ethers.parseEther("0.003"),
      amount: ethers.parseEther("0.005"),
    });
    if (funded.length > 0) {
      step("0+", "The deployer tops up the voters' wallets, since a public testnet charges for gas");
      for (const { address, receipt } of funded) {
        console.log(`  ${address}`);
        console.log(`    tx ${receipt.hash}  block ${receipt.blockNumber}  gas ${receipt.gasUsed}`);
      }
    }
  }

  // --- 1 ------------------------------------------------------------------
  // The window must outlast the votes. Five votes take seconds on a local node
  // and a minute or two on a public testnet, so the default is generous; CI sets
  // it lower.
  const WINDOW = Number(process.env.DEMO_WINDOW_SECONDS || 300);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const opensAt = now + 2;
  const closesAt = now + WINDOW;

  step(1, "An officer opens a question through the proposal registry");
  console.log(`  proposer   ${admin.address}`);
  console.log(`  window     opens ${new Date(opensAt * 1000).toISOString()}  closes ${new Date(closesAt * 1000).toISOString()}`);
  await report(
    "createProposal",
    voting.createProposal(
      "Should the society publish its accounts every term?",
      "Currently accounts are published once a year, after the audit. The proposal is to publish an unaudited summary at the end of every term as well.",
      ["Publish every term", "Keep the annual cycle", "Abstain"],
      opensAt,
      closesAt,
      6000
    )
  );

  const id = Number(await voting.proposalCount()) - 1;

  // --- 2 ------------------------------------------------------------------
  step(2, "The proposal is readable from the ledger by anyone on the network");
  const published = await voting.connect(voters[0]).getProposal(id);
  console.log(`  id ${published.id}   "${published.title}"`);
  console.log(`  options    ${published.options.join(" | ")}`);
  console.log(`  electorate ${published.electorate} snapshotted at creation`);
  console.log(`  quorum     ${Number(published.quorumBps) / 100}% of the electorate`);
  console.log(`  state      ${["Pending", "Active", "Closed", "Finalised"][Number(published.state)]}`);

  // --- 3 ------------------------------------------------------------------
  step(3, "The identity layer decides who may vote");
  for (const voter of voters.slice(0, 2)) {
    console.log(`  ${voter.address}  active member: ${await registry.isActiveMember(voter.address)}`);
  }
  console.log(`  ${outsider.address}  active member: ${await registry.isActiveMember(outsider.address)}`);

  // --- 4 and 5 ------------------------------------------------------------
  await timeTravel(ethers.provider, 5);
  step("4+5", "Members submit signed votes; the contract runs its three checks");
  const choices = [0, 0, 1, 0, 2];
  for (let i = 0; i < voters.length; i++) {
    await report(
      `${voters[i].address} votes "${published.options[choices[i]]}"`,
      voting.connect(voters[i]).castVote(id, choices[i])
    );
  }

  console.log("\n  Checks the contract refuses to skip:");
  await expectRejection("the same member votes twice", voting.connect(voters[0]).castVote(id, 1));
  await expectRejection("a wallet that is not on the roster votes", voting.connect(outsider).castVote(id, 0));
  const spare = forSending(signers.find((s) => roster.slice(voters.length).includes(s.address)));
  await expectRejection("a member picks an option that does not exist", voting.connect(spare).castVote(id, 9));

  // --- 6 and 7 ------------------------------------------------------------
  step("6+7", "Votes are committed to blocks and are independently verifiable");
  const receipt = await voting.receiptOf(id, voters[0].address);
  console.log(`  receipt for ${voters[0].address}`);
  console.log(`    option ${receipt.option} "${published.options[Number(receipt.option)]}"  recorded in block ${receipt.blockNumber}`);
  console.log(`    digest ${await voting.receiptHash(id, voters[0].address)}`);
  console.log(`  running tally  ${(await voting.tallyOf(id)).join(" / ")}`);

  // --- 8 ------------------------------------------------------------------
  step(8, "The window closes and the tally is published on chain");
  const travelled = await timeTravel(ethers.provider, WINDOW + 100);
  if (!travelled) {
    console.log("  This chain has no time-travel RPC. Waiting for the window to close in real time.");
    while ((await ethers.provider.getBlock("latest")).timestamp < closesAt) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  await report("finaliseProposal (called by a member, not an officer)", voting.connect(voters[1]).finaliseProposal(id));

  const final = await voting.getProposal(id);
  console.log(`\n  turnout      ${final.totalVotes} of ${final.electorate}`);
  console.log(`  quorum met   ${final.quorumMet}`);
  console.log(`  tied         ${final.tied}`);
  console.log(`  outcome      "${final.options[Number(final.winningOption)]}"`);
  console.log(`  tally        ${final.options.map((o, i) => `${o}: ${final.tally[i]}`).join(", ")}`);

  // --- 9 ------------------------------------------------------------------
  step(9, "An auditor rebuilds the same result from event logs alone");
  const logs = await voting.queryFilter(voting.filters.VoteCast(id));
  const rebuilt = new Array(final.options.length).fill(0);
  for (const log of logs) {
    rebuilt[Number(log.args.option)] += 1;
    console.log(`  block ${log.blockNumber}  ${log.args.voter}  option ${log.args.option}`);
  }
  const matches = rebuilt.every((count, i) => BigInt(count) === final.tally[i]);
  console.log(`\n  rebuilt from logs  ${rebuilt.join(" / ")}`);
  console.log(`  contract tally     ${final.tally.join(" / ")}`);
  console.log(`  independent recount agrees: ${matches}`);
  if (!matches) process.exitCode = 1;

  console.log("");
  line(72);
  console.log(`Demonstration finished at block ${await ethers.provider.getBlockNumber()}.`);
  line(72);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
