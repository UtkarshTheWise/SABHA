import { createContext, useContext, useEffect, useMemo } from "react";

import { contractsFor, readProvider } from "../lib/chain.js";

const NetworkContext = createContext(null);

/**
 * Everything that depends on which network is selected, made once per network:
 * the read connection and the contracts bound to it. The app remounts below this
 * when the network changes, so nothing stale survives a switch.
 */
export function NetworkProvider({ network, children }) {
  const reader = useMemo(() => readProvider(network), [network]);
  const contracts = useMemo(() => contractsFor(reader, network), [reader, network]);

  useEffect(() => () => reader.destroy(), [reader]);

  const value = useMemo(() => ({ network, reader, contracts }), [network, reader, contracts]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork() {
  const value = useContext(NetworkContext);
  if (!value) throw new Error("useNetwork must be used inside <NetworkProvider>");
  return value;
}
