const hre = require("hardhat");
const { load, saveDirectory } = require("./lib/deployments");
const { seedChain } = require("./lib/bootstrap");

async function main() {
  const people = await seedChain(hre, load(hre.network.name));

  // Names and registration numbers stay on this machine: only the local demo
  // gets a directory file, and the frontend bundle never includes it.
  saveDirectory(hre.network.name, people);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
