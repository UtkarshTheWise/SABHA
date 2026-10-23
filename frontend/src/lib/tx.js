/**
 * Follows one write from the wallet to a block, reporting each phase so the page
 * can show what is happening and, afterwards, what happened: the hash, the block,
 * the gas. It never throws; a failure is a result the page can explain.
 *
 *   wallet     waiting for the member to approve in their wallet
 *   pending    sent; waiting for the network to put it in a block
 *   confirmed  in a block
 *   failed     refused before it was sent, or reverted in a block
 */
import { decodeError } from "./errors.js";

/**
 * @param {() => Promise<{hash: string, wait: () => Promise<object>}>} run  starts the transaction
 * @param {(state: object) => void} [onUpdate]
 */
export async function trackTransaction(run, onUpdate = () => {}) {
  onUpdate({ phase: "wallet" });

  let response;
  try {
    response = await run();
  } catch (error) {
    const state = { phase: "failed", error: decodeError(error) };
    onUpdate(state);
    return state;
  }

  // A runner that returns nothing usable is a bug upstream, not something to throw at the page.
  if (!response || typeof response.wait !== "function") {
    const state = { phase: "failed", error: decodeError(new Error("The wallet did not return a transaction.")) };
    onUpdate(state);
    return state;
  }

  onUpdate({ phase: "pending", hash: response.hash });

  let state;
  try {
    const receipt = await response.wait();
    const price = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
    state = {
      phase: "confirmed",
      hash: response.hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed,
      fee: receipt.gasUsed * price,
    };
  } catch (error) {
    // A transaction that was mined and reverted throws, with its receipt attached.
    const receipt = error?.receipt;
    state = {
      phase: "failed",
      hash: response.hash,
      blockNumber: receipt ? Number(receipt.blockNumber) : undefined,
      gasUsed: receipt?.gasUsed,
      error: decodeError(error),
    };
  }
  onUpdate(state);
  return state;
}
