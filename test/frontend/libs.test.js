const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const path = require("path");
const { pathToFileURL } = require("url");

const lib = (name) => import(pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "lib", name)).href);
const fixture = require("./fixtures/qbft-header.json");

// The four validators that besu/arrange.mjs generated for the rig the fixture came from.
const VALIDATORS = [
  "0x13adc2fa9f1348382c2ea9f259ae2685bdc6e5c1",
  "0x39ee95fb0a3cbd80017034ea1ce280aef5561ba0",
  "0x884d1b71368703e3c58ac83a5a3c653737629cd0",
  "0xc3389f0a2c22cc27abaf903a076709d8c645b843",
].map((a) => ethers.getAddress(a));

describe("formatting", function () {
  let f;
  before(async () => (f = await lib("format.js")));

  it("shortens an address and leaves a short value alone", function () {
    expect(f.shorten("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).to.equal("0xf39F…2266");
    expect(f.shorten("0x1234")).to.equal("0x1234");
    expect(f.shorten(undefined)).to.equal("");
  });

  it("writes numbers and percentages for each language", function () {
    expect(f.formatNumber(1234567, "en")).to.equal("12,34,567"); // Indian grouping, as the audience reads it
    for (const lang of ["en", "hi", "ta"]) {
      expect(f.formatNumber(106302, lang), lang).to.match(/106|1,06|1,06,302/);
      expect(f.formatPercent(38, lang), lang).to.match(/38/);
    }
  });

  it("writes a countdown in each language, with the digits and a unit", function () {
    for (const lang of ["en", "hi", "ta"]) {
      const text = f.formatUnits([["day", 2], ["hour", 3]], lang);
      expect(text, lang).to.match(/2/);
      expect(text, lang).to.match(/3/);
      expect(text.length, lang).to.be.greaterThan(4);
    }
  });

  it("writes a moment, and nothing for no moment", function () {
    expect(f.formatDateTime(1792700000, "en")).to.match(/2026/);
    expect(f.formatDateTime(0, "en")).to.equal("");
    expect(f.formatDateTime(null, "hi")).to.equal("");
    expect(f.formatDate(undefined, "ta")).to.equal("");
  });

  it("writes block times and ages", function () {
    expect(f.formatSeconds(2, "en")).to.match(/2/);
    expect(f.formatSeconds(65, "en")).to.match(/1.*5/);
    expect(f.formatAgo(100, 130, "en")).to.match(/30/);
    expect(f.formatAgo(100, 100 + 7200, "en")).to.match(/2/);
  });
});

describe("explaining an error", function () {
  let errors, iface;
  before(async () => {
    errors = await lib("errors.js");
    const abi = [...require("../../frontend/src/chain/abi/DirectDemocracy.json"), ...require("../../frontend/src/chain/abi/MemberRegistry.json")];
    iface = new ethers.Interface(abi);
  });

  const encoded = (name, args) => iface.encodeErrorResult(name, args);
  const A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  describe("what a contract refused", function () {
    it("finds the revert wherever each thrower puts it", function () {
      const data = encoded("AlreadyVoted", [3, A]);
      for (const [where, error] of [
        ["top level", { data }],
        ["info.error", { info: { error: { data } } }],
        ["info.error.data.data", { info: { error: { data: { data } } } }],
        ["error.data", { error: { data } }],
        ["cause", { cause: { data } }],
        ["a wallet's wrapped error", { code: -32603, data: { originalError: { data } } }],
      ]) {
        const d = errors.decodeError(error);
        expect(d.key, where).to.equal("errors.AlreadyVoted");
        expect(d.params.ballot, where).to.equal("3");
        expect(d.kind, where).to.equal("contract");
      }
    });

    it("says which stage a closed door is in", function () {
      for (const [stage, name] of [[0, "pending"], [2, "closed"], [3, "finalised"]]) {
        const d = errors.decodeError({ data: encoded("VotingNotOpen", [1, stage]) });
        expect(d.key).to.equal(`errors.VotingNotOpen.${name}`);
      }
    });

    it("decodes every custom error the contracts can raise", function () {
      const cases = {
        AlreadyVoted: [0, A], NotAMember: [A], VotingNotOpen: [0, 1], UnknownOption: [0, 9], UnknownProposal: [5],
        VotingStillOpen: [0, 100], AlreadyFinalised: [0], ProposalIsCancelled: [0], CannotCancelNow: [0, 1], NoReceipt: [0, A],
        WindowInPast: [1, 2], WindowInverted: [2, 1], BadOptionCount: [1], EmptyTitle: [], QuorumTooHigh: [10001], NoElectorate: [],
        AccessControlUnauthorizedAccount: [A, ethers.ZeroHash], AlreadyEnrolled: [A], IdentifierAlreadyUsed: [ethers.id("x"), A],
        NotEnrolled: [A], AlreadyActive: [A], AlreadySuspended: [A], EmptyIdentifier: [], LengthMismatch: [],
      };
      for (const [name, args] of Object.entries(cases)) {
        const d = errors.decodeError({ data: encoded(name, args) });
        expect(d.kind, name).to.equal("contract");
        expect(d.key, name).to.match(/^errors\./);
        expect(d.key, name).to.not.equal("errors.reverted");
        expect(d.key, name).to.not.equal("errors.unknown");
      }
    });

    it("covers every custom error in the ABIs, so a new one cannot slip through unexplained", function () {
      const all = [...require("../../frontend/src/chain/abi/DirectDemocracy.json"), ...require("../../frontend/src/chain/abi/MemberRegistry.json")]
        .filter((i) => i.type === "error")
        .map((i) => i.name);
      const missing = [...new Set(all)].filter((name) => {
        const args = iface.getError(name).inputs.map((i) => (i.type === "address" ? A : i.type === "bytes32" ? ethers.ZeroHash : i.type.startsWith("uint") ? 1 : i.type === "uint8" ? 1 : 0));
        const d = errors.decodeError({ data: iface.encodeErrorResult(name, args) });
        return d.key === "errors.reverted" || d.key === "errors.unknown";
      });
      expect(missing).to.deep.equal([]);
    });

    it("reads the message Hardhat's own node writes", function () {
      const d = errors.decodeError(new Error(`VM Exception while processing transaction: reverted with custom error 'AlreadyVoted(5, "${A}")'`));
      expect(d.key).to.equal("errors.AlreadyVoted");
    });

    it("explains real refusals from the real contract", async function () {
      const [admin, alice, outsider] = await ethers.getSigners();
      const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
      const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);
      await registry.enrol(alice.address, ethers.id("alice"));
      const now = await time.latest();
      await voting.createProposal("Q", "D", ["A", "B"], now + 100, now + 1000, 0);

      const attempt = async (promise) => {
        try {
          await promise;
        } catch (error) {
          return errors.decodeError(error);
        }
        throw new Error("expected a refusal");
      };

      expect((await attempt(voting.connect(alice).castVote(0, 0))).key).to.equal("errors.VotingNotOpen.pending");
      await time.increase(200);
      expect((await attempt(voting.connect(outsider).castVote(0, 0))).key).to.equal("errors.NotAMember");
      expect((await attempt(voting.connect(alice).castVote(0, 7))).key).to.equal("errors.UnknownOption");
      await voting.connect(alice).castVote(0, 0);
      expect((await attempt(voting.connect(alice).castVote(0, 1))).key).to.equal("errors.AlreadyVoted");
      expect((await attempt(voting.connect(outsider).createProposal("x", "y", ["a", "b"], now + 1, now + 9999, 0))).key).to.equal(
        "errors.AccessControlUnauthorizedAccount"
      );
      expect((await attempt(voting.finaliseProposal(0))).key).to.equal("errors.VotingStillOpen");
    });
  });

  describe("everything else that goes wrong", function () {
    it("recognises a member declining in their wallet, in each shape wallets use", function () {
      for (const error of [{ code: "ACTION_REJECTED" }, { code: 4001 }, { info: { error: { code: 4001 } } }, new Error("User rejected the request.")]) {
        expect(errors.decodeError(error).key).to.equal("errors.walletRejected");
      }
    });

    it("recognises the public endpoint saying slow down", function () {
      expect(errors.decodeError({ info: { error: { code: -32005, message: "Too many requests." } } }).key).to.equal("errors.rateLimited");
      expect(errors.decodeError(new Error("429 Too Many Requests")).key).to.equal("errors.rateLimited");
    });

    it("recognises a wallet with nothing to pay with", function () {
      expect(errors.decodeError({ code: "INSUFFICIENT_FUNDS" }).key).to.equal("errors.noFunds");
      expect(errors.decodeError(new Error("Sender doesn't have enough funds to send tx.")).key).to.equal("errors.noFunds");
    });

    it("recognises a stale nonce, a wrong network and an unreachable node", function () {
      expect(errors.decodeError({ code: "NONCE_EXPIRED" }).key).to.equal("errors.nonce");
      expect(errors.decodeError(new Error("nonce too low")).key).to.equal("errors.nonce");
      expect(errors.decodeError(new Error("network changed: 1 => 40717")).key).to.equal("errors.wrongNetwork");
      expect(errors.decodeError(new Error("Unrecognized chain ID")).key).to.equal("errors.wrongNetwork");
      expect(errors.decodeError(new Error("failed to fetch")).key).to.equal("errors.unreachable");
      expect(errors.decodeError({ code: "TIMEOUT" }).key).to.equal("errors.unreachable");
    });

    it("says a revert is a revert when it cannot say more", function () {
      expect(errors.decodeError({ code: "CALL_EXCEPTION" }).key).to.equal("errors.reverted");
      expect(errors.decodeError(new Error("execution reverted")).key).to.equal("errors.reverted");
    });

    it("keeps the original message for a details panel, and never throws on odd input", function () {
      expect(errors.decodeError(new Error("something odd")).technical).to.equal("something odd");
      for (const odd of [undefined, null, "text", 42, {}, [], { message: 5 }]) {
        const d = errors.decodeError(odd);
        expect(d.key).to.match(/^errors\./);
        expect(d.technical).to.be.a("string");
      }
    });

    it("does not mistake an unknown custom error for one it can explain", function () {
      // said to have reverted: a revert it cannot name
      expect(errors.decodeError(new Error("reverted with custom error 'NotARealError()'")).key).to.equal("errors.reverted");
      // nothing says it reverted at all: unknown, not a guess
      expect(errors.decodeError(new Error("custom error 'NotARealError()'")).key).to.equal("errors.unknown");
    });

    it("handles an error that refers to itself without looping", function () {
      const loop = { code: "X" };
      loop.cause = loop;
      loop.info = { error: loop };
      expect(() => errors.decodeError(loop)).to.not.throw();
    });
  });
});

describe("following a transaction", function () {
  let tx;
  before(async () => (tx = await lib("tx.js")));

  const recorder = () => {
    const seen = [];
    return { seen, onUpdate: (s) => seen.push(s.phase) };
  };

  it("reports wallet, pending, confirmed, in that order, with the block and gas", async function () {
    const { seen, onUpdate } = recorder();
    const result = await tx.trackTransaction(
      async () => ({ hash: "0xabc", wait: async () => ({ blockNumber: 12n, gasUsed: 106302n, gasPrice: 0n }) }),
      onUpdate
    );
    expect(seen).to.deep.equal(["wallet", "pending", "confirmed"]);
    expect(result).to.include({ phase: "confirmed", hash: "0xabc", blockNumber: 12 });
    expect(result.gasUsed).to.equal(106302n);
    expect(result.fee).to.equal(0n);
  });

  it("works out the fee from the gas used and the price paid", async function () {
    const result = await tx.trackTransaction(async () => ({ hash: "0x1", wait: async () => ({ blockNumber: 1, gasUsed: 100n, gasPrice: 7n }) }));
    expect(result.fee).to.equal(700n);
  });

  it("reports a refusal before anything was sent, with no hash", async function () {
    const { seen, onUpdate } = recorder();
    const result = await tx.trackTransaction(async () => {
      throw { code: "ACTION_REJECTED" };
    }, onUpdate);
    expect(seen).to.deep.equal(["wallet", "failed"]);
    expect(result.phase).to.equal("failed");
    expect(result.hash).to.equal(undefined);
    expect(result.error.key).to.equal("errors.walletRejected");
  });

  it("reports a transaction that was mined and reverted, with its block", async function () {
    const result = await tx.trackTransaction(async () => ({
      hash: "0xdead",
      wait: async () => {
        throw Object.assign(new Error("transaction execution reverted"), { code: "CALL_EXCEPTION", receipt: { blockNumber: 9n, gasUsed: 21000n } });
      },
    }));
    expect(result).to.include({ phase: "failed", hash: "0xdead", blockNumber: 9 });
    expect(result.error.key).to.equal("errors.reverted");
  });

  it("never throws, whatever the runner does", async function () {
    for (const run of [async () => undefined, async () => ({}), () => {
      throw new Error("sync");
    }]) {
      const result = await tx.trackTransaction(run);
      expect(result.phase).to.equal("failed");
    }
  });

  it("follows a real vote on a real chain", async function () {
    const [admin, alice] = await ethers.getSigners();
    const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
    const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);
    await registry.enrol(alice.address, ethers.id("alice"));
    const now = await time.latest();
    await voting.createProposal("Q", "D", ["A", "B"], now + 1, now + 1000, 0);
    await time.increase(5);

    const { seen, onUpdate } = recorder();
    const result = await tx.trackTransaction(() => voting.connect(alice).castVote(0, 1), onUpdate);

    expect(seen).to.deep.equal(["wallet", "pending", "confirmed"]);
    expect(result.hash).to.match(/^0x[0-9a-f]{64}$/);
    expect(result.gasUsed).to.be.greaterThan(50000n);
    expect(result.blockNumber).to.be.greaterThan(0);
    expect(await voting.tallyOf(0)).to.deep.equal([0n, 1n]);
  });
});

describe("reading logs across many blocks", function () {
  let logs;
  before(async () => (logs = await lib("logs.js")));

  it("cuts a range into ordered, gap-free, overlap-free pieces", function () {
    expect(logs.blockRanges(0, 9, 4)).to.deep.equal([[0, 3], [4, 7], [8, 9]]);
    expect(logs.blockRanges(5, 5, 100)).to.deep.equal([[5, 5]]);
    expect(logs.blockRanges(10, 5, 4)).to.deep.equal([]);
    expect(logs.blockRanges(0, 5, 0)).to.deep.equal([]);
    const pieces = logs.blockRanges(3, 1003, 250);
    expect(pieces[0][0]).to.equal(3);
    expect(pieces[pieces.length - 1][1]).to.equal(1003);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0]).to.equal(pieces[i - 1][1] + 1);
  });

  const fakeProvider = ({ limit, head, logAt }) => {
    const calls = [];
    return {
      calls,
      getBlockNumber: async () => head,
      getLogs: async ({ fromBlock, toBlock }) => {
        calls.push([fromBlock, toBlock]);
        if (limit && toBlock - fromBlock + 1 > limit) throw new Error(`query exceeds max block range ${limit}`);
        return logAt.filter((n) => n >= fromBlock && n <= toBlock).map((n) => ({ blockNumber: n }));
      },
    };
  };

  it("returns every log once, in order, from the first block to the latest", async function () {
    const provider = fakeProvider({ head: 95, logAt: [0, 3, 4, 49, 50, 51, 95] });
    const got = await logs.getLogsChunked(provider, {}, { from: 0, chunk: 10 });
    expect(got.map((l) => l.blockNumber)).to.deep.equal([0, 3, 4, 49, 50, 51, 95]);
  });

  it("halves its pieces when a node says they are too big, and still finds everything", async function () {
    const provider = fakeProvider({ limit: 300, head: 4000, logAt: [10, 1999, 2000, 3999] });
    const got = await logs.getLogsChunked(provider, {}, { from: 0, chunk: 2000 });
    expect(got.map((l) => l.blockNumber)).to.deep.equal([10, 1999, 2000, 3999]);
    expect(provider.calls.filter(([a, b]) => b - a + 1 > 300)).to.have.length.greaterThan(0); // it tried the big one first
    expect(Math.max(...provider.calls.slice(-5).map(([a, b]) => b - a + 1))).to.be.at.most(300);
  });

  it("gives up on an error that is not about size", async function () {
    const provider = { getBlockNumber: async () => 10, getLogs: async () => Promise.reject(new Error("connection refused")) };
    let message;
    try {
      await logs.getLogsChunked(provider, {}, { from: 0, chunk: 5 });
    } catch (error) {
      message = error.message;
    }
    expect(message).to.equal("connection refused");
  });

  it("reports progress up to the whole range", async function () {
    const provider = fakeProvider({ head: 99, logAt: [] });
    const reports = [];
    await logs.getLogsChunked(provider, {}, { from: 0, chunk: 25, onProgress: (p) => reports.push(p.done) });
    expect(reports).to.deep.equal([25, 50, 75, 100]);
  });

  it("reads the same events a single query would, from a real chain", async function () {
    const [admin, a, b, c] = await ethers.getSigners();
    const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
    const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);
    await registry.enrolBatch([a.address, b.address, c.address], [ethers.id("a"), ethers.id("b"), ethers.id("c")]);
    const now = await time.latest();
    await voting.createProposal("Q", "D", ["A", "B"], now + 1, now + 100000, 0);
    await time.increase(5);
    for (const [signer, option] of [[a, 0], [b, 1], [c, 1]]) {
      await voting.connect(signer).castVote(0, option);
      await ethers.provider.send("hardhat_mine", ["0x4"]); // empty blocks between the votes
    }

    const filter = { address: await voting.getAddress(), topics: [voting.interface.getEvent("VoteCast").topicHash] };
    const whole = await ethers.provider.getLogs({ ...filter, fromBlock: 0, toBlock: "latest" });
    const pieced = await logs.getLogsChunked(ethers.provider, filter, { from: 0, chunk: 3 });
    expect(pieced.map((l) => l.transactionHash)).to.deep.equal(whole.map((l) => l.transactionHash));
    expect(pieced).to.have.length(3);
  });
});

describe("reading a QBFT block header", function () {
  let q;
  before(async () => (q = await lib("qbft.js")));

  it("finds the four validators in the genesis block", function () {
    const d = q.decodeQbftExtraData(fixture.genesisExtra);
    expect(d.validators.slice().sort()).to.deep.equal(VALIDATORS.slice().sort());
    expect(d.sealCount).to.equal(0);
    expect(d.round).to.equal(0);
  });

  it("finds the same four in a later block, and the seals that committed it", function () {
    const d = q.decodeQbftExtraData(fixture.block.extraData);
    expect(d.validators.slice().sort()).to.deep.equal(VALIDATORS.slice().sort());
    expect(d.sealCount).to.be.at.least(3); // 2f+1 of 4
  });

  it("reads the client version Besu writes into the vanity", function () {
    expect(q.decodeQbftExtraData(fixture.block.extraData).client).to.match(/besu 26\.10\.1/);
    expect(q.decodeQbftExtraData(fixture.genesisExtra).client).to.equal("");
  });

  it("agrees with the block's proposer being one of the validators", function () {
    expect(VALIDATORS).to.include(ethers.getAddress(fixture.block.miner));
  });

  it("refuses data that is not a QBFT header, without a crash", function () {
    expect(() => q.decodeQbftExtraData("0x")).to.throw(/not RLP/);
    expect(() => q.decodeQbftExtraData("0x" + "00".repeat(40))).to.throw(/not RLP/);
    expect(() => q.decodeQbftExtraData("0xc0")).to.throw(/validator list/); // an empty list
    expect(() => q.decodeQbftExtraData("0xc3010203")).to.throw(/validator list/); // a list of bytes, not a header
    expect(() => q.decodeQbftExtraData("not hex")).to.throw();
  });

  it("averages block times, whichever way round the blocks arrive", function () {
    expect(q.averageBlockTime([{ number: 3, timestamp: 106 }, { number: 1, timestamp: 100 }, { number: 2, timestamp: 102 }])).to.equal(3);
    expect(q.averageBlockTime([{ number: 1, timestamp: 100 }])).to.equal(null);
    expect(q.averageBlockTime([])).to.equal(null);
  });

  it("counts proposals per validator", function () {
    const counts = q.proposerCounts([{ miner: "0xa" }, { miner: "0xb" }, { miner: "0xa" }, { miner: null }]);
    expect(counts).to.deep.equal([{ address: "0xa", count: 2 }, { address: "0xb", count: 1 }]);
  });
});
