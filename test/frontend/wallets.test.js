const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, setBalance, takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");
const path = require("path");
const { pathToFileURL } = require("url");

const lib = (name) => import(pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "lib", name)).href);

describe("the wallet kept in this browser", function () {
  this.timeout(60000);
  let w;
  before(async () => (w = await lib("localWallet.js")));

  // A fast key-derivation cost for most tests; one test uses the real default.
  const FAST = { scrypt: { N: 2 ** 10, r: 8, p: 1 } };
  const PASS = "a long enough passphrase";

  describe("choosing a passphrase", function () {
    it("asks for at least ten characters", function () {
      expect(w.passphraseProblem("short")).to.equal("wallet.local.tooShort");
      expect(w.passphraseProblem("123456789")).to.equal("wallet.local.tooShort");
      expect(w.passphraseProblem("1234567890")).to.equal(null);
    });

    it("refuses one character repeated, which meets the length and guards nothing", function () {
      expect(w.passphraseProblem("aaaaaaaaaaaa")).to.equal("wallet.local.tooSimple");
      expect(w.passphraseProblem("0000000000")).to.equal("wallet.local.tooSimple");
    });

    it("does not choke on missing input", function () {
      expect(w.passphraseProblem(undefined)).to.equal("wallet.local.tooShort");
      expect(w.passphraseProblem(null)).to.equal("wallet.local.tooShort");
    });

    it("lets spaces and any language count", function () {
      expect(w.passphraseProblem("கள் இது ஒரு வாக்கியம்")).to.equal(null);
    });
  });

  describe("creating and unlocking", function () {
    it("makes a wallet whose keystore opens with the passphrase and no other", async function () {
      const { wallet, json } = await w.createLocalWallet(PASS, FAST);
      const opened = await w.unlockLocalWallet(json, PASS);
      expect(opened.address).to.equal(wallet.address);
      expect(opened.privateKey).to.equal(wallet.privateKey);

      let rejected;
      try {
        await w.unlockLocalWallet(json, "the wrong passphrase");
      } catch (error) {
        rejected = error;
      }
      expect(rejected, "a wrong passphrase must not open it").to.not.equal(undefined);
    });

    it("stores nothing that contains the key or the passphrase", async function () {
      const { wallet, json } = await w.createLocalWallet(PASS, FAST);
      expect(json).to.not.include(wallet.privateKey.slice(2));
      expect(json).to.not.include(PASS);
    });

    it("writes the standard keystore format any wallet app can import", async function () {
      const { wallet, json } = await w.createLocalWallet(PASS, FAST);
      const parsed = JSON.parse(json);
      expect(parsed.version).to.equal(3);
      const block = parsed.crypto || parsed.Crypto; // ethers writes Crypto, Geth crypto; readers accept both
      expect(block.kdf).to.equal("scrypt");
      expect(ethers.getAddress("0x" + parsed.address)).to.equal(wallet.address);
      // ethers' own reader, which is what other tools use, opens it too
      const other = await ethers.Wallet.fromEncryptedJson(json, PASS);
      expect(other.address).to.equal(wallet.address);
    });

    it("uses the cost it promises by default", async function () {
      const { json } = await w.createLocalWallet(PASS);
      const parsed = JSON.parse(json);
      expect((parsed.crypto || parsed.Crypto).kdfparams.n).to.equal(2 ** 15);
    });

    it("refuses a weak passphrase before doing any work", async function () {
      let error;
      try {
        await w.createLocalWallet("short");
      } catch (e) {
        error = e;
      }
      expect(error.code).to.equal("WEAK_PASSPHRASE");
      expect(error.key).to.equal("wallet.local.tooShort");
    });

    it("makes a different wallet each time", async function () {
      const a = await w.createLocalWallet(PASS, FAST);
      const b = await w.createLocalWallet(PASS, FAST);
      expect(a.wallet.address).to.not.equal(b.wallet.address);
    });
  });

  describe("keeping it between visits", function () {
    const memory = () => {
      const data = {};
      return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v), removeItem: (k) => delete data[k] };
    };

    it("saves, loads and forgets", function () {
      const store = w.keystoreStore(memory());
      expect(store.load()).to.equal(null);
      expect(store.save("{}")).to.equal(true);
      expect(store.load()).to.equal("{}");
      store.forget();
      expect(store.load()).to.equal(null);
    });

    it("carries on when storage is blocked, as in a private window", function () {
      const blocked = {
        getItem() {
          throw new Error("denied");
        },
        setItem() {
          throw new Error("denied");
        },
        removeItem() {
          throw new Error("denied");
        },
      };
      const store = w.keystoreStore(blocked);
      expect(store.load()).to.equal(null);
      expect(store.save("{}")).to.equal(false);
      expect(store.forget()).to.equal(false);
    });

    it("tells whose wallet a file is without the passphrase", async function () {
      const { wallet, json } = await w.createLocalWallet(PASS, FAST);
      expect(w.keystoreAddress(json)).to.equal(wallet.address);
      expect(w.keystoreAddress("not json")).to.equal(null);
      expect(w.keystoreAddress("{}")).to.equal(null);
    });

    it("recognises a keystore file before asking for its passphrase", async function () {
      const { json } = await w.createLocalWallet(PASS, FAST);
      expect(w.looksLikeKeystore(json)).to.equal(true);
      for (const bad of ["", "nope", "{}", '{"version":3}', '{"address":"0x1"}', "[]", "null", "42"]) {
        expect(w.looksLikeKeystore(bad), JSON.stringify(bad)).to.equal(false);
      }
    });

    it("names the backup file after the wallet without giving the whole address away", function () {
      expect(w.backupFileName("0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).to.equal("sabha-wallet-0xf39fd6.json");
    });
  });
});

describe("sending a transaction", function () {
  let s;
  before(async () => (s = await lib("signers.js")));

  const stub = () => {
    const calls = { estimate: [], send: [] };
    const signer = {
      address: "0x0000000000000000000000000000000000000001",
      provider: "the provider",
      async estimateGas(tx) {
        calls.estimate.push(tx);
        if (signer.refuse) throw Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION" });
        return 100000n;
      },
      async sendTransaction(tx) {
        calls.send.push(tx);
        return { hash: "0xabc" };
      },
    };
    return { signer, calls };
  };

  it("estimates the gas, adds a margin and sends", async function () {
    const { signer, calls } = stub();
    await s.withTxDefaults(signer, { zeroGas: false }).sendTransaction({ to: "0x2", data: "0x" });
    expect(calls.estimate).to.have.length(1);
    expect(calls.send[0].gasLimit).to.equal(120000n);
    expect(calls.send[0]).to.not.have.property("gasPrice");
  });

  it("sends at gas price zero as a legacy transaction where gas is free", async function () {
    const { signer, calls } = stub();
    await s.withTxDefaults(signer, { zeroGas: true }).sendTransaction({ to: "0x2", data: "0x" });
    expect(calls.send[0]).to.include({ type: 0, gasPrice: 0n });
    expect(calls.estimate[0]).to.include({ type: 0, gasPrice: 0n }); // estimated the same way it will be sent
  });

  it("never opens the wallet for a transaction the chain would refuse", async function () {
    const { signer, calls } = stub();
    signer.refuse = true;
    let error;
    try {
      await s.withTxDefaults(signer, { zeroGas: true }).sendTransaction({ to: "0x2", data: "0x" });
    } catch (e) {
      error = e;
    }
    expect(error.code).to.equal("CALL_EXCEPTION");
    expect(calls.send).to.have.length(0);
  });

  it("respects a gas limit the caller already chose", async function () {
    const { signer, calls } = stub();
    await s.withTxDefaults(signer, { zeroGas: false }).sendTransaction({ to: "0x2", gasLimit: 77777n });
    expect(calls.estimate).to.have.length(0);
    expect(calls.send[0].gasLimit).to.equal(77777n);
  });

  it("passes the signer's own properties through", function () {
    const { signer } = stub();
    const wrapped = s.withTxDefaults(signer, { zeroGas: false });
    expect(wrapped.address).to.equal(signer.address);
    expect(wrapped.provider).to.equal("the provider");
  });

  it("lets a member with a few thousandths of an ether vote on a chain that charges", async function () {
    // The balance is cut to a few thousandths, so put the chain back afterwards:
    // the other test files share these accounts.
    const snapshot = await takeSnapshot();
    try {
      const [admin, member] = await ethers.getSigners();
      const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
      const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);
      await registry.enrol(member.address, ethers.id("m"));
      const now = await time.latest();
      await voting.createProposal("Q", "D", ["A", "B"], now + 1, now + 1000, 0);
      await time.increase(5);
      await setBalance(member.address, ethers.parseEther("0.005"));

      const tx = await voting.connect(s.withTxDefaults(member, { zeroGas: false })).castVote(0, 0);
      expect((await tx.wait()).status).to.equal(1);
    } finally {
      await snapshot.restore();
    }
  });
});
