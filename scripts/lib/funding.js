/**
 * On a public testnet the demo's voters are throwaway wallets with no ether, and
 * every vote costs gas. The deployer sends `amount` to each one holding less
 * than `minimum`, so the demo runs on its own.
 * On a chain where everyone is already funded (the local node) or where gas is
 * free, this does nothing.
 */
async function ensureFunded(ethers, funder, recipients, { minimum, amount }) {
  const provider = funder.provider;
  const needy = [];
  for (const recipient of recipients) {
    const address = typeof recipient === "string" ? recipient : recipient.address;
    if ((await provider.getBalance(address)) < minimum) needy.push(address);
  }
  if (needy.length === 0) return [];

  const balance = await provider.getBalance(funder.address);
  const needed = BigInt(needy.length) * amount;
  if (balance < needed) {
    throw new Error(
      `${funder.address} holds ${ethers.formatEther(balance)} ETH but funding ${needy.length} voters needs about ` +
        `${ethers.formatEther(needed)}. Send it more from a faucet and run again.`
    );
  }

  const receipts = [];
  for (const address of needy) {
    const tx = await funder.sendTransaction({ to: address, value: amount });
    receipts.push({ address, receipt: await tx.wait() });
  }
  return receipts;
}

module.exports = { ensureFunded };
