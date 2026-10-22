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
      // The Besu genesis activates London, and Sepolia runs newer forks, so
      // target the newest EVM that has no PUSH0: it runs on both. Hardhat 2
      // defaults to this today; pinning it stops a tool upgrade changing it.
      // scripts/check-sizes.js proves the output obeys it.
      evmVersion: "paris",
    },
  },
  // `hardhat` is the in-process chain used by `npm test`. `localhost` is
  // `npx hardhat node` in another terminal, which is what the frontend talks to
  // during development. `besu` and `sepolia` appear once their RPC URL is set.
  networks: hardhatNetworks(),
  // Verifying source on a public explorer: Blockscout and Sourcify need no
  // account. Etherscan is used only if you supply a key. Private networks have
  // no explorer, so `npm run verify` stops there with an explanation.
  blockscout: { enabled: true },
  sourcify: { enabled: true },
  etherscan: {
    enabled: Boolean(process.env.ETHERSCAN_API_KEY),
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
  },
  mocha: {
    timeout: 60000,
  },
};
