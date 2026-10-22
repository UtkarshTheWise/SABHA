/**
 * What to submit to a block explorer for one deployment. Pure, so it can be
 * tested without a network.
 */
const { resolve: resolveNetwork } = require("../../config/networks");

/**
 * The contracts in a deployment record, each with the constructor arguments it
 * was deployed with, in the order `verify:verify` wants them.
 * Throws if the network has no public explorer to verify against.
 */
function verificationPlan(networkName, record) {
  const net = resolveNetwork(networkName);
  if (!net) throw new Error(`"${networkName}" is not a network this project deploys to.`);
  if (!net.explorerUrl) {
    throw new Error(
      `Nothing to verify on "${networkName}": no explorer is configured. ` +
        `A private network has none; for a public one set EXPLORER_URL_${networkName.toUpperCase()} in .env.`
    );
  }

  const { MemberRegistry, DirectDemocracy } = record.contracts;
  return [
    { name: "MemberRegistry", contract: "contracts/MemberRegistry.sol:MemberRegistry", address: MemberRegistry.address, args: [record.admin] },
    {
      name: "DirectDemocracy",
      contract: "contracts/DirectDemocracy.sol:DirectDemocracy",
      address: DirectDemocracy.address,
      args: [MemberRegistry.address, record.admin],
    },
  ];
}

/** Explorers answer "already verified" in several wordings; none of them is a failure. */
const alreadyVerified = (error) => /already verified|already been verified|already exists|Contract source code already verified/i.test(error?.message || "");

module.exports = { verificationPlan, alreadyVerified };
