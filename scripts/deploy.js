const hre = require("hardhat");
const { save, publishToFrontend } = require("./lib/deployments");

async function main() {
  const { ethers, network } = hre;
  const [admin] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`network      ${network.name} (chainId ${chainId})`);
  console.log(`admin        ${admin.address}`);
  console.log(`balance      ${ethers.formatEther(await ethers.provider.getBalance(admin.address))} ETH\n`);

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
  console.log(`wrote ABIs and addresses to ${publishToFrontend(hre, network.name, record)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
