const { expect } = require("chai");
const path = require("path");
const { pathToFileURL } = require("url");

const besu = {
  key: "besu",
  label: "Sabha network (Besu QBFT)",
  chainId: 40717,
  rpcUrl: "https://rpc.example.org",
  explorerUrl: null,
  zeroGas: true,
  currency: { name: "Sabha Gas", symbol: "SBH", decimals: 18 },
};
const sepolia = {
  key: "sepolia",
  label: "Sepolia testnet",
  chainId: 11155111,
  rpcUrl: "https://sepolia.example.org",
  explorerUrl: "https://explorer.example",
  zeroGas: false,
  currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
};
const localhost = { key: "localhost", label: "Local node", chainId: 31337, rpcUrl: "http://127.0.0.1:8545", zeroGas: false };

describe("frontend network helpers", function () {
  let p;
  before(async function () {
    // The frontend is an ES module package; mocha here is CommonJS.
    p = await import(pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "lib", "networkParams.js")).href);
  });

  describe("adding a network to a wallet", function () {
    it("sends the chain id as hex with no leading zeros, which is what wallets require", function () {
      expect(p.chainIdHex(besu)).to.equal("0x9f0d");
      expect(p.chainIdHex(sepolia)).to.equal("0xaa36a7");
      expect(p.chainIdHex({ chainId: 1 })).to.equal("0x1");
      expect(p.chainIdHex({ chainId: 31337 })).to.equal("0x7a69");
    });

    it("builds the request a wallet expects", function () {
      expect(p.addChainParams(sepolia)).to.deep.equal({
        chainId: "0xaa36a7",
        chainName: "Sepolia testnet",
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://sepolia.example.org"],
        blockExplorerUrls: ["https://explorer.example"],
      });
    });

    it("leaves out the explorer when there is none instead of sending null", function () {
      expect(p.addChainParams(besu)).to.not.have.property("blockExplorerUrls");
    });

    it("explains, rather than let the wallet fail, when the address is plain http", function () {
      expect(() => p.addChainParams({ ...besu, rpcUrl: "http://rpc.example.org" })).to.throw(/only accept an https address/);
    });

    it("allows plain http for a node on the same machine", function () {
      expect(p.addChainParams(localhost).rpcUrls).to.deep.equal(["http://127.0.0.1:8545"]);
    });

    it("is not fooled by a hostname that merely starts with a local one", function () {
      expect(() => p.addChainParams({ ...besu, rpcUrl: "http://127.0.0.1.evil.example" })).to.throw(/only accept an https/);
      expect(p.isLocalUrl("http://localhost.evil.example")).to.equal(false);
      expect(p.isLocalUrl("http://localhost:8545/")).to.equal(true);
    });

    it("says so when a network has no public address at all", function () {
      expect(() => p.addChainParams({ ...besu, rpcUrl: null })).to.throw(/no public RPC address/);
    });
  });

  describe("paying nothing", function () {
    it("sends a legacy transaction at gas price zero on a zero-gas network", function () {
      expect(p.feeOverrides(besu)).to.deep.equal({ type: 0, gasPrice: 0n });
    });

    it("leaves fees to the wallet everywhere else", function () {
      expect(p.feeOverrides(sepolia)).to.deep.equal({});
      expect(p.feeOverrides(localhost)).to.deep.equal({});
      expect(p.feeOverrides(null)).to.deep.equal({});
    });
  });

  describe("links to the explorer", function () {
    it("links a transaction and an address", function () {
      const hash = "0x" + "ab".repeat(32);
      expect(p.explorerTx(sepolia, hash)).to.equal(`https://explorer.example/tx/${hash}`);
      expect(p.explorerAddress(sepolia, "0xabc")).to.equal("https://explorer.example/address/0xabc");
    });

    it("gives nothing when there is no explorer or nothing to link", function () {
      expect(p.explorerTx(besu, "0x1")).to.equal(null);
      expect(p.explorerTx(sepolia, undefined)).to.equal(null);
      expect(p.explorerTx(undefined, "0x1")).to.equal(null);
    });
  });

  describe("choosing and ordering networks", function () {
    it("puts hosted networks first for a visitor", function () {
      const keys = p.orderNetworks([localhost, sepolia, besu]).map((n) => n.key);
      expect(keys).to.deep.equal(["besu", "sepolia", "localhost"]);
    });

    it("puts the local node first for a developer", function () {
      const keys = p.orderNetworks([sepolia, besu, localhost], { dev: true }).map((n) => n.key);
      expect(keys).to.deep.equal(["localhost", "besu", "sepolia"]);
    });

    it("keeps an unknown network, last, and does not change its input", function () {
      const input = [{ key: "zzz" }, sepolia];
      const out = p.orderNetworks(input);
      expect(out.map((n) => n.key)).to.deep.equal(["sepolia", "zzz"]);
      expect(input.map((n) => n.key)).to.deep.equal(["zzz", "sepolia"]);
    });

    it("polls a local node briskly and a shared endpoint gently", function () {
      expect(p.pollInterval(localhost)).to.be.lessThan(p.pollInterval(besu));
      expect(p.pollInterval(besu)).to.be.at.least(10000);
    });
  });

  describe("overriding an address at build time", function () {
    it("uses the variable named for the network", function () {
      expect(p.withRpcOverride(besu, { VITE_RPC_URL_BESU: "https://staging.example" }).rpcUrl).to.equal("https://staging.example");
    });

    it("leaves other networks alone", function () {
      expect(p.withRpcOverride(sepolia, { VITE_RPC_URL_BESU: "https://staging.example" }).rpcUrl).to.equal(sepolia.rpcUrl);
    });

    it("still honours the older VITE_RPC_URL, for the local node only", function () {
      expect(p.withRpcOverride(localhost, { VITE_RPC_URL: "http://127.0.0.1:9999" }).rpcUrl).to.equal("http://127.0.0.1:9999");
      expect(p.withRpcOverride(besu, { VITE_RPC_URL: "http://127.0.0.1:9999" }).rpcUrl).to.equal(besu.rpcUrl);
    });

    it("does not modify the original", function () {
      const copy = { ...besu };
      p.withRpcOverride(copy, { VITE_RPC_URL_BESU: "https://x.example" });
      expect(copy).to.deep.equal(besu);
    });
  });
});
