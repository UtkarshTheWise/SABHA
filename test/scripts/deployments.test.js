const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const hre = require("hardhat");

const deployments = require("../../scripts/lib/deployments");

const RECORD = {
  chainId: 40717,
  deployedAt: "2026-10-23T00:00:00.000Z",
  admin: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  contracts: {
    MemberRegistry: { address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", txHash: "0x" + "11".repeat(32), block: 1 },
    DirectDemocracy: { address: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", txHash: "0x" + "22".repeat(32), block: 2 },
  },
};

const TOUCHED = [
  "SABHA_CHAIN_DIR",
  "SABHA_DEPLOYMENTS_DIR",
  "DEPLOYER_PRIVATE_KEY",
  "DEMO_MNEMONIC",
  "ETHERSCAN_API_KEY",
  "BESU_PRIVATE_KEY",
  "BESU_RPC_URL",
  "PUBLIC_RPC_URL_BESU",
  "EXPLORER_URL_BESU",
  "SEPOLIA_RPC_URL",
  "PUBLIC_RPC_URL_SEPOLIA",
];

describe("publishing a deployment to the frontend", function () {
  let saved;
  let chain;
  let records;

  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
    for (const k of TOUCHED) delete process.env[k];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sabha-pub-"));
    chain = path.join(root, "chain");
    records = path.join(root, "deployments");
    process.env.SABHA_CHAIN_DIR = chain;
    process.env.SABHA_DEPLOYMENTS_DIR = records;
  });
  afterEach(() => {
    fs.rmSync(path.dirname(chain), { recursive: true, force: true });
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const read = (...p) => JSON.parse(fs.readFileSync(path.join(chain, ...p), "utf8"));
  const exists = (...p) => fs.existsSync(path.join(chain, ...p));

  describe("the files it writes", function () {
    it("writes each contract's ABI once, matching the compiled artifact", function () {
      deployments.publishToFrontend(hre, "localhost", RECORD);
      for (const name of deployments.CONTRACTS) {
        expect(read("abi", `${name}.json`)).to.deep.equal(hre.artifacts.readArtifactSync(name).abi);
      }
    });

    it("writes one file per network with exactly the fields the browser needs", function () {
      deployments.publishToFrontend(hre, "localhost", RECORD);
      const file = read("networks", "localhost.json");

      expect(Object.keys(file).sort()).to.deep.equal(
        ["admin", "chainId", "contracts", "currency", "deployedAt", "explorerUrl", "key", "label", "logChunk", "rpcUrl", "zeroGas"].sort()
      );
      expect(file.key).to.equal("localhost");
      expect(file.rpcUrl).to.equal("http://127.0.0.1:8545");
      expect(file.contracts.DirectDemocracy.address).to.equal(RECORD.contracts.DirectDemocracy.address);
    });

    it("keeps networks apart", function () {
      process.env.BESU_RPC_URL = "http://127.0.0.1:8601";
      deployments.publishToFrontend(hre, "localhost", RECORD);
      deployments.publishToFrontend(hre, "besu", { ...RECORD, chainId: 40717 });

      expect(fs.readdirSync(path.join(chain, "networks")).sort()).to.deep.equal(["besu.json", "localhost.json"]);
      expect(read("networks", "besu.json").zeroGas).to.equal(true);
      expect(read("networks", "localhost.json").zeroGas).to.equal(false);
    });

    it("records the explorer so the interface can link to transactions", function () {
      process.env.BESU_RPC_URL = "http://127.0.0.1:8601";
      process.env.EXPLORER_URL_BESU = "https://explorer.example/";
      deployments.publishToFrontend(hre, "besu", RECORD);
      expect(read("networks", "besu.json").explorerUrl).to.equal("https://explorer.example");
    });
  });

  describe("what it refuses to publish", function () {
    it("will not publish a hosted network without a public address, and writes nothing", function () {
      process.env.BESU_RPC_URL = "https://rpc.example.org";
      expect(() => deployments.publishToFrontend(hre, "besu", RECORD)).to.throw(/No public RPC URL for "besu"/);
      expect(exists("networks")).to.equal(false);
      expect(exists("abi")).to.equal(false);
    });

    it("never writes the URL scripts use when it differs from the public one", function () {
      process.env.SEPOLIA_RPC_URL = "https://eth-sepolia.example/v2/VERYSECRETAPIKEY";
      process.env.PUBLIC_RPC_URL_SEPOLIA = "https://keyless-sepolia.example";
      deployments.publishToFrontend(hre, "sepolia", { ...RECORD, chainId: 11155111 });

      const text = fs.readFileSync(path.join(chain, "networks", "sepolia.json"), "utf8");
      expect(text).to.include("https://keyless-sepolia.example");
      expect(text).to.not.include("VERYSECRETAPIKEY");
    });

    it("does not fall back to the private URL when no public one is set", function () {
      process.env.SEPOLIA_RPC_URL = "https://eth-sepolia.example/v2/VERYSECRETAPIKEY";
      expect(() => deployments.publishToFrontend(hre, "sepolia", RECORD)).to.throw(/No public RPC URL/);
    });

    it("refuses if the record somehow carries the deployer key or the phrase", function () {
      process.env.DEPLOYER_PRIVATE_KEY = "0x" + "cd".repeat(32);
      process.env.DEMO_MNEMONIC = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";

      const leakyKey = { ...RECORD, admin: "cd".repeat(32) };
      expect(() => deployments.publishToFrontend(hre, "localhost", leakyKey)).to.throw(/contain a secret/);

      const leakyPhrase = { ...RECORD, note: "x", contracts: { ...RECORD.contracts, Extra: { phrase: process.env.DEMO_MNEMONIC } } };
      expect(() => deployments.publishToFrontend(hre, "localhost", leakyPhrase)).to.throw(/contain a secret/);
      expect(exists("networks")).to.equal(false);
    });

    it("ignores a field in the record that is not on the allowlist", function () {
      deployments.publishToFrontend(hre, "localhost", { ...RECORD, privateThing: "do-not-publish" });
      expect(fs.readFileSync(path.join(chain, "networks", "localhost.json"), "utf8")).to.not.include("do-not-publish");
    });

    it("will not publish the in-process test network or an unknown one", function () {
      expect(() => deployments.publishToFrontend(hre, "hardhat", RECORD)).to.throw(/not a network the frontend can use/);
      expect(() => deployments.publishToFrontend(hre, "mainnet", RECORD)).to.throw(/not a network the frontend can use/);
    });
  });

  describe("the register of names", function () {
    const ENTRIES = [{ name: "Aanya Tomar", identifier: "25BCE5384", address: RECORD.admin }];

    it("is written for the local demo", function () {
      expect(deployments.saveDirectory("localhost", ENTRIES)).to.be.a("string");
      expect(read("directory.json")).to.deep.equal(ENTRIES);
    });

    it("is never written for a hosted network, because it holds registration numbers", function () {
      for (const name of ["besu", "sepolia", "hardhat"]) {
        expect(deployments.saveDirectory(name, ENTRIES), name).to.equal(null);
      }
      expect(exists("directory.json")).to.equal(false);
    });
  });

  describe("the deployment record", function () {
    it("is saved per network and read back", function () {
      deployments.save("besu", RECORD);
      expect(deployments.load("besu")).to.deep.equal(RECORD);
      expect(fs.existsSync(path.join(records, "besu.json"))).to.equal(true);
    });

    it("tells you what to run when there is none", function () {
      expect(() => deployments.load("sepolia")).to.throw(/No deployment found for network "sepolia"[\s\S]*SABHA_NETWORK=sepolia npm run deploy/);
    });
  });
});
