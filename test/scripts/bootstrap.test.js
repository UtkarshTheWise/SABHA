const { expect } = require("chai");
const hre = require("hardhat");

const { deployContracts, seedChain, MEMBERS } = require("../../scripts/lib/bootstrap");

const quiet = { log: () => {} };

describe("deploying and seeding a chain", function () {
  describe("deployContracts", function () {
    it("deploys both contracts, wired together, and reports where they went", async function () {
      const record = await deployContracts(hre, quiet);
      const [admin] = await hre.ethers.getSigners();

      expect(record.admin).to.equal(admin.address);
      expect(record.chainId).to.equal(31337);
      expect(record.contracts.MemberRegistry.address).to.match(/^0x[0-9a-fA-F]{40}$/);
      expect(record.contracts.DirectDemocracy.txHash).to.match(/^0x[0-9a-f]{64}$/);
      expect(record.contracts.DirectDemocracy.block).to.be.greaterThan(record.contracts.MemberRegistry.block - 1);

      const voting = await hre.ethers.getContractAt("DirectDemocracy", record.contracts.DirectDemocracy.address);
      expect(await voting.registry()).to.equal(record.contracts.MemberRegistry.address);
    });

    it("prints what it did, in the same words as before", async function () {
      const lines = [];
      await deployContracts(hre, { log: (l) => lines.push(l) });
      const text = lines.join("\n");
      expect(text).to.match(/network\s+hardhat \(chainId 31337\)/);
      expect(text).to.match(/MemberRegistry\s+0x/);
      expect(text).to.match(/DirectDemocracy\s+0x/);
    });

    // A stand-in for a network that charges for gas and whose deployer is empty.
    const stub = (name, balance, signers = [{ address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" }]) => ({
      network: { name },
      ethers: {
        getSigners: async () => signers,
        provider: { getNetwork: async () => ({ chainId: 11155111n }), getBalance: async () => balance },
        formatEther: (v) => String(v),
        deployContract: async () => {
          throw new Error("should not have tried to deploy");
        },
      },
    });

    it("stops before sending anything when the deployer has no ether on a network that charges", async function () {
      let message;
      try {
        await deployContracts(stub("localhost", 0n), quiet);
      } catch (error) {
        message = error.message;
      }
      expect(message).to.match(/has no ether on Local node/);
      expect(message).to.match(/faucet/);
    });

    it("does not insist on a balance where gas is free", async function () {
      // The free-gas network: an empty deployer is normal. It gets as far as trying to deploy.
      process.env.BESU_RPC_URL = "http://127.0.0.1:1";
      try {
        let message;
        try {
          await deployContracts(stub("besu", 0n), quiet);
        } catch (error) {
          message = error.message;
        }
        expect(message).to.equal("should not have tried to deploy");
      } finally {
        delete process.env.BESU_RPC_URL;
      }
    });

    it("says what to set when there is no signing key at all", async function () {
      let message;
      try {
        await deployContracts(stub("besu", 0n, []), quiet);
      } catch (error) {
        message = error.message;
      }
      expect(message).to.match(/No signing key for "besu"[\s\S]*DEPLOYER_PRIVATE_KEY/);
    });
  });

  describe("seedChain", function () {
    it("enrols the sample members and opens the sample ballots", async function () {
      const record = await deployContracts(hre, quiet);
      const people = await seedChain(hre, record, quiet);

      const registry = await hre.ethers.getContractAt("MemberRegistry", record.contracts.MemberRegistry.address);
      const voting = await hre.ethers.getContractAt("DirectDemocracy", record.contracts.DirectDemocracy.address);

      expect(await registry.activeMemberCount()).to.equal(MEMBERS.length);
      expect(await voting.proposalCount()).to.equal(3);
      expect(people).to.have.length(MEMBERS.length);
    });

    it("is safe to run twice: nothing is enrolled or opened a second time", async function () {
      const record = await deployContracts(hre, quiet);
      await seedChain(hre, record, quiet);
      const lines = [];
      await seedChain(hre, record, { log: (l) => lines.push(l) });

      const registry = await hre.ethers.getContractAt("MemberRegistry", record.contracts.MemberRegistry.address);
      const voting = await hre.ethers.getContractAt("DirectDemocracy", record.contracts.DirectDemocracy.address);
      expect(await registry.rosterLength()).to.equal(MEMBERS.length);
      expect(await voting.proposalCount()).to.equal(3);
      expect(lines.join("\n")).to.match(/already populated/);
      expect(lines.join("\n")).to.match(/already on chain/);
    });

    it("stores only hashes of the registration numbers on chain", async function () {
      const record = await deployContracts(hre, quiet);
      const people = await seedChain(hre, record, quiet);
      const registry = await hre.ethers.getContractAt("MemberRegistry", record.contracts.MemberRegistry.address);

      const first = people[0];
      const stored = await registry.memberOf(first.address);
      expect(stored.memberIdHash).to.equal(hre.ethers.keccak256(hre.ethers.toUtf8Bytes(first.identifier)));
      expect(stored.memberIdHash).to.not.include(Buffer.from(first.identifier).toString("hex"));
    });

    it("returns the register of names for the local demo only to the caller, writing nothing itself", async function () {
      const record = await deployContracts(hre, quiet);
      const people = await seedChain(hre, record, quiet);
      expect(Object.keys(people[0]).sort()).to.deep.equal(["address", "identifier", "name"]);
    });
  });
});
