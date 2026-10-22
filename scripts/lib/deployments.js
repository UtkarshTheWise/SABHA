const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");
const FRONTEND_CHAIN_DIR = path.join(ROOT, "frontend", "src", "chain");

function recordPath(networkName) {
  return path.join(DEPLOYMENTS_DIR, `${networkName}.json`);
}

function save(networkName, record) {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(recordPath(networkName), `${JSON.stringify(record, null, 2)}\n`);
  return recordPath(networkName);
}

function load(networkName) {
  const file = recordPath(networkName);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No deployment found for network "${networkName}". Run: npx hardhat run scripts/deploy.js --network ${networkName}`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Copy the ABIs and the address record into the frontend so the UI never has to
 * reach into Hardhat's artifacts directory.
 */
function publishToFrontend(hre, networkName, record) {
  fs.mkdirSync(FRONTEND_CHAIN_DIR, { recursive: true });

  for (const name of ["MemberRegistry", "DirectDemocracy"]) {
    const artifact = hre.artifacts.readArtifactSync(name);
    fs.writeFileSync(
      path.join(FRONTEND_CHAIN_DIR, `${name}.abi.json`),
      `${JSON.stringify(artifact.abi, null, 2)}\n`
    );
  }

  fs.writeFileSync(
    path.join(FRONTEND_CHAIN_DIR, "deployment.json"),
    `${JSON.stringify({ network: networkName, ...record }, null, 2)}\n`
  );

  return FRONTEND_CHAIN_DIR;
}

function saveDirectory(entries) {
  fs.mkdirSync(FRONTEND_CHAIN_DIR, { recursive: true });
  const file = path.join(FRONTEND_CHAIN_DIR, "directory.json");
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
  return file;
}

module.exports = { save, load, publishToFrontend, saveDirectory, DEPLOYMENTS_DIR, FRONTEND_CHAIN_DIR };
