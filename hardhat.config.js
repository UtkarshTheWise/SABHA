require("@nomicfoundation/hardhat-toolbox");

// The same twelve-word test mnemonic Hardhat and Anvil ship with. It is public,
// it is funded in our Besu genesis, and it must never hold real value. Using it
// on every network means the deployer address is identical whether you are on
// the in-process chain, a standalone node, or the four-node QBFT network.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

const besuAccounts = process.env.BESU_PRIVATE_KEY
  ? [process.env.BESU_PRIVATE_KEY]
  : { mnemonic: TEST_MNEMONIC, count: 10 };

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // In-process chain used by `npx hardhat test`.
    hardhat: {
      accounts: { mnemonic: TEST_MNEMONIC, count: 20 },
    },
    // `npx hardhat node` in another terminal. This is the chain the frontend
    // talks to during development.
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: { mnemonic: TEST_MNEMONIC, count: 20 },
    },
    // The four-validator QBFT network in ./besu. Chain ID matches the genesis.
    besu: {
      url: process.env.BESU_RPC_URL || "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: besuAccounts,
      gasPrice: 0,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
  },
  mocha: {
    timeout: 60000,
  },
};
