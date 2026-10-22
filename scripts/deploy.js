const hre = require("hardhat");
const { resolve: resolveNetwork } = require("../config/networks");
const { save, publishToFrontend } = require("./lib/deployments");

async function main() {
  const { ethers, network } = hre;
  const [admin] = await ethers.getSigners();
  if (!admin) {
    throw new Error(
      `No signing key for "${network.name}". Set DEPLOYER_PRIVATE_KEY (and DEMO_MNEMONIC) in .env; see .env.example.`
    );
  }
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`network      ${network.name} (chainId ${chainId})`);
  console.log(`admin        ${admin.address}`);
  const balance = await ethers.provider.getBalance(admin.address);
  console.log(`balance      ${ethers.formatEther(balance)} ETH\n`);

  // A network that charges for gas fails with an opaque "insufficient funds"
  // halfway through. Say what to do before sending anything.
  const known = resolveNetwork(network.name);
  if (known && !known.zeroGas && balance === 0n) {
    throw new Error(
      `${admin.address} has no ether on ${known.label}, so it cannot pay to deploy.\n` +
        `Send it some from a faucet (a deployment plus the demo needs roughly 0.05), then run this again.`
    );
  }

  const registry = await ethers.deployContract("MemberRegistry", [admin.address]);
  await registry.waitForDeployment();
  const registryTx = registry.deploymentTransaction();
  const registryReceipt = await registryTx.wait();
  console.log(`MemberRegistry   ${await registry.getAddress()}`);
  console.log(`  tx ${registryTx.hash}  block ${registryReceipt.blockNumber}  gas ${registryReceipt.gasUsed}`);

  const voting = await ethers.deployContract("DirectDemocracy", [await registry.getAddress(), admin.address]);
  await voting.waitForDeployment();
  const votingTx = voting.deploymentTransaction();
  const votingReceipt = await votingTx.wait();
  console.log(`DirectDemocracy  ${await voting.getAddress()}`);
  console.log(`  tx ${votingTx.hash}  block ${votingReceipt.blockNumber}  gas ${votingReceipt.gasUsed}\n`);

  const record = {
    chainId,
    deployedAt: new Date().toISOString(),
    admin: admin.address,
    contracts: {
      MemberRegistry: {
        address: await registry.getAddress(),
        txHash: registryTx.hash,
        block: registryReceipt.blockNumber,
      },
      DirectDemocracy: {
        address: await voting.getAddress(),
        txHash: votingTx.hash,
        block: votingReceipt.blockNumber,
      },
    },
  };

  console.log(`wrote ${save(network.name, record)}`);
  // The in-process "hardhat" network is gone when this script exits, so there is
  // nothing for a browser to connect to.
  if (resolveNetwork(network.name)) {
    console.log(`wrote ABIs and the network file to ${publishToFrontend(hre, network.name, record)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
