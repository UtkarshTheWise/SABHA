const hre = require("hardhat");
const { resolve: resolveNetwork } = require("../config/networks");
const { save, publishToFrontend } = require("./lib/deployments");
const { deployContracts } = require("./lib/bootstrap");

async function main() {
  const record = await deployContracts(hre);

  console.log(`wrote ${save(hre.network.name, record)}`);
  // The in-process "hardhat" network is gone when this script exits, so there is
  // nothing for a browser to connect to.
  if (resolveNetwork(hre.network.name)) {
    console.log(`wrote ABIs and the network file to ${publishToFrontend(hre, hre.network.name, record)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
