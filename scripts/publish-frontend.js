/**
 * Writes the frontend's chain files from what is already on disk, without
 * touching any chain: the shared ABIs, and a network file for every deployment
 * record in deployments/. `npm run deploy` does this for the network it just
 * deployed to; this is for CI, a fresh clone, or a changed .env.
 *
 *   npm run publish:frontend
 */
const fs = require("fs");
const hre = require("hardhat");
const { resolve: resolveNetwork } = require("../config/networks");
const deployments = require("./lib/deployments");

function main() {
  console.log(`ABIs            ${deployments.publishAbis(hre)}`);

  const dir = deployments.deploymentsDir();
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const name = file.replace(/\.json$/, "");
    if (!resolveNetwork(name)) continue; // records of throwaway in-process runs
    try {
      deployments.publishToFrontend(hre, name, deployments.load(name));
      console.log(`network file    ${name}`);
    } catch (error) {
      console.warn(`skipped ${name}: ${error.message}`);
    }
  }
}

main();
