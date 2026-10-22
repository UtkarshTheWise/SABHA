/**
 * The deploy and seed steps as functions, so the CLI scripts and the demo (which
 * can run a whole chain inside one process, for CI) share one implementation.
 */
const { resolve: resolveNetwork } = require("../../config/networks");

// The off-chain half of the identity layer. Names and registration numbers stay
// here, on the organisation's own machine; the chain only ever sees the hash.
const MEMBERS = [
  { name: "Aanya Tomar", identifier: "25BCE5384", signerIndex: 1 },
  { name: "Utkarsh Mishra", identifier: "25BCE1508", signerIndex: 2 },
  { name: "Rhea Nair", identifier: "25BCE2210", signerIndex: 3 },
  { name: "Kabir Sethi", identifier: "25BCE3471", signerIndex: 4 },
  { name: "Meera Iyer", identifier: "25BCE1092", signerIndex: 5 },
  { name: "Dev Malhotra", identifier: "25BCE6633", signerIndex: 6 },
  { name: "Sana Qureshi", identifier: "25BCE4417", signerIndex: 7 },
  { name: "Tanvi Rao", identifier: "25BCE7725", signerIndex: 8 },
];

const MINUTE = 60;
const DAY = 24 * 60 * 60;

/** Deploys both contracts and returns the record of where they went. Writes nothing to disk. */
async function deployContracts(hre, { log = console.log } = {}) {
  const { ethers, network } = hre;
  const [admin] = await ethers.getSigners();
  if (!admin) {
    throw new Error(
      `No signing key for "${network.name}". Set DEPLOYER_PRIVATE_KEY (and DEMO_MNEMONIC) in .env; see .env.example.`
    );
  }
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  log(`network      ${network.name} (chainId ${chainId})`);
  log(`admin        ${admin.address}`);
  const balance = await ethers.provider.getBalance(admin.address);
  log(`balance      ${ethers.formatEther(balance)} ETH\n`);

  // A network that charges for gas fails with an opaque "insufficient funds"
  // halfway through. Say what to do before sending anything.
  const known = resolveNetwork(network.name);
  if (known && !known.zeroGas && balance === 0n) {
    throw new Error(
      `${admin.address} has no ether on ${known.label}, so it cannot pay to deploy.\n` +
        `Send it some from a faucet (a deployment plus the demo needs roughly 0.05), then run this again.`
    );
  }

  const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
  await registry.waitForDeployment();
  const registryTx = registry.deploymentTransaction();
  const registryReceipt = await registryTx.wait();
  log(`MemberRegistry   ${await registry.getAddress()}`);
  log(`  tx ${registryTx.hash}  block ${registryReceipt.blockNumber}  gas ${registryReceipt.gasUsed}`);

  const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);
  await voting.waitForDeployment();
  const votingTx = voting.deploymentTransaction();
  const votingReceipt = await votingTx.wait();
  log(`DirectDemocracy  ${await voting.getAddress()}`);
  log(`  tx ${votingTx.hash}  block ${votingReceipt.blockNumber}  gas ${votingReceipt.gasUsed}\n`);

  return {
    chainId,
    deployedAt: new Date().toISOString(),
    admin: admin.address,
    contracts: {
      MemberRegistry: {
        address: await registry.getAddress(),
        txHash: registryTx.hash,
        block: registryReceipt.blockNumber,
      },
      DirectDemocracy: {
        address: await voting.getAddress(),
        txHash: votingTx.hash,
        block: votingReceipt.blockNumber,
      },
    },
  };
}

/**
 * Enrols the sample members and opens the sample ballots. Safe to run twice: it
 * skips whatever is already there. Returns the off-chain register of names.
 */
async function seedChain(hre, record, { log = console.log } = {}) {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  const admin = signers[0];

  const registry = await ethers.getContractAt("MemberRegistry", record.contracts.MemberRegistry.address, admin);
  const voting = await ethers.getContractAt("DirectDemocracy", record.contracts.DirectDemocracy.address, admin);

  // --- roster ------------------------------------------------------------
  const people = MEMBERS.map((m) => ({ ...m, address: signers[m.signerIndex].address }));
  const pending = [];
  for (const person of people) {
    if (await registry.isActiveMember(person.address)) continue;
    pending.push(person);
  }

  if (pending.length > 0) {
    const tx = await registry.enrolBatch(
      pending.map((p) => p.address),
      pending.map((p) => ethers.keccak256(ethers.toUtf8Bytes(p.identifier)))
    );
    const receipt = await tx.wait();
    log(`enrolled ${pending.length} members`);
    log(`  tx ${receipt.hash}  block ${receipt.blockNumber}  gas ${receipt.gasUsed}`);
  } else {
    log("roster already populated, skipping enrolment");
  }
  log(`electorate now ${await registry.activeMemberCount()}\n`);

  // --- proposals ---------------------------------------------------------
  const now = (await ethers.provider.getBlock("latest")).timestamp;

  const proposals = [
    {
      title: "Raise the annual society fee to Rs 500",
      description:
        "The fee has been Rs 300 since 2021 while venue and printing costs have gone up. The committee proposes Rs 500 from the next academic year, with the increase ring-fenced for events.",
      options: ["For", "Against", "Abstain"],
      opensAt: now + MINUTE,
      closesAt: now + 7 * DAY,
      quorumBps: 5000,
    },
    {
      title: "Pick the venue for the annual cultural night",
      description:
        "Three shortlisted venues, all within budget. Ranked by capacity: MG Auditorium 600, Anna Auditorium 400, Open Air Theatre 900 but weather dependent.",
      options: ["MG Auditorium", "Anna Auditorium", "Open Air Theatre"],
      opensAt: now + MINUTE,
      closesAt: now + 3 * DAY,
      quorumBps: 2500,
    },
    {
      title: "Move the general body meeting to Saturday mornings",
      description:
        "Attendance on Wednesday evenings has been under half. The proposal moves the meeting to 10am Saturday for one semester as a trial.",
      options: ["Move it", "Keep Wednesday"],
      opensAt: now + 2 * DAY,
      closesAt: now + 9 * DAY,
      quorumBps: 5000,
    },
  ];

  const existing = Number(await voting.proposalCount());
  if (existing > 0) {
    log(`${existing} proposals already on chain, skipping creation`);
  } else {
    for (const p of proposals) {
      const tx = await voting.createProposal(p.title, p.description, p.options, p.opensAt, p.closesAt, p.quorumBps);
      const receipt = await tx.wait();
      const id = Number(await voting.proposalCount()) - 1;
      log(`proposal #${id}  ${p.title}`);
      log(`  tx ${receipt.hash}  block ${receipt.blockNumber}  gas ${receipt.gasUsed}`);
    }
  }

  log(`\nproposals on chain: ${await voting.proposalCount()}`);
  log("seed complete");

  return people.map(({ name, identifier, address }) => ({ name, identifier, address }));
}

module.exports = { MEMBERS, deployContracts, seedChain };
