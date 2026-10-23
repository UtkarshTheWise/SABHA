/**
 * Puts a local chain into every situation the interface has to show, so a browser
 * (or a person) can look at each one. Run it after `npm run deploy` against the
 * local node; it enrols the sample members and opens ballots in these states:
 *
 *   open            voting now, some members have voted
 *   pending         opens in two days
 *   awaiting count  voting has ended, nobody has counted yet
 *   carried         counted, quorum met, one option ahead
 *   advisory        counted, one option ahead, turnout below the quorum
 *   tied            counted, two options level
 *   withdrawn       cancelled before it opened
 *
 * It uses the node's unlocked accounts and moves the node's clock, which only a
 * development node allows. Everything it writes is sample data.
 *
 *   node e2e/fixture.js
 */
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Contract, id } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const RPC = process.env.E2E_RPC || "http://127.0.0.1:8545";
const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "localhost.json"), "utf8"));
const abi = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "frontend", "src", "chain", "abi", `${name}.json`), "utf8"));

const MINUTE = 60;
const DAY = 24 * 60 * 60;

async function main() {
  const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1, staticNetwork: false });
  const accounts = await provider.send("eth_accounts", []);
  const signer = (i) => provider.getSigner(accounts[i]);
  const admin = await signer(0);

  const registry = new Contract(deployment.contracts.MemberRegistry.address, abi("MemberRegistry"), admin);
  const voting = new Contract(deployment.contracts.DirectDemocracy.address, abi("DirectDemocracy"), admin);
  const as = async (i) => voting.connect(await signer(i));

  const wait = async (txPromise) => (await txPromise).wait();
  const now = async () => (await provider.getBlock("latest")).timestamp;
  const advance = async (seconds) => {
    await provider.send("evm_increaseTime", [seconds]);
    await provider.send("evm_mine", []);
  };

  // eight members: accounts 1 to 8
  const members = accounts.slice(1, 9);
  const enrolled = [];
  for (const address of members) if (!(await registry.isActiveMember(address))) enrolled.push(address);
  if (enrolled.length) {
    await wait(registry.enrolBatch(enrolled, enrolled.map((a) => id(`sample-member-${a}`))));
  }
  console.log(`roster: ${await registry.activeMemberCount()} active members`);

  const existing = Number(await voting.proposalCount());
  if (existing > 0) {
    console.log(`${existing} ballots already exist; leaving them alone.`);
    return;
  }

  // creates a ballot that opens in 10 seconds and closes after `lasts`
  const create = async (title, description, options, lasts, quorumBps, opensIn = 10) => {
    const t = await now();
    await wait(voting.createProposal(title, description, options, t + opensIn, t + opensIn + lasts, quorumBps));
    return Number(await voting.proposalCount()) - 1;
  };
  const vote = async (ballot, voter, option) => wait((await as(voter)).castVote(ballot, option));

  // carried: 6 of 8 vote, quorum 50 percent (4 needed), 4-1-1
  let id1 = await create(
    "Raise the annual society fee to Rs 500",
    "The fee has been Rs 300 since 2021 while venue and printing costs have gone up. The committee proposes Rs 500 from the next academic year, with the increase ring-fenced for events.",
    ["For", "Against", "Abstain"],
    MINUTE * 5,
    5000
  );
  await advance(15);
  for (const [v, o] of [[1, 0], [2, 0], [3, 0], [4, 0], [5, 1], [6, 2]]) await vote(id1, v, o);
  await advance(400);
  await wait(voting.finaliseProposal(id1));

  // advisory: 3 of 8 vote with a 75 percent quorum (6 needed), MG ahead
  let id2 = await create(
    "Pick the venue for the annual cultural night",
    "Three shortlisted venues, all within budget. Ranked by capacity: MG Auditorium 600, Anna Auditorium 400, Open Air Theatre 900 but weather dependent.",
    ["MG Auditorium", "Anna Auditorium", "Open Air Theatre"],
    MINUTE * 5,
    7500
  );
  await advance(15);
  for (const [v, o] of [[1, 0], [2, 0], [3, 1]]) await vote(id2, v, o);
  await advance(400);
  await wait(voting.finaliseProposal(id2));

  // tied: 4 of 8, two each
  let id3 = await create(
    "Move the general body meeting to Saturday mornings",
    "Attendance on Wednesday evenings has been under half. The proposal moves the meeting to 10am Saturday for one semester as a trial.",
    ["Move it", "Keep Wednesday"],
    MINUTE * 5,
    5000
  );
  await advance(15);
  for (const [v, o] of [[1, 0], [2, 0], [3, 1], [4, 1]]) await vote(id3, v, o);
  await advance(400);
  await wait(voting.finaliseProposal(id3));

  // awaiting count: voting ended, not counted
  let id4 = await create(
    "Should the society publish its accounts every term?",
    "Accounts are published once a year, after the audit. The proposal is to publish an unaudited summary at the end of every term as well.",
    ["Publish every term", "Keep the annual cycle", "Abstain"],
    MINUTE * 5,
    6000
  );
  await advance(15);
  for (const [v, o] of [[1, 0], [2, 0], [3, 0], [4, 1], [5, 2]]) await vote(id4, v, o);
  await advance(400);

  // withdrawn: created for the future, then cancelled
  const id5 = await create("Name the society magazine", "Members suggest names; the committee picks the shortlist.", ["Sabha Times", "The Ledger"], DAY, 2500, DAY);
  await wait(voting.cancelProposal(id5));

  // open: voting now, three votes in
  const id6 = await create(
    "Approve the sports day budget",
    "The committee asks for Rs 18,000 for sports day: trophies, refreshments and a hired ground. The balance comes from the events fund.",
    ["Approve", "Send back for changes"],
    DAY * 3,
    5000
  );
  await advance(15);
  for (const [v, o] of [[1, 0], [2, 0], [3, 1]]) await vote(id6, v, o);

  // pending: opens in two days
  await create("Elect a deputy treasurer", "Nominations close at the next general body meeting.", ["Rhea Nair", "Kabir Sethi", "Meera Iyer"], DAY * 2, 5000, DAY * 2);

  console.log(`ballots: ${await voting.proposalCount()} (carried, advisory, tied, awaiting count, withdrawn, open, pending)`);
  console.log("members who have not voted on the open ballot: accounts 4 to 8; account 0 is the officer.");
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exitCode = 1;
});
