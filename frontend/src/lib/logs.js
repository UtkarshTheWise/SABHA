/**
 * Reading event logs across a long range of blocks. Nodes cap how many blocks
 * one query may span (5,000 on our Besu network, 10,000 on many public RPCs), so
 * the range is cut into pieces, read in order, and the piece size is halved if a
 * node says a piece was too big.
 */

/** [from, to] inclusive, cut into pieces of at most `size` blocks, in order. */
export function blockRanges(from, to, size) {
  const ranges = [];
  if (to < from || size < 1) return ranges;
  for (let start = from; start <= to; start += size) ranges.push([start, Math.min(to, start + size - 1)]);
  return ranges;
}

const TOO_BIG = /range|limit|too many|too large|exceed|more than|10000|5000|query returned/i;

/**
 * @param provider  anything with getLogs(filter) and getBlockNumber()
 * @param filter    { address, topics } as ethers takes them
 * @param options   { from, to = latest, chunk = 2000, minChunk = 100, onProgress }
 * @returns         the logs, oldest first, each exactly once
 */
export async function getLogsChunked(provider, filter, options = {}) {
  const from = options.from ?? 0;
  const to = options.to ?? (await provider.getBlockNumber());
  const minChunk = options.minChunk ?? 100;
  let chunk = options.chunk ?? 2000;

  const logs = [];
  let start = from;
  while (start <= to) {
    const end = Math.min(to, start + chunk - 1);
    try {
      logs.push(...(await provider.getLogs({ ...filter, fromBlock: start, toBlock: end })));
    } catch (error) {
      const message = String(error?.shortMessage || error?.message || "");
      if (chunk > minChunk && TOO_BIG.test(message)) {
        chunk = Math.max(minChunk, Math.floor(chunk / 2));
        continue; // same start, smaller piece
      }
      throw error;
    }
    options.onProgress?.({ done: end - from + 1, total: to - from + 1 });
    start = end + 1;
  }
  return logs;
}
