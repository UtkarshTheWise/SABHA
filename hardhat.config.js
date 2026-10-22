require("@nomicfoundation/hardhat-toolbox");
const { hardhatNetworks } = require("./config/networks");

// Networks, RPC URLs, chain ids and signing keys all come from config/networks.js,
// which reads .env. Nothing here is specific to one machine.

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  // `hardhat` is the in-process chain used by `npm test`. `localhost` is
  // `npx hardhat node` in another terminal, which is what the frontend talks to
  // during development. `besu` and `sepolia` appear once their RPC URL is set.
  networks: hardhatNetworks(),
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
  },
  mocha: {
    timeout: 60000,
  },
};
