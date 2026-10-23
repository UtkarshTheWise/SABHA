/**
 * The ledger as the page sees it: the ballots, what the connected member may do,
 * and how they voted. Reads only; writes go through the signer and call refresh().
 *
 * Polling is gentle on purpose. Everyone who has the page open shares one public
 * endpoint, so a local node is read every few seconds, a shared one every dozen,
 * and a hidden tab not at all.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { ROLES, normaliseBallot } from "../lib/chain.js";
import { pollInterval } from "../lib/networks.js";
import { useNetwork } from "./network.jsx";
import { useWallet } from "./wallet.jsx";

const ChainContext = createContext(null);

const PAGE = 50; // the newest fifty ballots; older ones are fetched when opened directly

export function ChainProvider({ children }) {
  const { network, reader, contracts } = useNetwork();
  const { account } = useWallet();

  const [state, setState] = useState({ status: "loading", error: null, blockNumber: 0, blockTime: 0, ballots: [], updatedAt: 0 });
  const [me, setMe] = useState({ status: "idle", roles: { registrar: false, proposer: false, admin: false, member: false }, receipts: {} });
  const accountRef = useRef(account);
  accountRef.current = account;

  const refresh = useCallback(async () => {
    try {
      const [latest, page] = await Promise.all([reader.getBlock("latest"), contracts.voting.listProposals(0, PAGE)]);
      const ballots = page.map(normaliseBallot);
      setState({ status: "ready", error: null, blockNumber: latest.number, blockTime: latest.timestamp, ballots, updatedAt: Date.now() });

      const who = accountRef.current;
      if (!who) {
        setMe({ status: "idle", roles: { registrar: false, proposer: false, admin: false, member: false }, receipts: {} });
        return;
      }
      const [registrar, proposer, admin, member] = await Promise.all([
        contracts.registry.hasRole(ROLES.registrar, who),
        contracts.voting.hasRole(ROLES.proposer, who),
        contracts.voting.hasRole(ROLES.admin, who),
        contracts.registry.isActiveMember(who),
      ]);
      const receipts = {};
      const entries = await Promise.all(ballots.map((b) => contracts.voting.receiptOf(b.id, who)));
      entries.forEach((r, i) => {
        if (r.voted) receipts[ballots[i].id] = { option: Number(r.option), blockNumber: Number(r.blockNumber) };
      });
      setMe({ status: "ready", roles: { registrar, proposer, admin, member }, receipts });
    } catch (error) {
      // keep showing what was last read, and say it is stale
      setState((previous) => ({ ...previous, status: previous.ballots.length > 0 ? "stale" : "error", error }));
    }
  }, [reader, contracts]);

  // load now, when the account changes, and then on a timer
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, pollInterval(network));
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, network, account]);

  const value = useMemo(() => ({ ...state, me, account, refresh }), [state, me, account, refresh]);
  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain() {
  const value = useContext(ChainContext);
  if (!value) throw new Error("useChain must be used inside <ChainProvider>");
  return value;
}

/**
 * The time, in seconds, as the CHAIN keeps it, refreshed at the given pace.
 *
 * A contract decides whether voting is open from the block's timestamp, never from
 * the clock in a member's pocket. A phone that is a few minutes wrong, or a
 * development node whose clock was moved, would otherwise be told "voting is open"
 * while the contract refuses. So the page anchors to the latest block's timestamp
 * and counts forward from there. On a network that pauses between blocks the latest
 * block can be a little old (up to the idle period), so the estimate can run
 * slightly behind; it is never ahead of what the contract will accept.
 */
export function useNow(everyMs = 30000) {
  const { blockTime, updatedAt } = useChain();
  const estimate = useCallback(() => (blockTime > 0 ? blockTime + Math.max(0, Math.floor((Date.now() - updatedAt) / 1000)) : Math.floor(Date.now() / 1000)), [blockTime, updatedAt]);
  const [now, setNow] = useState(estimate);
  useEffect(() => {
    setNow(estimate());
    const timer = setInterval(() => setNow(estimate()), everyMs);
    return () => clearInterval(timer);
  }, [estimate, everyMs]);
  return now;
}
