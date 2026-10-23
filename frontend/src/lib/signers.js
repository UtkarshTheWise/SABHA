/**
 * One way of sending a transaction, whatever holds the key (a wallet app, a wallet
 * kept in this browser, or a development node).
 *
 * Two things are settled here rather than left to each wallet:
 *
 *   1. The gas limit is estimated first, and the member is told if the chain would
 *      refuse, before any wallet window opens. "You have already voted" arrives as
 *      an answer, not as a failed transaction. And Hardhat-style tooling that falls
 *      back to the chain's largest limit when it cannot estimate would otherwise
 *      ask a wallet to hold far more than a vote costs.
 *   2. On a network where gas is free, the transaction goes out as a legacy
 *      transaction at gas price 0, so a wallet holding nothing is not refused.
 */
import { feeOverrides } from "./networkParams.js";

const MARGIN = 120n; // percent of the estimate

export function withTxDefaults(signer, network) {
  const fees = feeOverrides(network);
  return new Proxy(signer, {
    get(target, property) {
      if (property === "sendTransaction") {
        return async (transaction) => {
          const prepared = { ...transaction, ...fees };
          if (prepared.gasLimit === undefined || prepared.gasLimit === null) {
            const estimate = await target.estimateGas(prepared);
            prepared.gasLimit = (estimate * MARGIN) / 100n;
          }
          return target.sendTransaction(prepared);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
