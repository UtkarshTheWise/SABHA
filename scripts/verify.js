/**
 * Publishes the source of a deployed network's contracts on its block explorer,
 * so anyone can read exactly what they run. Reads deployments/<network>.json.
 *
 *   SABHA_NETWORK=sepolia npm run verify
 *   VERIFY_DRY_RUN=true SABHA_NETWORK=sepolia npm run verify    (list, submit nothing)
 */
const hre = require("hardhat");
const { resolve: resolveNetwork } = require("../config/networks");
const { load } = require("./lib/deployments");
const { verificationPlan, alreadyVerified } = require("./lib/verification");

async function main() {
  const name = hre.network.name;
  const net = resolveNetwork(name);
  const plan = verificationPlan(name, load(name));
  const dry = process.env.VERIFY_DRY_RUN === "true";

  console.log(`${dry ? "Would verify" : "Verifying"} on ${net.label}\n`);
  let failed = 0;

  for (const item of plan) {
    const link = `${net.explorerUrl}/address/${item.address}`;
    console.log(`${item.name}  ${item.address}`);
    console.log(`  constructor  ${JSON.stringify(item.args)}`);
    if (dry) continue;

    try {
      await hre.run("verify:verify", { address: item.address, constructorArguments: item.args, contract: item.contract });
      console.log("  verified");
    } catch (error) {
      if (alreadyVerified(error)) {
        console.log("  already verified");
      } else {
        failed++;
        console.log(`  FAILED: ${error.message.split("\n")[0]}`);
      }
    }
    console.log(`  ${link}#code`);
  }

  if (failed > 0) {
    // A freshly deployed contract can take a minute to be indexed; trying again usually works.
    console.error(`\n${failed} contract${failed === 1 ? "" : "s"} not verified. If the explorer has only just seen them, wait a minute and run this again.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
