const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const idHash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

const State = { Pending: 0n, Active: 1n, Closed: 2n, Finalised: 3n };

const HOUR = 60 * 60;

describe("DirectDemocracy", function () {
  async function deployFixture() {
    const [admin, alice, bob, carol, dave, outsider] = await ethers.getSigners();

    const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
    const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);

    const members = [alice, bob, carol, dave];
    await registry.enrolBatch(
      members.map((m) => m.address),
      members.map((m, i) => idHash(`25BCE${1500 + i}`))
    );

    return { registry, voting, admin, alice, bob, carol, dave, outsider, members };
  }

  async function openProposal(voting, overrides = {}) {
    const now = await time.latest();
    const opensAt = overrides.opensAt ?? now + 60;
    const closesAt = overrides.closesAt ?? opensAt + HOUR;

    const tx = await voting.createProposal(
      overrides.title ?? "Raise the annual society fee to Rs 500",
      overrides.description ?? "The fee has not changed since 2021 and the events budget is short.",
      overrides.options ?? ["For", "Against", "Abstain"],
      opensAt,
      closesAt,
      overrides.quorumBps ?? 5000
    );
    await tx.wait();
    return { opensAt, closesAt };
  }

  describe("creating a proposal", function () {
    it("registers the proposal and snapshots the electorate", async function () {
      const { voting, admin } = await loadFixture(deployFixture);
      const now = await time.latest();
      const opensAt = now + 60;
      const closesAt = opensAt + HOUR;

      await expect(
        voting.createProposal("Fee rise", "Body text", ["For", "Against"], opensAt, closesAt, 5000)
      )
        .to.emit(voting, "ProposalCreated")
        .withArgs(0, admin.address, "Fee rise", opensAt, closesAt, 5000, 4);

      const p = await voting.getProposal(0);
      expect(p.electorate).to.equal(4);
      expect(p.options).to.deep.equal(["For", "Against"]);
      expect(p.state).to.equal(State.Pending);
      expect(await voting.proposalCount()).to.equal(1);
    });

    it("refuses a proposer without the role", async function () {
      const { voting, outsider } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(
        voting
          .connect(outsider)
          .createProposal("X", "Y", ["A", "B"], now + 60, now + HOUR, 5000)
      ).to.be.revertedWithCustomError(voting, "AccessControlUnauthorizedAccount");
    });

    it("refuses a window that closes before it opens", async function () {
      const { voting } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(
        voting.createProposal("X", "Y", ["A", "B"], now + HOUR, now + 60, 5000)
      ).to.be.revertedWithCustomError(voting, "WindowInverted");
    });

    it("refuses a window that has already closed", async function () {
      const { voting } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(
        voting.createProposal("X", "Y", ["A", "B"], now - HOUR, now - 60, 5000)
      ).to.be.revertedWithCustomError(voting, "WindowInPast");
    });

    it("refuses fewer than two options", async function () {
      const { voting } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(
        voting.createProposal("X", "Y", ["Only one"], now + 60, now + HOUR, 5000)
      )
        .to.be.revertedWithCustomError(voting, "BadOptionCount")
        .withArgs(1);
    });

    it("refuses more than sixteen options", async function () {
      const { voting } = await loadFixture(deployFixture);
      const now = await time.latest();
      const options = Array.from({ length: 17 }, (_, i) => `Option ${i}`);

      await expect(
        voting.createProposal("X", "Y", options, now + 60, now + HOUR, 5000)
      ).to.be.revertedWithCustomError(voting, "BadOptionCount");
    });

    it("refuses an empty title", async function () {
      const { voting } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(
        voting.createProposal("", "Y", ["A", "B"], now + 60, now + HOUR, 5000)
      ).to.be.revertedWithCustomError(voting, "EmptyTitle");
    });

    it("refuses a quorum above 100 percent", async function () {
      const { voting } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(
        voting.createProposal("X", "Y", ["A", "B"], now + 60, now + HOUR, 10001)
      ).to.be.revertedWithCustomError(voting, "QuorumTooHigh");
    });

    it("refuses a proposal when nobody is enrolled", async function () {
      const [admin] = await ethers.getSigners();
      const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
      const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);
      const now = await time.latest();

      await expect(
        voting.createProposal("X", "Y", ["A", "B"], now + 60, now + HOUR, 5000)
      ).to.be.revertedWithCustomError(voting, "NoElectorate");
    });
  });

  describe("the voting window", function () {
    it("moves Pending to Active to Closed as time passes", async function () {
      const { voting } = await loadFixture(deployFixture);
      const { opensAt, closesAt } = await openProposal(voting);

      expect(await voting.stateOf(0)).to.equal(State.Pending);
      await time.increaseTo(opensAt);
      expect(await voting.stateOf(0)).to.equal(State.Active);
      await time.increaseTo(closesAt);
      expect(await voting.stateOf(0)).to.equal(State.Closed);
    });

    it("refuses a vote before the window opens", async function () {
      const { voting, alice } = await loadFixture(deployFixture);
      await openProposal(voting);

      await expect(voting.connect(alice).castVote(0, 0))
        .to.be.revertedWithCustomError(voting, "VotingNotOpen")
        .withArgs(0, State.Pending);
    });

    it("refuses a vote after the window closes", async function () {
      const { voting, alice } = await loadFixture(deployFixture);
      const { closesAt } = await openProposal(voting);
      await time.increaseTo(closesAt);

      await expect(voting.connect(alice).castVote(0, 0))
        .to.be.revertedWithCustomError(voting, "VotingNotOpen")
        .withArgs(0, State.Closed);
    });
  });

  describe("casting a vote", function () {
    async function activeFixture() {
      const base = await loadFixture(deployFixture);
      const { opensAt, closesAt } = await openProposal(base.voting);
      await time.increaseTo(opensAt);
      return { ...base, opensAt, closesAt };
    }

    it("records the vote, the tally and the receipt", async function () {
      const { voting, alice } = await activeFixture();

      await expect(voting.connect(alice).castVote(0, 1)).to.emit(voting, "VoteCast");

      expect(await voting.tallyOf(0)).to.deep.equal([0n, 1n, 0n]);

      const receipt = await voting.receiptOf(0, alice.address);
      expect(receipt.voted).to.equal(true);
      expect(receipt.option).to.equal(1);
      expect(receipt.blockNumber).to.be.greaterThan(0);

      const p = await voting.getProposal(0);
      expect(p.totalVotes).to.equal(1);
    });

    it("refuses a second vote from the same wallet", async function () {
      const { voting, alice } = await activeFixture();
      await voting.connect(alice).castVote(0, 0);

      await expect(voting.connect(alice).castVote(0, 1))
        .to.be.revertedWithCustomError(voting, "AlreadyVoted")
        .withArgs(0, alice.address);

      expect(await voting.tallyOf(0)).to.deep.equal([1n, 0n, 0n]);
    });

    it("refuses a wallet that is not on the roster", async function () {
      const { voting, outsider } = await activeFixture();

      await expect(voting.connect(outsider).castVote(0, 0))
        .to.be.revertedWithCustomError(voting, "NotAMember")
        .withArgs(outsider.address);
    });

    it("refuses a member suspended after the proposal opened", async function () {
      const { voting, registry, alice } = await activeFixture();
      await registry.suspend(alice.address);

      await expect(voting.connect(alice).castVote(0, 0)).to.be.revertedWithCustomError(voting, "NotAMember");
    });

    it("refuses an option index that does not exist", async function () {
      const { voting, alice } = await activeFixture();

      await expect(voting.connect(alice).castVote(0, 3))
        .to.be.revertedWithCustomError(voting, "UnknownOption")
        .withArgs(0, 3);
    });

    it("refuses a vote on a proposal that was never created", async function () {
      const { voting, alice } = await activeFixture();

      await expect(voting.connect(alice).castVote(7, 0))
        .to.be.revertedWithCustomError(voting, "UnknownProposal")
        .withArgs(7);
    });

    it("counts four members voting three different ways", async function () {
      const { voting, alice, bob, carol, dave } = await activeFixture();

      await voting.connect(alice).castVote(0, 0);
      await voting.connect(bob).castVote(0, 0);
      await voting.connect(carol).castVote(0, 1);
      await voting.connect(dave).castVote(0, 2);

      expect(await voting.tallyOf(0)).to.deep.equal([2n, 1n, 1n]);
      expect((await voting.getProposal(0)).totalVotes).to.equal(4);
    });

    it("issues a receipt hash that binds contract, chain, proposal and voter", async function () {
      const { voting, alice, bob } = await activeFixture();
      await voting.connect(alice).castVote(0, 0);

      const hash = await voting.receiptHash(0, alice.address);
      expect(hash).to.not.equal(ethers.ZeroHash);

      await expect(voting.receiptHash(0, bob.address)).to.be.revertedWithCustomError(voting, "NoReceipt");
    });
  });

  describe("finalising", function () {
    async function votedFixture(votes, quorumBps = 5000) {
      const base = await loadFixture(deployFixture);
      const { opensAt, closesAt } = await openProposal(base.voting, { quorumBps });
      await time.increaseTo(opensAt);

      for (const [signerName, option] of votes) {
        await base.voting.connect(base[signerName]).castVote(0, option);
      }
      await time.increaseTo(closesAt);
      return { ...base, closesAt };
    }

    it("publishes the winner once the window has closed", async function () {
      const { voting } = await votedFixture([
        ["alice", 0],
        ["bob", 0],
        ["carol", 1],
      ]);

      await expect(voting.finaliseProposal(0))
        .to.emit(voting, "ProposalFinalised")
        .withArgs(0, 0, 3, true, false);

      const p = await voting.getProposal(0);
      expect(p.state).to.equal(State.Finalised);
      expect(p.winningOption).to.equal(0);
      expect(p.quorumMet).to.equal(true);
      expect(p.tied).to.equal(false);
    });

    it("lets any member, not only an officer, trigger the tally", async function () {
      const { voting, outsider } = await votedFixture([
        ["alice", 0],
        ["bob", 1],
        ["carol", 1],
      ]);

      await expect(voting.connect(outsider).finaliseProposal(0)).to.emit(voting, "ProposalFinalised");
      expect((await voting.getProposal(0)).winningOption).to.equal(1);
    });

    it("flags a tie", async function () {
      const { voting } = await votedFixture([
        ["alice", 0],
        ["bob", 1],
      ]);

      await voting.finaliseProposal(0);
      expect((await voting.getProposal(0)).tied).to.equal(true);
    });

    it("flags a result that missed quorum", async function () {
      const { voting } = await votedFixture([["alice", 0]], 7500);

      await expect(voting.finaliseProposal(0))
        .to.emit(voting, "ProposalFinalised")
        .withArgs(0, 0, 1, false, false);

      expect((await voting.getProposal(0)).quorumMet).to.equal(false);
    });

    it("treats a turnout exactly on the quorum line as met", async function () {
      const { voting } = await votedFixture(
        [
          ["alice", 0],
          ["bob", 0],
        ],
        5000
      );

      await voting.finaliseProposal(0);
      expect((await voting.getProposal(0)).quorumMet).to.equal(true);
    });

    it("handles a proposal nobody voted on", async function () {
      const { voting } = await votedFixture([]);

      await voting.finaliseProposal(0);
      const p = await voting.getProposal(0);
      expect(p.totalVotes).to.equal(0);
      expect(p.quorumMet).to.equal(false);
      expect(p.tied).to.equal(true);
    });

    it("refuses to finalise while voting is still open", async function () {
      const { voting } = await loadFixture(deployFixture);
      const { opensAt } = await openProposal(voting);
      await time.increaseTo(opensAt);

      await expect(voting.finaliseProposal(0)).to.be.revertedWithCustomError(voting, "VotingStillOpen");
    });

    it("refuses a second finalisation", async function () {
      const { voting } = await votedFixture([["alice", 0]]);
      await voting.finaliseProposal(0);

      await expect(voting.finaliseProposal(0))
        .to.be.revertedWithCustomError(voting, "AlreadyFinalised")
        .withArgs(0);
    });

    it("freezes the tally after finalisation", async function () {
      const { voting, dave } = await votedFixture([["alice", 0]]);
      await voting.finaliseProposal(0);

      await expect(voting.connect(dave).castVote(0, 1))
        .to.be.revertedWithCustomError(voting, "VotingNotOpen")
        .withArgs(0, State.Finalised);
    });
  });

  describe("cancelling", function () {
    it("lets the admin withdraw a proposal before voting opens", async function () {
      const { voting, admin } = await loadFixture(deployFixture);
      await openProposal(voting);

      await expect(voting.cancelProposal(0)).to.emit(voting, "ProposalCancelled").withArgs(0, admin.address);
      expect((await voting.getProposal(0)).cancelled).to.equal(true);
    });

    it("refuses to withdraw once voting has opened", async function () {
      const { voting } = await loadFixture(deployFixture);
      const { opensAt } = await openProposal(voting);
      await time.increaseTo(opensAt);

      await expect(voting.cancelProposal(0))
        .to.be.revertedWithCustomError(voting, "CannotCancelNow")
        .withArgs(0, State.Active);
    });

    it("refuses to tally a withdrawn proposal", async function () {
      const { voting } = await loadFixture(deployFixture);
      const { closesAt } = await openProposal(voting);
      await voting.cancelProposal(0);
      await time.increaseTo(closesAt);

      await expect(voting.finaliseProposal(0)).to.be.revertedWithCustomError(voting, "ProposalIsCancelled");
    });

    it("refuses a cancellation from a non-admin", async function () {
      const { voting, alice } = await loadFixture(deployFixture);
      await openProposal(voting);

      await expect(voting.connect(alice).cancelProposal(0)).to.be.revertedWithCustomError(
        voting,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("reading the ledger", function () {
    it("pages proposals newest first", async function () {
      const { voting } = await loadFixture(deployFixture);
      await openProposal(voting, { title: "First" });
      await openProposal(voting, { title: "Second" });
      await openProposal(voting, { title: "Third" });

      const page = await voting.listProposals(0, 2);
      expect(page.map((p) => p.title)).to.deep.equal(["Third", "Second"]);
      expect(page[0].id).to.equal(2);

      const next = await voting.listProposals(2, 2);
      expect(next.map((p) => p.title)).to.deep.equal(["First"]);
    });

    it("returns an empty page past the end", async function () {
      const { voting } = await loadFixture(deployFixture);
      await openProposal(voting);

      expect(await voting.listProposals(5, 10)).to.deep.equal([]);
    });

    it("rejects a read of a proposal that does not exist", async function () {
      const { voting } = await loadFixture(deployFixture);
      await expect(voting.getProposal(0)).to.be.revertedWithCustomError(voting, "UnknownProposal");
    });

    it("lets an auditor rebuild the tally from VoteCast events alone", async function () {
      const { voting, alice, bob, carol } = await loadFixture(deployFixture);
      const { opensAt } = await openProposal(voting);
      await time.increaseTo(opensAt);

      await voting.connect(alice).castVote(0, 0);
      await voting.connect(bob).castVote(0, 2);
      await voting.connect(carol).castVote(0, 0);

      const logs = await voting.queryFilter(voting.filters.VoteCast(0));
      const rebuilt = [0n, 0n, 0n];
      for (const log of logs) {
        rebuilt[Number(log.args.option)] += 1n;
      }

      expect(rebuilt).to.deep.equal(await voting.tallyOf(0));
    });
  });
});
