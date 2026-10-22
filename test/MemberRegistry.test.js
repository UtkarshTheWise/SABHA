const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const idHash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

describe("MemberRegistry", function () {
  async function deployFixture() {
    const [admin, registrar, alice, bob, carol, outsider] = await ethers.getSigners();
    const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
    return { registry, admin, registrar, alice, bob, carol, outsider };
  }

  describe("deployment", function () {
    it("gives the admin both the admin and registrar roles", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
      const REGISTRAR_ROLE = await registry.REGISTRAR_ROLE();

      expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true);
      expect(await registry.hasRole(REGISTRAR_ROLE, admin.address)).to.equal(true);
    });

    it("starts with an empty roster", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.rosterLength()).to.equal(0);
      expect(await registry.activeMemberCount()).to.equal(0);
    });
  });

  describe("enrolment", function () {
    it("enrols a member and emits the event", async function () {
      const { registry, alice } = await loadFixture(deployFixture);
      const h = idHash("25BCE1508");

      await expect(registry.enrol(alice.address, h))
        .to.emit(registry, "MemberEnrolled")
        .withArgs(alice.address, h, anyUint64());

      expect(await registry.isActiveMember(alice.address)).to.equal(true);
      expect(await registry.activeMemberCount()).to.equal(1);
      expect(await registry.addressOfIdentifier(h)).to.equal(alice.address);
    });

    it("stores the identifier as a hash, never the raw value", async function () {
      const { registry, alice } = await loadFixture(deployFixture);
      const raw = "25BCE1508";
      await registry.enrol(alice.address, idHash(raw));

      const member = await registry.memberOf(alice.address);
      expect(member.memberIdHash).to.equal(idHash(raw));
      expect(member.memberIdHash).to.not.equal(ethers.hexlify(ethers.toUtf8Bytes(raw.padEnd(32, "\0"))));
    });

    it("refuses a second enrolment of the same wallet", async function () {
      const { registry, alice } = await loadFixture(deployFixture);
      await registry.enrol(alice.address, idHash("A"));

      await expect(registry.enrol(alice.address, idHash("B")))
        .to.be.revertedWithCustomError(registry, "AlreadyEnrolled")
        .withArgs(alice.address);
    });

    it("refuses two wallets claiming the same identifier", async function () {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      const h = idHash("25BCE1508");
      await registry.enrol(alice.address, h);

      await expect(registry.enrol(bob.address, h))
        .to.be.revertedWithCustomError(registry, "IdentifierAlreadyUsed")
        .withArgs(h, alice.address);
    });

    it("refuses an empty identifier", async function () {
      const { registry, alice } = await loadFixture(deployFixture);
      await expect(registry.enrol(alice.address, ethers.ZeroHash)).to.be.revertedWithCustomError(
        registry,
        "EmptyIdentifier"
      );
    });

    it("refuses enrolment from an account without the registrar role", async function () {
      const { registry, outsider, alice } = await loadFixture(deployFixture);
      await expect(
        registry.connect(outsider).enrol(alice.address, idHash("A"))
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("enrols a batch in one transaction", async function () {
      const { registry, alice, bob, carol } = await loadFixture(deployFixture);
      const accounts = [alice.address, bob.address, carol.address];
      const hashes = ["A", "B", "C"].map(idHash);

      await registry.enrolBatch(accounts, hashes);

      expect(await registry.activeMemberCount()).to.equal(3);
      expect(await registry.roster()).to.deep.equal(accounts);
    });

    it("rejects a batch with mismatched array lengths", async function () {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      await expect(
        registry.enrolBatch([alice.address, bob.address], [idHash("A")])
      ).to.be.revertedWithCustomError(registry, "LengthMismatch");
    });
  });

  describe("suspension", function () {
    it("suspends a member and shrinks the electorate", async function () {
      const { registry, alice } = await loadFixture(deployFixture);
      const h = idHash("A");
      await registry.enrol(alice.address, h);

      await expect(registry.suspend(alice.address)).to.emit(registry, "MemberSuspended").withArgs(alice.address, h);

      expect(await registry.isActiveMember(alice.address)).to.equal(false);
      expect(await registry.activeMemberCount()).to.equal(0);
      expect(await registry.rosterLength()).to.equal(1, "the roster keeps the historical record");
    });

    it("reinstates a suspended member", async function () {
      const { registry, alice } = await loadFixture(deployFixture);
      await registry.enrol(alice.address, idHash("A"));
      await registry.suspend(alice.address);

      await registry.reinstate(alice.address);
      expect(await registry.isActiveMember(alice.address)).to.equal(true);
      expect(await registry.activeMemberCount()).to.equal(1);
    });

    it("refuses to suspend somebody who was never enrolled", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(registry.suspend(outsider.address))
        .to.be.revertedWithCustomError(registry, "NotEnrolled")
        .withArgs(outsider.address);
    });

    it("refuses a double suspension", async function () {
      const { registry, alice } = await loadFixture(deployFixture);
      await registry.enrol(alice.address, idHash("A"));
      await registry.suspend(alice.address);

      await expect(registry.suspend(alice.address)).to.be.revertedWithCustomError(registry, "AlreadySuspended");
    });

    it("refuses to reinstate an active member", async function () {
      const { registry, alice } = await loadFixture(deployFixture);
      await registry.enrol(alice.address, idHash("A"));

      await expect(registry.reinstate(alice.address)).to.be.revertedWithCustomError(registry, "AlreadyActive");
    });
  });

  describe("role delegation", function () {
    it("lets the admin appoint another registrar", async function () {
      const { registry, admin, registrar, alice } = await loadFixture(deployFixture);
      const REGISTRAR_ROLE = await registry.REGISTRAR_ROLE();

      await registry.connect(admin).grantRole(REGISTRAR_ROLE, registrar.address);
      await registry.connect(registrar).enrol(alice.address, idHash("A"));

      expect(await registry.isActiveMember(alice.address)).to.equal(true);
    });

    it("stops a revoked registrar from enrolling", async function () {
      const { registry, admin, registrar, alice, bob } = await loadFixture(deployFixture);
      const REGISTRAR_ROLE = await registry.REGISTRAR_ROLE();

      await registry.connect(admin).grantRole(REGISTRAR_ROLE, registrar.address);
      await registry.connect(registrar).enrol(alice.address, idHash("A"));
      await registry.connect(admin).revokeRole(REGISTRAR_ROLE, registrar.address);

      await expect(
        registry.connect(registrar).enrol(bob.address, idHash("B"))
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });
});

// chai-matchers has no "any uint" helper for withArgs, so match on a predicate.
function anyUint64() {
  return (value) => typeof value === "bigint" && value > 0n;
}
