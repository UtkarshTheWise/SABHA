/**
 * Prints a fresh deployer key and a fresh demo phrase, as lines to paste into
 * .env. Nothing is written to disk and nothing leaves this machine.
 *
 *   npm run keys
 *
 * Use new ones for every hosted network. The phrase's first account is not the
 * deployer: the deployer is the separate key, so the two can be handled apart.
 */
const { Wallet, HDNodeWallet } = require("ethers");

function generate() {
  const deployer = Wallet.createRandom();
  const phrase = Wallet.createRandom().mnemonic.phrase;
  return {
    deployerKey: deployer.privateKey,
    deployerAddress: deployer.address,
    mnemonic: phrase,
    // account 1 of the phrase, which the demo uses as its first member
    firstMember: HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/1").address,
  };
}

if (require.main === module) {
  const k = generate();
  console.log("Paste these into .env (which is git-ignored). Do not share them or commit them.\n");
  console.log(`DEPLOYER_PRIVATE_KEY=${k.deployerKey}`);
  console.log(`DEMO_MNEMONIC=${k.mnemonic}`);
  console.log(`\nSend test ether to the deployer: ${k.deployerAddress}`);
  console.log("These are for test networks. Never put real funds behind them.");
}

module.exports = { generate };
