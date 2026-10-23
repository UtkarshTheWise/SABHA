/**
 * Who is acting, and how they sign.
 *
 * Reading the ledger needs no wallet, so a visitor starts with none ("reading
 * only"). A member connects one of three ways:
 *
 *   app    a wallet app in this browser (found by the EIP-6963 announcement, with
 *          window.ethereum as the fallback for older ones)
 *   local  a wallet Sabha keeps in this browser, encrypted with a passphrase
 *   node   an unlocked account on a development node (the local network only)
 *
 * Whatever signs, the page receives the same thing: an address and a signer that
 * estimates before it sends and pays nothing where gas is free (lib/signers.js).
 */
import { BrowserProvider } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createLocalWallet, keystoreAddress, keystoreStore, unlockLocalWallet } from "../lib/localWallet.js";
import { withTxDefaults } from "../lib/signers.js";
import { switchWallet } from "../lib/networks.js";
import { useNetwork } from "./network.jsx";

const PREFERENCE_KEY = "sabha.wallet";

const WalletContext = createContext(null);

/** Wallet apps that announce themselves; one entry per app, however often it announces. */
function useWalletApps() {
  const [announced, setAnnounced] = useState([]);

  useEffect(() => {
    const onAnnounce = (event) => {
      const detail = event.detail;
      if (!detail?.provider || !detail?.info) return;
      setAnnounced((list) => (list.some((entry) => entry.info.uuid === detail.info.uuid) ? list : [...list, detail]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  return useMemo(() => {
    if (announced.length > 0) return announced;
    if (typeof window !== "undefined" && window.ethereum) {
      return [{ info: { uuid: "window.ethereum", name: "Browser wallet", icon: "", rdns: "window.ethereum" }, provider: window.ethereum }];
    }
    return [];
  }, [announced]);
}

const readPreference = () => {
  try {
    return JSON.parse(window.localStorage.getItem(PREFERENCE_KEY) || "null");
  } catch {
    return null;
  }
};
const writePreference = (value) => {
  try {
    if (value) window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(PREFERENCE_KEY);
  } catch {
    /* remembering is a convenience */
  }
};

export function WalletProvider({ children }) {
  const { network, reader } = useNetwork();
  const apps = useWalletApps();
  const store = useMemo(() => keystoreStore(window.localStorage), []);

  const [session, setSession] = useState({ kind: null, account: null, signer: null, appName: null, appProvider: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [localKeystore, setLocalKeystore] = useState(() => store.load());
  const unlocked = useRef(null); // the in-memory key of a device wallet; never stored
  const connected = useRef(null);

  const fail = useCallback((problem) => {
    setError(problem);
    setBusy(false);
  }, []);

  const adopt = useCallback(
    (kind, rawSigner, extra = {}) => {
      const signer = withTxDefaults(rawSigner, network);
      connected.current = { kind, ...extra };
      setSession({ kind, account: rawSigner.address, signer, appName: extra.appName ?? null, appProvider: extra.entry?.provider ?? null });
      setError(null);
      setBusy(false);
      return signer;
    },
    [network]
  );

  // --- a wallet app ---------------------------------------------------------------

  const connectApp = useCallback(
    async (entry, { silent = false } = {}) => {
      setBusy(true);
      setError(null);
      try {
        let browser = new BrowserProvider(entry.provider);
        const accounts = await browser.send(silent ? "eth_accounts" : "eth_requestAccounts", []);
        if (silent && accounts.length === 0) {
          setBusy(false);
          return null;
        }
        const current = parseInt(await browser.send("eth_chainId", []), 16);
        if (current !== network.chainId) {
          if (silent) {
            // Do not open a prompt on page load; the first write asks for the switch.
          } else {
            await switchWallet(entry.provider, network);
            browser = new BrowserProvider(entry.provider); // ethers refuses a network that changed under it
          }
        }
        const signer = await browser.getSigner();
        writePreference({ kind: "app", rdns: entry.info.rdns });
        return adopt("app", signer, { appName: entry.info.name, entry });
      } catch (problem) {
        fail(problem);
        return null;
      }
    },
    [adopt, fail, network]
  );

  // A member changing account or network inside their wallet app should not leave a stale signer behind.
  useEffect(() => {
    const entry = connected.current?.entry;
    if (session.kind !== "app" || !entry?.provider?.on) return undefined;
    const refresh = () => connectApp(entry, { silent: true }).then((signer) => signer || disconnect());
    entry.provider.on("accountsChanged", refresh);
    entry.provider.on("chainChanged", refresh);
    return () => {
      entry.provider.removeListener?.("accountsChanged", refresh);
      entry.provider.removeListener?.("chainChanged", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, connectApp]);

  // --- a wallet kept in this browser ----------------------------------------------

  const createLocal = useCallback(
    async (passphrase) => {
      setBusy(true);
      setError(null);
      try {
        const { wallet, json } = await createLocalWallet(passphrase);
        store.save(json);
        setLocalKeystore(json);
        unlocked.current = wallet;
        writePreference({ kind: "local" });
        adopt("local", wallet.connect(reader));
        return { json, address: wallet.address };
      } catch (problem) {
        fail(problem);
        return null;
      }
    },
    [adopt, fail, reader, store]
  );

  const unlockLocal = useCallback(
    async (passphrase, json = localKeystore) => {
      setBusy(true);
      setError(null);
      try {
        const wallet = await unlockLocalWallet(json, passphrase);
        unlocked.current = wallet;
        if (json !== localKeystore) {
          store.save(json);
          setLocalKeystore(json);
        }
        writePreference({ kind: "local" });
        adopt("local", wallet.connect(reader));
        return true;
      } catch (problem) {
        fail(problem);
        return false;
      }
    },
    [adopt, fail, localKeystore, reader, store]
  );

  const forgetLocal = useCallback(() => {
    store.forget();
    setLocalKeystore(null);
    unlocked.current = null;
    if (connected.current?.kind === "local") {
      connected.current = null;
      setSession({ kind: null, account: null, signer: null, appName: null, appProvider: null });
      writePreference(null);
    }
  }, [store]);

  // --- a development node ---------------------------------------------------------

  const nodeAccounts = useCallback(() => reader.send("eth_accounts", []), [reader]);

  const connectNode = useCallback(
    async (address) => {
      setBusy(true);
      setError(null);
      try {
        const list = await nodeAccounts();
        const chosen = address && list.includes(address) ? address : list[1] || list[0];
        if (!chosen) throw new Error("The node has no unlocked accounts.");
        writePreference({ kind: "node", address: chosen });
        return adopt("node", await reader.getSigner(chosen));
      } catch (problem) {
        fail(problem);
        return null;
      }
    },
    [adopt, fail, nodeAccounts, reader]
  );

  // --- leaving --------------------------------------------------------------------

  const disconnect = useCallback(() => {
    connected.current = null;
    unlocked.current = null;
    setSession({ kind: null, account: null, signer: null, appName: null, appProvider: null });
    setError(null);
    writePreference(null);
  }, []);

  /**
   * Before a write: make sure a wallet app is still on this network, asking it to
   * switch if not. Other kinds of signer have nothing to check.
   */
  const ready = useCallback(async () => {
    const entry = connected.current?.entry;
    if (connected.current?.kind === "app" && entry) {
      const current = parseInt(await new BrowserProvider(entry.provider).send("eth_chainId", []), 16);
      if (current !== network.chainId) {
        await switchWallet(entry.provider, network);
        const signer = await new BrowserProvider(entry.provider).getSigner();
        return withTxDefaults(signer, network);
      }
    }
    return session.signer;
  }, [network, session.signer]);

  // --- coming back ----------------------------------------------------------------

  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    const preference = readPreference();
    if (!preference) {
      resumed.current = true;
      return;
    }
    if (preference.kind === "node" && network.key === "localhost") {
      resumed.current = true;
      connectNode(preference.address);
    } else if (preference.kind === "app" && apps.length > 0) {
      resumed.current = true;
      const entry = apps.find((a) => a.info.rdns === preference.rdns) || apps[0];
      connectApp(entry, { silent: true });
    }
    // a device wallet needs its passphrase, so it is never reopened by itself
  }, [apps, connectApp, connectNode, network.key]);

  const value = useMemo(
    () => ({
      ...session,
      apps,
      busy,
      error,
      clearError: () => setError(null),
      hasLocal: Boolean(localKeystore),
      localAddress: localKeystore ? keystoreAddress(localKeystore) : null,
      localKeystore,
      canUseNode: network.key === "localhost",
      connectApp,
      createLocal,
      unlockLocal,
      forgetLocal,
      nodeAccounts,
      connectNode,
      disconnect,
      ready,
    }),
    [session, apps, busy, error, localKeystore, network.key, connectApp, createLocal, unlockLocal, forgetLocal, nodeAccounts, connectNode, disconnect, ready]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside <WalletProvider>");
  return value;
}

