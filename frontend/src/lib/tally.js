/**
 * The counting rules, as plain functions. They mirror DirectDemocracy exactly
 * (test/frontend/tally.test.js runs both on the same inputs), so the page can
 * show a leader before a ballot is counted and an auditor can recompute a
 * result from the event log alone.
 */

/** Which options hold the highest count. With no votes there is no leader. */
export function leaders(tally) {
  const counts = tally.map((n) => Number(n));
  const max = counts.reduce((a, b) => (b > a ? b : a), 0);
  if (max === 0) return { max: 0, indexes: [] };
  return { max, indexes: counts.flatMap((n, i) => (n === max ? [i] : [])) };
}

/** True when two or more options share the top count, or when nobody voted (as the contract reports it). */
export function isTied(tally) {
  const { max, indexes } = leaders(tally);
  return max === 0 || indexes.length > 1;
}

export const totalOf = (tally) => tally.reduce((sum, n) => sum + Number(n), 0);

/** Whole-number share of the counted votes, 0 when none. Rounds half up. */
export function share(count, total) {
  return total === 0 ? 0 : Math.round((Number(count) / total) * 100);
}

/**
 * The fewest votes that make the result count. The contract needs
 * votes * 10000 >= electorate * quorumBps, and at least one vote even if the
 * quorum is zero, so the answer is the rounded-up product with a floor of one.
 */
export function quorumNeeded(electorate, quorumBps) {
  // Integers only: a floating-point quotient can land a hair above a whole
  // number and round up one vote too many. The product stays well under 2^53.
  const product = Number(electorate) * Number(quorumBps);
  const whole = Math.floor(product / 10000);
  return Math.max(1, product % 10000 === 0 ? whole : whole + 1);
}

export function quorumMet(totalVotes, electorate, quorumBps) {
  return Number(totalVotes) > 0 && Number(totalVotes) * 10000 >= Number(electorate) * Number(quorumBps);
}

/**
 * Recount a ballot from VoteCast events, which is all an auditor needs.
 * `events` are { voter, option }. A voter who appears twice is reported, not
 * counted twice: the contract forbids it, so seeing it means the log is not
 * this contract's.
 */
export function recount(events, optionCount) {
  const tally = new Array(optionCount).fill(0);
  const seen = new Set();
  const duplicates = [];
  const outOfRange = [];
  for (const { voter, option } of events) {
    const key = String(voter).toLowerCase();
    const index = Number(option);
    if (!Number.isInteger(index) || index < 0 || index >= optionCount) {
      outOfRange.push({ voter, option });
      continue;
    }
    if (seen.has(key)) {
      duplicates.push(voter);
      continue;
    }
    seen.add(key);
    tally[index] += 1;
  }
  return { tally, voters: seen.size, duplicates, outOfRange };
}

/** Do two tallies say the same thing? */
export function sameTally(a, b) {
  return a.length === b.length && a.every((n, i) => Number(n) === Number(b[i]));
}
