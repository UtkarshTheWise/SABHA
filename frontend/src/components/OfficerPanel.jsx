import { useState } from "react";
import { explain, identifierHash } from "../lib/chain";

const HOURS = 60 * 60;

export default function OfficerPanel({ registry, voting, onChange }) {
  const [tab, setTab] = useState("ballot");

  return (
    <section className="officer">
      <div className="officer-tabs">
        <button className={tab === "ballot" ? "tab on" : "tab"} onClick={() => setTab("ballot")}>
          Open a ballot
        </button>
        <button className={tab === "member" ? "tab on" : "tab"} onClick={() => setTab("member")}>
          Add a member
        </button>
      </div>
      {tab === "ballot" ? (
        <BallotForm voting={voting} onChange={onChange} />
      ) : (
        <MemberForm registry={registry} onChange={onChange} />
      )}
    </section>
  );
}

function useSubmit(onChange) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  async function submit(call, successMessage) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const tx = await call();
      const confirmed = await tx.wait();
      setNote(`${successMessage} Block ${confirmed.blockNumber}.`);
      await onChange();
      return true;
    } catch (err) {
      setError(explain(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, note, error, submit };
}

function BallotForm({ voting, onChange }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState("For\nAgainst\nAbstain");
  const [hours, setHours] = useState(48);
  const [quorum, setQuorum] = useState(50);
  const { busy, note, error, submit } = useSubmit(onChange);

  const parsed = options
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);

  async function open() {
    const now = Math.floor(Date.now() / 1000);
    const ok = await submit(
      () =>
        voting.createProposal(
          title.trim(),
          description.trim(),
          parsed,
          now + 30,
          now + Number(hours) * HOURS,
          Math.round(Number(quorum) * 100)
        ),
      "Ballot opened."
    );
    if (ok) {
      setTitle("");
      setDescription("");
    }
  }

  return (
    <div className="form">
      <label>
        Question
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Raise the annual fee to Rs 500" />
      </label>
      <label>
        Background for members
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Options, one per line
        <textarea rows={3} value={options} onChange={(e) => setOptions(e.target.value)} />
      </label>
      <div className="form-row">
        <label>
          Open for
          <span className="with-unit">
            <input type="number" min="1" value={hours} onChange={(e) => setHours(e.target.value)} /> hours
          </span>
        </label>
        <label>
          Quorum
          <span className="with-unit">
            <input type="number" min="0" max="100" value={quorum} onChange={(e) => setQuorum(e.target.value)} /> percent
          </span>
        </label>
      </div>
      <button className="primary" disabled={busy || !title.trim() || parsed.length < 2} onClick={open}>
        {busy ? "Opening\u2026" : "Open the ballot"}
      </button>
      {note && <p className="note">{note}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function MemberForm({ registry, onChange }) {
  const [address, setAddress] = useState("");
  const [identifier, setIdentifier] = useState("");
  const { busy, note, error, submit } = useSubmit(onChange);

  async function enrol() {
    const ok = await submit(() => registry.enrol(address.trim(), identifierHash(identifier)), "Member enrolled.");
    if (ok) {
      setAddress("");
      setIdentifier("");
    }
  }

  return (
    <div className="form">
      <label>
        Wallet address
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x\u2026" />
      </label>
      <label>
        Registration number
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="25BCE1508" />
      </label>
      <p className="hint">
        Only the hash of the registration number reaches the chain. The number itself stays in the society register.
      </p>
      <button className="primary" disabled={busy || !address.trim() || !identifier.trim()} onClick={enrol}>
        {busy ? "Enrolling\u2026" : "Add to the roster"}
      </button>
      {note && <p className="note">{note}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
