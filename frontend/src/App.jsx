import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { id as keccakId } from "ethers";

import Ballot from "./components/Ballot";
import OfficerPanel from "./components/OfficerPanel";
import {
  STATE,
  contracts,
  nodeAccounts,
  readProvider,
  short,
  walletSigner,
} from "./lib/chain";
import { NETWORKS, addToWallet, initialNetwork, pollInterval, rememberNetwork } from "./lib/networks";

// The demo register of names, written by `npm run seed` for the local node only.
// It holds registration numbers, so it must never reach a production bundle,
// whoever builds it or wherever. `import.meta.env.DEV` is a constant at build
// time, so this branch, and the file with it, is removed from `vite build`.
const directoryFiles = import.meta.env.DEV
  ? import.meta.glob("./chain/directory.json", { eager: true, import: "default" })
  : {};
const directoryFile = Object.values(directoryFiles)[0] || [];

const REGISTRAR_ROLE = keccakId("REGISTRAR_ROLE");
const PROPOSER_ROLE = keccakId("PROPOSER_ROLE");

function normalise(p) {
  return {
    id: Number(p.id),
    title: p.title,
    description: p.description,
    options: [...p.options],
    tally: [...p.tally],
    opensAt: p.opensAt,
    closesAt: p.closesAt,
    quorumBps: p.quorumBps,
    electorate: p.electorate,
    proposer: p.proposer,
    cancelled: p.cancelled,
    finalised: p.finalised,
    quorumMet: p.quorumMet,
    tied: p.tied,
    winningOption: p.winningOption,
    totalVotes: p.totalVotes,
    state: p.state,
  };
}

export default function App() {
  const [network, setNetwork] = useState(initialNetwork);

  if (!network) {
    return (
      <div className="page">
        <main>
          <div className="intro">
            <h1>No network is configured</h1>
            <p>
              This build has no deployment to read. Deploy the contracts with <code>npm run deploy</code> (or{" "}
              <code>npm run publish:frontend</code> if they are already deployed), then rebuild.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return <Dashboard key={network.key} network={network} onNetwork={setNetwork} />;
}

function Dashboard({ network, onNetwork }) {
  // Which network this is decides what is allowed, not where its address points:
  // a hosted network reached through an SSH tunnel or a test rig on this machine
  // is still a hosted network, and has no unlocked accounts to offer.
  const local = network.key === "localhost";
  // "read": no signer, for anyone just looking. "wallet": a browser wallet the
  // visitor chose to connect. "node": an unlocked development node, local only.
  // A hosted network starts read-only so nobody is greeted by a wallet prompt.
  const [mode, setMode] = useState(local ? "node" : "read");
  const [attempt, setAttempt] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState(null);
  const [signer, setSigner] = useState(null);
  const [blockNumber, setBlockNumber] = useState(0);
  const [proposals, setProposals] = useState([]);
  const [receipts, setReceipts] = useState({});
  const [roles, setRoles] = useState({ registrar: false, proposer: false, member: false });
  const [status, setStatus] = useState("Connecting to the node…");
  const [walletNote, setWalletNote] = useState(null);

  const reader = useMemo(() => readProvider(network), [network]);
  const readContracts = useMemo(() => contracts(reader, network), [reader, network]);
  const writeContracts = useMemo(() => (signer ? contracts(signer, network) : null), [signer, network]);
  const signerRef = useRef(null);
  signerRef.current = signer;

  const directory = useMemo(() => {
    const map = {};
    // The register belongs to the local demo; do not attach its names to another chain.
    if (local) for (const person of directoryFile) map[person.address.toLowerCase()] = person.name;
    return map;
  }, [local]);

  // --- connect -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function connect() {
      if (mode === "read") {
        setSigner(null);
        setAccount(null);
        setAccounts([]);
        return;
      }
      try {
        if (mode === "node") {
          const list = await nodeAccounts(reader);
          if (cancelled) return;
          setAccounts(list);
          const chosen = list.includes(account) ? account : list[1] || list[0];
          setAccount(chosen);
          setSigner(chosen ? await reader.getSigner(chosen) : null);
        } else {
          const active = await walletSigner(network);
          if (cancelled) return;
          setAccounts([active.address]);
          setAccount(active.address);
          setSigner(active);
        }
      } catch (error) {
        if (cancelled) return;
        // Reading the ledger needs no wallet. Say why the wallet part failed and carry on.
        setSigner(null);
        setAccount(null);
        setWalletNote(
          mode === "wallet" && error?.code === "ACTION_REJECTED"
            ? "The wallet request was declined. You can still read everything; connect when you want to vote."
            : mode === "wallet"
              ? `Could not connect a wallet: ${error?.shortMessage || error?.message}`
              : `Could not reach the node's accounts: ${error?.shortMessage || error?.message}`
        );
      }
    }
    connect();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, attempt]);

  async function chooseAccount(address) {
    setAccount(address);
    setSigner(await reader.getSigner(address));
  }

  // --- read the chain ----------------------------------------------------
  const refresh = useCallback(async () => {
    try {
      const [height, page] = await Promise.all([reader.getBlockNumber(), readContracts.voting.listProposals(0, 50)]);
      setBlockNumber(height);
      const list = page.map(normalise);
      setProposals(list);
      setStatus(null);

      const who = signerRef.current ? await signerRef.current.getAddress() : null;
      if (!who) return;

      const [registrar, proposer, member] = await Promise.all([
        readContracts.registry.hasRole(REGISTRAR_ROLE, who),
        readContracts.voting.hasRole(PROPOSER_ROLE, who),
        readContracts.registry.isActiveMember(who),
      ]);
      setRoles({ registrar, proposer, member });

      const entries = await Promise.all(list.map(async (p) => [p.id, await readContracts.voting.receiptOf(p.id, who)]));
      setReceipts(Object.fromEntries(entries));
    } catch (error) {
      setStatus(`Cannot reach ${network.label}. Is it running, and is this the right network?`);
    }
  }, [reader, readContracts, network]);

  useEffect(() => {
    refresh();
    // A public endpoint is shared by everyone with the page open, so poll gently
    // there, and not at all while the tab is hidden.
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, pollInterval(network));
    return () => clearInterval(timer);
  }, [refresh, account, network]);

  const open = proposals.filter((p) => STATE[Number(p.state)] === "Active");
  const upcoming = proposals.filter((p) => STATE[Number(p.state)] === "Pending" && !p.cancelled);
  const settled = proposals.filter((p) => ["Closed", "Decided"].includes(STATE[Number(p.state)]) || p.cancelled);

  const canAddToWallet = !local && typeof window !== "undefined" && window.ethereum;

  async function addNetwork() {
    setWalletNote(null);
    try {
      await addToWallet(window.ethereum, network);
      setWalletNote(`${network.label} is in your wallet.`);
    } catch (error) {
      setWalletNote(error?.code === 4001 ? "You declined to add the network." : error?.message || "The wallet would not add the network.");
    }
  }

  function chooseNetwork(key) {
    const next = NETWORKS.find((n) => n.key === key);
    if (!next) return;
    rememberNetwork(key);
    onNetwork(next);
  }

  return (
    <div className="page">
      <header className="strip">
        <div className="strip-left">
          <span className="wordmark">Sabha</span>
          {NETWORKS.length > 1 ? (
            <label className="strip-select">
              <span className="visually-hidden">Network</span>
              <select value={network.key} onChange={(e) => chooseNetwork(e.target.value)}>
                {NETWORKS.map((n) => (
                  <option key={n.key} value={n.key}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="strip-fact">{network.label}</span>
          )}
          <span className="strip-fact">block {blockNumber}</span>
          <span className="strip-fact">chain {network.chainId}</span>
          <span className="strip-fact" title={network.contracts.DirectDemocracy.address}>
            ballots at {short(network.contracts.DirectDemocracy.address)}
          </span>
        </div>
        <div className="strip-right">
          {mode === "node" ? (
            <select value={account || ""} onChange={(e) => chooseAccount(e.target.value)} aria-label="Account">
              {accounts.map((address) => (
                <option key={address} value={address}>
                  {directory[address.toLowerCase()] || short(address)}
                </option>
              ))}
            </select>
          ) : (
            <span className="strip-fact">{account ? short(account) : "reading only"}</span>
          )}
          {mode === "read" && (
            <button className="link" onClick={() => setMode("wallet")}>
              connect a wallet
            </button>
          )}
          {mode === "wallet" && !account && (
            <button className="link" onClick={() => setAttempt((n) => n + 1)}>
              try connecting again
            </button>
          )}
          {canAddToWallet && (
            <button className="link" onClick={addNetwork}>
              add this network to my wallet
            </button>
          )}
          {local && (
            <button className="link" onClick={() => setMode(mode === "node" ? "wallet" : "node")}>
              {mode === "node" ? "use a browser wallet" : "use a node account"}
            </button>
          )}
          {!local && mode === "wallet" && account && (
            <button className="link" onClick={() => setMode("read")}>
              disconnect
            </button>
          )}
        </div>
      </header>

      <main>
        <div className="intro">
          <h1>Decisions this society has put to its members</h1>
          <p>
            Every vote below is a transaction on a permissioned chain the society runs itself. One enrolled member
            casts one vote, and the count is recomputable by anyone with a copy of the ledger.
          </p>
          {account && (
            <p className="standing">
              Acting as {directory[account.toLowerCase()] || short(account)} ·{" "}
              {roles.member ? "on the roster" : "not on the roster, so voting is closed to this wallet"}
              {roles.proposer || roles.registrar ? " · holds officer rights" : ""}
            </p>
          )}
        </div>

        {status && <p className="status">{status}</p>}
        {walletNote && <p className="note">{walletNote}</p>}

        <Section title="Open now" empty="Nothing is open for voting.">
          {open.map((p) => (
            <Ballot
              key={p.id}
              proposal={p}
              voting={writeContracts?.voting}
              account={account}
              receipt={receipts[p.id]}
              directory={directory}
              onChange={refresh}
            />
          ))}
        </Section>

        {upcoming.length > 0 && (
          <Section title="Opening soon">
            {upcoming.map((p) => (
              <Ballot
                key={p.id}
                proposal={p}
                voting={writeContracts?.voting}
                account={account}
                receipt={receipts[p.id]}
                directory={directory}
                onChange={refresh}
              />
            ))}
          </Section>
        )}

        <Section title="Decided" empty="Nothing has been counted yet.">
          {settled.map((p) => (
            <Ballot
              key={p.id}
              proposal={p}
              voting={writeContracts?.voting}
              account={account}
              receipt={receipts[p.id]}
              directory={directory}
              onChange={refresh}
            />
          ))}
        </Section>

        {(roles.proposer || roles.registrar) && writeContracts && (
          <Section title="Officer desk">
            <OfficerPanel registry={writeContracts.registry} voting={writeContracts.voting} onChange={refresh} />
          </Section>
        )}
      </main>

      <footer>
        <p>
          Registry {network.contracts.MemberRegistry.address} · deployed from block{" "}
          {network.contracts.MemberRegistry.block} · reading {network.rpcUrl}
        </p>
      </footer>
    </div>
  );
}

function Section({ title, empty, children }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      {items.length > 0 ? items : empty ? <p className="empty">{empty}</p> : null}
    </section>
  );
}
