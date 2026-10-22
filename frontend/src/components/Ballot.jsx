import { useState } from "react";
import TallyMarks from "./TallyMarks";
import { STATE, countdown, explain, short } from "../lib/chain";

export default function Ballot({ proposal, voting, account, receipt, directory, onChange }) {
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const state = STATE[Number(proposal.state)];
  const tally = proposal.tally.map(Number);
  const total = Number(proposal.totalVotes);
  const electorate = Number(proposal.electorate);
  const quorum = Math.ceil((electorate * Number(proposal.quorumBps)) / 10000);
  const highest = Math.max(...tally, 0);
  const proposerName = directory[proposal.proposer.toLowerCase()];

  async function send(label, call) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const tx = await call();
      setNote(`Sent. Waiting for the block that includes ${short(tx.hash)}.`);
      const confirmed = await tx.wait();
      setNote(`Recorded in block ${confirmed.blockNumber}.`);
      await onChange();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  const canVote = state === "Active" && account && !receipt?.voted;

  return (
    <article className={`slip slip-${state.toLowerCase()}`}>
      <header className="slip-head">
        <h2>{proposal.title}</h2>
        <p className="slip-meta">
          Ballot {String(proposal.id)} · opened by {proposerName || short(proposal.proposer)} ·{" "}
          {state === "Active" ? countdown(proposal.closesAt) : state === "Pending" ? "not open yet" : state.toLowerCase()}
        </p>
      </header>

      <p className="slip-body">{proposal.description}</p>

      <div className="tallies">
        {proposal.options.map((option, i) => (
          <div className="tally-row" key={i}>
            <span className="option-name">{option}</span>
            <span className="tally-marks">
              <TallyMarks count={tally[i]} leading={highest > 0 && tally[i] === highest} />
            </span>
            <span className="option-count">{tally[i]}</span>
          </div>
        ))}
      </div>

      <p className="turnout">
        {total} of {electorate} members have voted. {quorum} needed for the result to count.
      </p>

      {canVote && (
        <div className="choices">
          {proposal.options.map((option, i) => (
            <button
              key={i}
              className="choice"
              disabled={busy !== null}
              onClick={() => send(`vote-${i}`, () => voting.castVote(proposal.id, i))}
            >
              {busy === `vote-${i}` ? "Sending\u2026" : option}
            </button>
          ))}
        </div>
      )}

      {receipt?.voted && (
        <p className="receipt">
          You voted {proposal.options[Number(receipt.option)]}, recorded in block {String(receipt.blockNumber)}.
        </p>
      )}

      {state === "Closed" && !proposal.cancelled && account && (
        <div className="choices">
          <button
            className="choice count-now"
            disabled={busy !== null}
            onClick={() => send("finalise", () => voting.finaliseProposal(proposal.id))}
          >
            {busy === "finalise" ? "Counting\u2026" : "Count the votes"}
          </button>
        </div>
      )}

      {state === "Decided" && (
        <p className="outcome">
          {proposal.tied
            ? "No outcome: the vote was tied."
            : `Carried: ${proposal.options[Number(proposal.winningOption)]}.`}{" "}
          {proposal.quorumMet ? "Quorum was met." : "Quorum was not met, so the result is advisory."}
        </p>
      )}

      {proposal.cancelled && <p className="outcome">Withdrawn before voting opened.</p>}

      {note && <p className="note">{note}</p>}
      {error && <p className="error">{error}</p>}
    </article>
  );
}
