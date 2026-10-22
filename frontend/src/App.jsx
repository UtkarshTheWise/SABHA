import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { id as keccakId } from "ethers";

import Ballot from "./components/Ballot";
import OfficerPanel from "./components/OfficerPanel";
import directoryFile from "./chain/directory.json";
import {
  RPC_URL,
  STATE,
  contracts,
  deploymentInfo,
  nodeAccounts,
  readProvider,
  short,
  walletProvider,
} from "./lib/chain";

const REGISTRAR_ROLE = keccakId("REGISTRAR_ROLE");
const PROPOSER_ROLE = keccakId("PROPOSER_ROLE");
const POLL_MS = 4000;

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
  const [mode, setMode] = useState("node");
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState(null);
  const [signer, setSigner] = useState(null);
  const [blockNumber, setBlockNumber] = useState(0);
  const [proposals, setProposals] = useState([]);
  const [receipts, setReceipts] = useState({});
  const [roles, setRoles] = useState({ registrar: false, proposer: false, member: false });
  const [status, setStatus] = useState("Connecting to the node\u2026");

  const reader = useMemo(() => readProvider(), []);
  const readContracts = useMemo(() => contracts(reader), [reader]);
  const writeContracts = useMemo(() => (signer ? contracts(signer) : null), [signer]);
  const signerRef = useRef(null);
  signerRef.current = signer;

  const directory = useMemo(() => {
    const map = {};
    for (const person of directoryFile) map[person.address.toLowerCase()] = person.name;
    return map;
  }, []);

  // --- connect -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function connect() {
      try {
        if (mode === "node") {
          const list = await nodeAccounts(reader);
          if (cancelled) return;
          setAccounts(list);
          const chosen = list.includes(account) ? account : list[1] || list[0];
          setAccount(chosen);
          setSigner(chosen ? await reader.getSigner(chosen) : null);
          setStatus(null);
        } else {
          const browser = await walletProvider();
          const active = await browser.getSigner();
          if (cancelled) return;
          setAccounts([active.address]);
          setAccount(active.address);
          setSigner(active);
          setStatus(null);
        }
      } catch (error) {
        if (!cancelled) setStatus(error.message);
      }
    }
    connect();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function chooseAccount(address) {
    setAccount(address);
    setSigner(await reader.getSigner(address));
  }

  // --- read the chain ----------------------------------------------------
  const refresh = useCallback(async () => {
    try {
      const [height, page] = await Promise.all([
        reader.getBlockNumber(),
        readContracts.voting.listProposals(0, 50),
      ]);
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

      const entries = await Promise.all(
        list.map(async (p) => [p.id, await readContracts.voting.receiptOf(p.id, who)])
      );
      setReceipts(Object.fromEntries(entries));
    } catch (error) {
      setStatus(`Cannot reach the node at ${RPC_URL}. Is it running?`);
    }
  }, [reader, readContracts]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, account]);

  const open = proposals.filter((p) => STATE[Number(p.state)] === "Active");
  const upcoming = proposals.filter((p) => STATE[Number(p.state)] === "Pending" && !p.cancelled);
  const settled = proposals.filter((p) => ["Closed", "Decided"].includes(STATE[Number(p.state)]) || p.cancelled);

  return (
    <div className="page">
      <header className="strip">
        <div className="strip-left">
          <span className="wordmark">Sabha</span>
          <span className="strip-fact">block {blockNumber}</span>
          <span className="strip-fact">chain {deploymentInfo.chainId}</span>
          <span className="strip-fact" title={deploymentInfo.contracts.DirectDemocracy.address}>
            ballots at {short(deploymentInfo.contracts.DirectDemocracy.address)}
          </span>
        </div>
        <div className="strip-right">
          {mode === "node" ? (
            <select value={account || ""} onChange={(e) => chooseAccount(e.target.value)}>
              {accounts.map((address) => (
                <option key={address} value={address}>
                  {directory[address.toLowerCase()] || short(address)}
                </option>
              ))}
            </select>
          ) : (
            <span className="strip-fact">{account ? short(account) : "not connected"}</span>
          )}
          <button className="link" onClick={() => setMode(mode === "node" ? "wallet" : "node")}>
            {mode === "node" ? "use a browser wallet" : "use a node account"}
          </button>
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
          Registry {deploymentInfo.contracts.MemberRegistry.address} · deployed from block{" "}
          {deploymentInfo.contracts.MemberRegistry.block} · reading {RPC_URL}
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
