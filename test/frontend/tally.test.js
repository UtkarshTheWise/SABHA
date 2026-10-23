const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const path = require("path");
const { pathToFileURL } = require("url");

const lib = (name) => import(pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "lib", name)).href);

// A small seeded generator, so a failing case can be reproduced.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("counting rules, in the page", function () {
  let tally, proposal;
  before(async function () {
    tally = await lib("tally.js");
    proposal = await lib("proposal.js");
  });

  describe("who is ahead", function () {
    it("finds a single leader", function () {
      expect(tally.leaders([1, 4, 2])).to.deep.equal({ max: 4, indexes: [1] });
    });

    it("finds every option that shares the top count", function () {
      expect(tally.leaders([3, 1, 3])).to.deep.equal({ max: 3, indexes: [0, 2] });
      expect(tally.isTied([3, 1, 3])).to.equal(true);
    });

    it("says nobody leads when nobody voted, and calls that tied as the contract does", function () {
      expect(tally.leaders([0, 0, 0])).to.deep.equal({ max: 0, indexes: [] });
      expect(tally.isTied([0, 0, 0])).to.equal(true);
    });

    it("is not tied when a lone option leads from behind the first", function () {
      expect(tally.isTied([0, 0, 3])).to.equal(false);
      expect(tally.isTied([0, 5, 0])).to.equal(false);
    });

    it("accepts the BigInt counts ethers returns", function () {
      expect(tally.leaders([1n, 3n, 2n]).indexes).to.deep.equal([1]);
      expect(tally.totalOf([1n, 3n, 2n])).to.equal(6);
    });
  });

  describe("shares", function () {
    it("rounds to whole percent and never divides by zero", function () {
      expect(tally.share(1, 3)).to.equal(33);
      expect(tally.share(2, 3)).to.equal(67);
      expect(tally.share(0, 0)).to.equal(0);
      expect(tally.share(5, 5)).to.equal(100);
    });
  });

  describe("how many votes make the result count", function () {
    it("rounds up, never down", function () {
      expect(tally.quorumNeeded(3, 6666)).to.equal(2); // 1.9998
      expect(tally.quorumNeeded(7, 3333)).to.equal(3); // 2.3331
      expect(tally.quorumNeeded(8, 6000)).to.equal(5); // 4.8
    });

    it("is exact when the product is a whole number", function () {
      expect(tally.quorumNeeded(10, 5000)).to.equal(5);
      expect(tally.quorumNeeded(4, 5000)).to.equal(2);
      expect(tally.quorumNeeded(8, 2500)).to.equal(2);
      expect(tally.quorumNeeded(20, 10000)).to.equal(20);
    });

    it("always asks for at least one vote, even with no quorum set", function () {
      expect(tally.quorumNeeded(8, 0)).to.equal(1);
      expect(tally.quorumNeeded(0, 5000)).to.equal(1);
    });

    it("agrees with the contract's own test, at the line and either side of it", function () {
      for (const [electorate, bps, votes] of [[4, 5000, 1], [4, 5000, 2], [3, 6666, 1], [3, 6666, 2], [10, 3333, 3], [10, 3333, 4]]) {
        const needed = tally.quorumNeeded(electorate, bps);
        expect(tally.quorumMet(votes, electorate, bps), `${votes} of ${electorate} at ${bps}`).to.equal(votes >= needed);
      }
    });

    it("never counts an empty ballot as meeting quorum", function () {
      expect(tally.quorumMet(0, 8, 0)).to.equal(false);
    });
  });

  describe("recounting from the log", function () {
    const a = "0x00000000000000000000000000000000000000a1";
    const b = "0x00000000000000000000000000000000000000b2";

    it("rebuilds a tally from events", function () {
      const r = tally.recount([{ voter: a, option: 0 }, { voter: b, option: 2 }], 3);
      expect(r.tally).to.deep.equal([1, 0, 1]);
      expect(r.voters).to.equal(2);
    });

    it("accepts BigInt option numbers as ethers logs carry them", function () {
      expect(tally.recount([{ voter: a, option: 1n }], 2).tally).to.deep.equal([0, 1]);
    });

    it("reports a voter who appears twice instead of counting them twice", function () {
      const r = tally.recount([{ voter: a, option: 0 }, { voter: a.toUpperCase().replace("0X", "0x"), option: 1 }], 2);
      expect(r.tally).to.deep.equal([1, 0]);
      expect(r.duplicates).to.have.length(1);
    });

    it("reports an option that cannot exist, and does not throw", function () {
      const r = tally.recount([{ voter: a, option: 7 }, { voter: b, option: -1 }, { voter: "0xc", option: 1.5 }], 3);
      expect(r.tally).to.deep.equal([0, 0, 0]);
      expect(r.outOfRange).to.have.length(3);
    });

    it("returns an empty tally for an empty log", function () {
      expect(tally.recount([], 3)).to.deep.equal({ tally: [0, 0, 0], voters: 0, duplicates: [], outOfRange: [] });
    });

    it("compares tallies by value, across number and BigInt", function () {
      expect(tally.sameTally([1, 2], [1n, 2n])).to.equal(true);
      expect(tally.sameTally([1, 2], [2, 1])).to.equal(false);
      expect(tally.sameTally([1], [1, 0])).to.equal(false);
    });
  });

  describe("the ballot's life", function () {
    const base = { cancelled: false, finalised: false, state: 1, opensAt: 1000, closesAt: 2000, createdAt: 900 };

    it("follows the clock through pending, active and closed", function () {
      expect(proposal.stageOf(base, 999)).to.equal("pending");
      expect(proposal.stageOf(base, 1000)).to.equal("active");
      expect(proposal.stageOf(base, 1999)).to.equal("active");
      expect(proposal.stageOf(base, 2000)).to.equal("closed");
    });

    it("takes finalised and withdrawn from the contract, whatever the clock says", function () {
      expect(proposal.stageOf({ ...base, finalised: true }, 1500)).to.equal("finalised");
      expect(proposal.stageOf({ ...base, state: 3 }, 1500)).to.equal("finalised");
      expect(proposal.stageOf({ ...base, cancelled: true }, 1500)).to.equal("withdrawn");
    });

    it("marks what is done, current and still to come", function () {
      const states = (now, extra = {}) => proposal.timeline({ ...base, ...extra }, now).steps.map((s) => s.state);
      expect(states(500)).to.deep.equal(["current", "next", "next", "next"]);
      expect(states(1500)).to.deep.equal(["done", "current", "next", "next"]);
      expect(states(2500)).to.deep.equal(["done", "done", "current", "next"]);
      expect(states(2500, { finalised: true })).to.deep.equal(["done", "done", "done", "done"]);
    });

    it("gives a withdrawn ballot no steps to walk", function () {
      expect(proposal.timeline({ ...base, cancelled: true }, 1500)).to.deep.equal({ stage: "withdrawn", steps: [] });
    });

    it("counts down to the next change and then stops", function () {
      expect(proposal.secondsToNextChange(base, 400)).to.equal(600);
      expect(proposal.secondsToNextChange(base, 1500)).to.equal(500);
      expect(proposal.secondsToNextChange(base, 2500)).to.equal(null);
    });

    it("splits a duration and shows the two largest units", function () {
      expect(proposal.splitDuration(90061)).to.deep.equal({ days: 1, hours: 1, minutes: 1, seconds: 1 });
      expect(proposal.countdownUnits(90061)).to.deep.equal([["day", 1], ["hour", 1]]);
      expect(proposal.countdownUnits(3 * 3600 + 20 * 60)).to.deep.equal([["hour", 3], ["minute", 20]]);
      expect(proposal.countdownUnits(5 * 60)).to.deep.equal([["minute", 5]]);
      expect(proposal.countdownUnits(20)).to.deep.equal([["minute", 0]]);
      expect(proposal.countdownUnits(-5)).to.deep.equal([["minute", 0]]);
    });
  });

  describe("what a result means", function () {
    const ballot = (over) => ({
      options: ["For", "Against", "Abstain"], tally: [0, 0, 0], totalVotes: 0, electorate: 8, quorumBps: 5000,
      finalised: false, tied: false, winningOption: 0, cancelled: false, quorumMet: false, ...over,
    });

    it("previews the leader of a ballot not yet counted", function () {
      const o = proposal.outcomeOf(ballot({ tally: [3, 1, 0], totalVotes: 4 }));
      expect(o.kind).to.equal("counting");
      expect(o.winner).to.equal(0);
      expect(o.quorumMet).to.equal(true);
    });

    it("does not name a preview leader when options are level", function () {
      expect(proposal.outcomeOf(ballot({ tally: [2, 2, 0], totalVotes: 4 })).winner).to.equal(null);
    });

    it("says carried when counted, ahead, with quorum", function () {
      const o = proposal.outcomeOf(ballot({ finalised: true, tally: [3, 1, 0], totalVotes: 4, winningOption: 0, quorumMet: true }));
      expect(o).to.include({ kind: "carried", winner: 0 });
    });

    it("says advisory when ahead but turnout missed the quorum", function () {
      const o = proposal.outcomeOf(ballot({ finalised: true, tally: [2, 0, 0], totalVotes: 2, winningOption: 0 }));
      expect(o).to.include({ kind: "advisory", winner: 0, quorumMet: false, needed: 4 });
    });

    it("says tied, with no winner, however the quorum fared", function () {
      const o = proposal.outcomeOf(ballot({ finalised: true, tally: [2, 2, 0], totalVotes: 4, tied: true }));
      expect(o).to.include({ kind: "tied", winner: null });
    });

    it("says nobody voted, rather than tied, for an empty ballot", function () {
      const o = proposal.outcomeOf(ballot({ finalised: true, tied: true }));
      expect(o).to.include({ kind: "no_votes", winner: null });
    });

    it("measures turnout against the electorate fixed at creation", function () {
      expect(proposal.turnoutOf(ballot({ totalVotes: 3, electorate: 8 }))).to.deep.equal({ total: 3, electorate: 8, needed: 4, percent: 38, quorumPercent: 50 });
    });
  });

  describe("agreeing with the contract", function () {
    // The page's rules and the chain's must never disagree about who won.
    it("matches finaliseProposal on random ballots", async function () {
      this.timeout(120000);
      const signers = await ethers.getSigners();
      const rand = mulberry32(20261023);
      const bpsChoices = [0, 1, 2500, 3333, 5000, 6666, 6667, 10000];
      const disagreements = [];

      for (let round = 0; round < 40; round++) {
        const electorate = 3 + Math.floor(rand() * 12);
        const optionCount = 2 + Math.floor(rand() * 4);
        const bps = bpsChoices[Math.floor(rand() * bpsChoices.length)];

        const registry = await ethers.deployContract("MemberRegistry", [signers[0].address]);
        const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), signers[0].address]);
        const members = signers.slice(1, 1 + electorate);
        await registry.enrolBatch(members.map((m) => m.address), members.map((m) => ethers.id(`m${round}-${m.address}`)));

        const now = await time.latest();
        await voting.createProposal("Q", "D", Array.from({ length: optionCount }, (_, i) => `o${i}`), now + 5, now + 600, bps);
        await time.increase(10);
        // each member votes with some probability, so turnout straddles the quorum
        const turnout = rand();
        for (const m of members) {
          if (rand() < turnout) await voting.connect(m).castVote(0, Math.floor(rand() * optionCount));
        }
        await time.increase(700);
        await voting.finaliseProposal(0);

        const chain = await voting.getProposal(0);
        const mine = proposal.outcomeOf({
          options: [...chain.options], tally: chain.tally.map(Number), totalVotes: Number(chain.totalVotes),
          electorate: Number(chain.electorate), quorumBps: Number(chain.quorumBps), finalised: true,
          tied: chain.tied, winningOption: Number(chain.winningOption), cancelled: chain.cancelled,
        });

        const expectTied = tally.isTied(chain.tally.map(Number));
        const expectedNeeded = tally.quorumNeeded(Number(chain.electorate), Number(chain.quorumBps));
        const problems = [];
        if (expectTied !== chain.tied) problems.push(`tied: page ${expectTied}, chain ${chain.tied}`);
        if (tally.quorumMet(Number(chain.totalVotes), Number(chain.electorate), bps) !== chain.quorumMet) problems.push("quorumMet differs");
        if ((Number(chain.totalVotes) >= expectedNeeded) !== chain.quorumMet) problems.push(`needed ${expectedNeeded} disagrees with the chain's quorum test`);
        if (!chain.tied && tally.leaders(chain.tally.map(Number)).indexes[0] !== Number(chain.winningOption)) problems.push("winner differs");
        if (mine.kind === "carried" && !chain.quorumMet) problems.push("said carried without quorum");
        if (problems.length) disagreements.push({ round, electorate, bps, tally: chain.tally.map(Number), problems });
      }
      expect(disagreements, JSON.stringify(disagreements, null, 1)).to.deep.equal([]);
    });
  });
});
