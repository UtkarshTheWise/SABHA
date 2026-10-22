/**
 * A signer that attaches its own gas limit to every transaction.
 *
 * Left alone, Hardhat estimates gas and, if that estimate call errors, quietly
 * falls back to the largest limit the chain allows (16.7 million gas). A sender
 * must hold gasLimit x price to send at all, so a wallet with 0.005 ETH is
 * refused for a vote that costs 0.0001. Hardhat's own node errors during
 * estimation for low-balance senders, which is how this showed up: voters
 * funded with a few thousandths of an ether could not vote.
 *
 * Estimating here, without any fee fields, and adding a margin avoids depending
 * on that fallback. On a chain where gas is free it makes no difference.
 */
function estimating(signer, { marginPercent = 20n } = {}) {
  return new Proxy(signer, {
    get(target, property) {
      if (property === "sendTransaction") {
        return async (transaction) => {
          if (transaction.gasLimit === undefined || transaction.gasLimit === null) {
            const estimate = await target.estimateGas(transaction);
            transaction = { ...transaction, gasLimit: (estimate * (100n + marginPercent)) / 100n };
          }
          return target.sendTransaction(transaction);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

module.exports = { estimating };
