/**
 * One way to write to the chain, used by every action, so every action gives the
 * same feedback: waiting for the wallet, sent, recorded or refused, with the hash,
 * the block and the gas. A write never throws at the page.
 *
 *   const { tx, busy, send, dismiss } = useSend();
 *   send("vote", (signer) => contracts.voting.connect(signer).castVote(id, option));
 */
import { useCallback, useRef, useState } from "react";

import { trackTransaction } from "../lib/tx.js";
import { useChain } from "./chain.jsx";
import { useWallet } from "./wallet.jsx";

export function useSend() {
  const { ready } = useWallet();
  const { refresh } = useChain();
  const [tx, setTx] = useState(null);
  const running = useRef(false);

  const send = useCallback(
    async (kind, build) => {
      if (running.current) return null; // one write at a time, so a double click cannot send twice
      running.current = true;
      setTx({ kind, phase: "wallet" });
      try {
        const result = await trackTransaction(async () => build(await ready()), (state) => setTx({ kind, ...state }));
        if (result.phase === "confirmed") await refresh();
        return result;
      } finally {
        running.current = false;
      }
    },
    [ready, refresh]
  );

  const busy = tx?.phase === "wallet" || tx?.phase === "pending";
  const dismiss = useCallback(() => setTx(null), []);
  return { tx, busy, send, dismiss };
}
