const { expect } = require("chai");
const { Wallet, HDNodeWallet } = require("ethers");

const { generate } = require("../../scripts/gen-keys");

describe("fresh keys for a hosted network", function () {
  it("makes a key that is well-formed and belongs to the address it reports", function () {
    const k = generate();
    expect(k.deployerKey).to.match(/^0x[0-9a-f]{64}$/);
    expect(new Wallet(k.deployerKey).address).to.equal(k.deployerAddress);
  });

  it("makes a twelve-word phrase whose first member account matches what it reports", function () {
    const k = generate();
    expect(k.mnemonic.split(" ")).to.have.length(12);
    expect(HDNodeWallet.fromPhrase(k.mnemonic, undefined, "m/44'/60'/0'/0/1").address).to.equal(k.firstMember);
  });

  it("keeps the deployer separate from the phrase, so one leaking does not expose the other", function () {
    const k = generate();
    for (let i = 0; i < 5; i++) {
      const account = HDNodeWallet.fromPhrase(k.mnemonic, undefined, `m/44'/60'/0'/0/${i}`);
      expect(account.address).to.not.equal(k.deployerAddress);
    }
  });

  it("never repeats", function () {
    const a = generate();
    const b = generate();
    expect(a.deployerKey).to.not.equal(b.deployerKey);
    expect(a.mnemonic).to.not.equal(b.mnemonic);
  });

  it("is never the public test phrase", function () {
    expect(generate().mnemonic).to.not.equal("test test test test test test test test test test test junk");
  });
});
