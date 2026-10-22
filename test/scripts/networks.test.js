const { expect } = require("chai");
const { Wallet } = require("ethers");

const networks = require("../../config/networks");

// 32 bytes of obviously fake key material, and a throwaway phrase.
const KEY = "0x" + "ab".repeat(32);
const MNEMONIC = "test test test test test test test test test test test junk";
const REMOTE = "https://rpc.example.org";

const TOUCHED = [
  "DEPLOYER_PRIVATE_KEY",
  "BESU_PRIVATE_KEY",
  "DEMO_MNEMONIC",
  "BESU_RPC_URL",
  "SEPOLIA_RPC_URL",
  "PUBLIC_RPC_URL_BESU",
  "PUBLIC_RPC_URL_SEPOLIA",
  "EXPLORER_URL_SEPOLIA",
  "LOCALHOST_RPC_URL",
];

describe("network configuration", function () {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
    for (const k of TOUCHED) delete process.env[k];
  });
  afterEach(() => {
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("which keys sign", function () {
    it("uses the public test mnemonic for a node on this machine", function () {
      expect(networks.accountsFor("localhost")).to.deep.equal({ mnemonic: MNEMONIC, count: 20 });
      process.env.BESU_RPC_URL = "http://127.0.0.1:8601";
      expect(networks.accountsFor("besu")).to.deep.equal({ mnemonic: MNEMONIC, count: 20 });
      process.env.BESU_RPC_URL = "http://localhost:8545";
      expect(networks.accountsFor("besu")).to.deep.equal({ mnemonic: MNEMONIC, count: 20 });
    });

    it("never uses the public test mnemonic for a network that is not on this machine", function () {
      process.env.BESU_RPC_URL = REMOTE;
      expect(networks.accountsFor("besu")).to.deep.equal([]);
    });

    it("does not mistake a hostile hostname for a local one", function () {
      for (const url of [
        "http://127.0.0.1.evil.example",
        "http://localhost.evil.example:8545",
        "https://evil.example/?http://127.0.0.1",
        "http://evil.example#localhost",
        "http://127.0.0.1@evil.example",
      ]) {
        process.env.BESU_RPC_URL = url;
        expect(networks.accountsFor("besu"), url).to.deep.equal([]);
      }
    });

    it("gives a hosted network its own phrase when one is set", function () {
      process.env.BESU_RPC_URL = REMOTE;
      process.env.DEMO_MNEMONIC = MNEMONIC;
      expect(networks.accountsFor("besu")).to.deep.equal({ mnemonic: MNEMONIC, count: 20 });
    });

    it("makes the deployer key signer 0 and takes the rest from the phrase", function () {
      process.env.BESU_RPC_URL = REMOTE;
      process.env.DEPLOYER_PRIVATE_KEY = KEY;
      process.env.DEMO_MNEMONIC = MNEMONIC;

      const accounts = networks.accountsFor("besu");
      expect(accounts).to.have.length(20);
      expect(accounts[0]).to.equal(KEY);
      // index 1 of the phrase is the second well-known Hardhat account
      expect(new Wallet(accounts[1]).address).to.equal("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      expect(new Set(accounts).size).to.equal(20);
    });

    it("accepts a key with or without 0x and in either case", function () {
      process.env.BESU_RPC_URL = REMOTE;
      process.env.DEPLOYER_PRIVATE_KEY = "AB".repeat(32);
      expect(networks.accountsFor("besu")).to.deep.equal([KEY]);
    });

    it("still accepts the old BESU_PRIVATE_KEY name", function () {
      process.env.BESU_RPC_URL = REMOTE;
      process.env.BESU_PRIVATE_KEY = KEY;
      expect(networks.accountsFor("besu")).to.deep.equal([KEY]);
    });

    it("rejects a malformed key without repeating it", function () {
      process.env.BESU_RPC_URL = REMOTE;
      for (const bad of ["not-a-key", "0x1234", "ab".repeat(31), "zz".repeat(32), "ab".repeat(33)]) {
        process.env.DEPLOYER_PRIVATE_KEY = bad;
        let message;
        try {
          networks.accountsFor("besu");
        } catch (error) {
          message = error.message;
        }
        expect(message, bad).to.match(/not a 32-byte hex private key/);
        expect(message, bad).to.not.include(bad);
      }
    });
  });

  describe("whether a network can be used from here", function () {
    it("explains what is missing, in each case", function () {
      expect(() => networks.assertUsable("mainnet")).to.throw(/Unknown network "mainnet"/);
      expect(() => networks.assertUsable("sepolia")).to.throw(/SEPOLIA_RPC_URL/);

      process.env.BESU_RPC_URL = REMOTE;
      expect(() => networks.assertUsable("besu")).to.throw(/no signing key[\s\S]*DEPLOYER_PRIVATE_KEY/);
    });

    it("lets through what is configured", function () {
      expect(() => networks.assertUsable("hardhat")).to.not.throw();
      expect(() => networks.assertUsable("localhost")).to.not.throw();

      process.env.BESU_RPC_URL = REMOTE;
      process.env.DEPLOYER_PRIVATE_KEY = KEY;
      expect(() => networks.assertUsable("besu")).to.not.throw();
    });

    it("leaves an unconfigured hosted network out of Hardhat's list rather than breaking it", function () {
      const list = networks.hardhatNetworks();
      expect(list).to.have.property("hardhat");
      expect(list).to.have.property("localhost");
      expect(list).to.not.have.property("sepolia");

      process.env.SEPOLIA_RPC_URL = "https://sepolia.example/key";
      expect(networks.hardhatNetworks().sepolia.url).to.equal("https://sepolia.example/key");
    });

    it("sends zero-gas networks at gas price zero and others at the node's price", function () {
      process.env.SEPOLIA_RPC_URL = "https://sepolia.example/key";
      const list = networks.hardhatNetworks();
      expect(list.besu.gasPrice).to.equal(0);
      expect(list.sepolia).to.not.have.property("gasPrice");
      expect(list.sepolia.chainId).to.equal(11155111);
    });
  });

  describe("what the browser is told", function () {
    it("publishes a local node's own address", function () {
      expect(networks.resolve("localhost").publicRpcUrl).to.equal("http://127.0.0.1:8545");
    });

    it("never publishes the URL scripts use unless it is local, because it may carry an API key", function () {
      process.env.SEPOLIA_RPC_URL = "https://eth-sepolia.example/v2/SECRETAPIKEY";
      expect(networks.resolve("sepolia").publicRpcUrl).to.equal(null);

      process.env.PUBLIC_RPC_URL_SEPOLIA = "https://keyless.example";
      expect(networks.resolve("sepolia").publicRpcUrl).to.equal("https://keyless.example");
    });

    it("trims a trailing slash from the explorer address", function () {
      process.env.EXPLORER_URL_SEPOLIA = "https://explorer.example///";
      expect(networks.resolve("sepolia").explorerUrl).to.equal("https://explorer.example");
      delete process.env.EXPLORER_URL_SEPOLIA;
      expect(networks.resolve("sepolia").explorerUrl).to.equal(null);
    });

    it("does not use 1337, which wallets already know as something else", function () {
      expect(networks.resolve("besu").chainId).to.not.equal(1337);
    });
  });
});
