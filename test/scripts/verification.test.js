const { expect } = require("chai");
const { ethers } = require("hardhat");

const { verificationPlan, alreadyVerified } = require("../../scripts/lib/verification");
const { ensureFunded } = require("../../scripts/lib/funding");

const REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const VOTING = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const ADMIN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const RECORD = {
  admin: ADMIN,
  contracts: { MemberRegistry: { address: REGISTRY }, DirectDemocracy: { address: VOTING } },
};

describe("publishing source to an explorer", function () {
  let saved;
  beforeEach(() => {
    saved = { EXPLORER_URL_SEPOLIA: process.env.EXPLORER_URL_SEPOLIA, EXPLORER_URL_BESU: process.env.EXPLORER_URL_BESU };
    delete process.env.EXPLORER_URL_SEPOLIA;
    delete process.env.EXPLORER_URL_BESU;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("what is submitted", function () {
    it("lists both contracts with the arguments each was deployed with", function () {
      process.env.EXPLORER_URL_SEPOLIA = "https://explorer.example";
      const plan = verificationPlan("sepolia", RECORD);

      expect(plan.map((p) => p.name)).to.deep.equal(["MemberRegistry", "DirectDemocracy"]);
      expect(plan[0].address).to.equal(REGISTRY);
      expect(plan[0].args).to.deep.equal([ADMIN]);
      // DirectDemocracy's constructor takes the registry first, then the admin
      expect(plan[1].address).to.equal(VOTING);
      expect(plan[1].args).to.deep.equal([REGISTRY, ADMIN]);
    });

    it("names the source file, so two contracts with similar code cannot be confused", function () {
      process.env.EXPLORER_URL_SEPOLIA = "https://explorer.example";
      const plan = verificationPlan("sepolia", RECORD);
      expect(plan.map((p) => p.contract)).to.deep.equal([
        "contracts/MemberRegistry.sol:MemberRegistry",
        "contracts/DirectDemocracy.sol:DirectDemocracy",
      ]);
    });

    it("uses the arguments the deploy script really used", async function () {
      // If the constructors change and this list does not, verification would
      // silently fail on the explorer. Pin it to the compiled ABI.
      const registryCtor = (await ethers.getContractFactory("MemberRegistry")).interface.deploy.inputs.map((i) => i.type);
      const votingCtor = (await ethers.getContractFactory("DirectDemocracy")).interface.deploy.inputs.map((i) => i.type);
      process.env.EXPLORER_URL_SEPOLIA = "https://explorer.example";
      const plan = verificationPlan("sepolia", RECORD);

      expect(plan[0].args).to.have.length(registryCtor.length);
      expect(plan[1].args).to.have.length(votingCtor.length);
      expect(registryCtor).to.deep.equal(["address"]);
      expect(votingCtor).to.deep.equal(["address", "address"]);
    });
  });

  describe("when there is nothing to publish to", function () {
    it("explains that a private network has no explorer", function () {
      expect(() => verificationPlan("besu", RECORD)).to.throw(/Nothing to verify on "besu"[\s\S]*no explorer/);
      expect(() => verificationPlan("localhost", RECORD)).to.throw(/Nothing to verify/);
    });

    it("says how to configure one on a public network", function () {
      expect(() => verificationPlan("sepolia", RECORD)).to.throw(/EXPLORER_URL_SEPOLIA/);
    });

    it("refuses a network this project does not deploy to", function () {
      expect(() => verificationPlan("mainnet", RECORD)).to.throw(/not a network this project deploys to/);
      expect(() => verificationPlan("hardhat", RECORD)).to.throw(/not a network this project deploys to/);
    });
  });

  describe("recognising an already-verified contract", function () {
    it("treats the wordings explorers use as success, not failure", function () {
      for (const message of [
        "Contract source code already verified",
        "Already Verified",
        "The contract 0x1 has already been verified on Etherscan.",
        "Smart-contract already verified.",
        "contract already exists in the repository",
      ]) {
        expect(alreadyVerified(new Error(message)), message).to.equal(true);
      }
    });

    it("does not hide a real failure", function () {
      for (const message of [
        "Fail - Unable to verify. Compiled bytecode does not match",
        "Invalid API Key",
        "connect ETIMEDOUT",
        "Contract source code not verified",
      ]) {
        expect(alreadyVerified(new Error(message)), message).to.equal(false);
      }
      expect(alreadyVerified(undefined)).to.equal(false);
      expect(alreadyVerified({})).to.equal(false);
    });
  });
});

describe("sending with an explicit gas limit", function () {
  const { estimating } = require("../../scripts/lib/estimating");
  const { time } = require("@nomicfoundation/hardhat-network-helpers");
  const { setBalance } = require("@nomicfoundation/hardhat-network-helpers");

  async function openBallot() {
    const [admin, member] = await ethers.getSigners();
    const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
    const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);
    await registry.enrol(member.address, ethers.id("member"));
    const now = await time.latest();
    await voting.createProposal("Q", "D", ["A", "B"], now + 1, now + 3600, 0);
    await time.increase(5);
    return { voting, member };
  }

  it("lets a wallet holding a few thousandths of an ether vote", async function () {
    const { voting, member } = await openBallot();
    await setBalance(member.address, ethers.parseEther("0.005"));

    const tx = await voting.connect(estimating(member)).castVote(0, 0);
    const receipt = await tx.wait();

    expect(receipt.status).to.equal(1);
    // the limit is the estimate plus the margin, not the chain's maximum
    expect(tx.gasLimit).to.be.greaterThan(receipt.gasUsed);
    expect(tx.gasLimit).to.be.lessThan(receipt.gasUsed * 2n);
  });

  it("is needed: the default path refuses the same wallet for the same vote", async function () {
    // This is the failure the helper exists to avoid. If a Hardhat upgrade fixes
    // it, this test fails and the helper can go.
    const { voting, member } = await openBallot();
    await setBalance(member.address, ethers.parseEther("0.005"));

    let message;
    try {
      await (await voting.connect(member).castVote(0, 0)).wait();
    } catch (error) {
      message = error.message;
    }
    expect(message).to.match(/enough funds|insufficient funds/i);
  });

  it("keeps a gas limit the caller chose", async function () {
    const { voting, member } = await openBallot();
    const tx = await voting.connect(estimating(member)).castVote(0, 0, { gasLimit: 200000 });
    expect(tx.gasLimit).to.equal(200000n);
  });

  it("still reports a transaction that would revert", async function () {
    const { voting, member } = await openBallot();
    await voting.connect(estimating(member)).castVote(0, 0);

    let message;
    try {
      await voting.connect(estimating(member)).castVote(0, 1);
    } catch (error) {
      message = error.message;
    }
    expect(message).to.match(/AlreadyVoted/);
  });

  it("passes everything else through to the signer", async function () {
    const [signer] = await ethers.getSigners();
    const wrapped = estimating(signer);
    expect(wrapped.address).to.equal(signer.address);
    expect(await wrapped.getAddress()).to.equal(signer.address);
    expect(wrapped.provider).to.equal(signer.provider);
  });
});

describe("funding the demo's voters", function () {
  const MIN = ethers.parseEther("0.003");
  const AMOUNT = ethers.parseEther("0.005");

  const fresh = (n) => Array.from({ length: n }, () => ethers.Wallet.createRandom().connect(ethers.provider));

  it("sends each empty wallet the amount", async function () {
    const [funder] = await ethers.getSigners();
    const voters = fresh(3);

    const done = await ensureFunded(ethers, funder, voters, { minimum: MIN, amount: AMOUNT });

    expect(done).to.have.length(3);
    for (const voter of voters) expect(await ethers.provider.getBalance(voter.address)).to.equal(AMOUNT);
    expect(done[0].receipt.hash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("does nothing when everyone already has enough", async function () {
    const [funder, a, b] = await ethers.getSigners();
    const before = await ethers.provider.getBalance(funder.address);

    expect(await ensureFunded(ethers, funder, [a, b], { minimum: MIN, amount: AMOUNT })).to.deep.equal([]);
    expect(await ethers.provider.getBalance(funder.address)).to.equal(before);
  });

  it("funds only the wallets that are short", async function () {
    const [funder, rich] = await ethers.getSigners();
    const [poor] = fresh(1);

    const done = await ensureFunded(ethers, funder, [rich, poor], { minimum: MIN, amount: AMOUNT });

    expect(done.map((d) => d.address)).to.deep.equal([poor.address]);
  });

  it("treats a wallet exactly at the minimum as funded, and one just under as short", async function () {
    const [funder] = await ethers.getSigners();
    const [atLine, underLine] = fresh(2);
    await (await funder.sendTransaction({ to: atLine.address, value: MIN })).wait();
    await (await funder.sendTransaction({ to: underLine.address, value: MIN - 1n })).wait();

    const done = await ensureFunded(ethers, funder, [atLine, underLine], { minimum: MIN, amount: AMOUNT });

    expect(done.map((d) => d.address)).to.deep.equal([underLine.address]);
  });

  it("accepts plain addresses as well as signers", async function () {
    const [funder] = await ethers.getSigners();
    const [voter] = fresh(1);
    const done = await ensureFunded(ethers, funder, [voter.address], { minimum: MIN, amount: AMOUNT });
    expect(done).to.have.length(1);
  });

  it("stops before sending anything if the funder cannot cover everyone", async function () {
    const [rich] = await ethers.getSigners();
    const [poorFunder] = fresh(1);
    await (await rich.sendTransaction({ to: poorFunder.address, value: ethers.parseEther("0.01") })).wait();
    const voters = fresh(3); // needs 0.015, has 0.01

    let message;
    try {
      await ensureFunded(ethers, poorFunder, voters, { minimum: MIN, amount: AMOUNT });
    } catch (error) {
      message = error.message;
    }

    expect(message).to.match(/holds 0\.01 ETH but funding 3 voters needs about 0\.015/);
    expect(message).to.include(poorFunder.address);
    for (const voter of voters) expect(await ethers.provider.getBalance(voter.address)).to.equal(0n);
  });
});
