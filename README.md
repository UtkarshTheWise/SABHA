# Sabha

A permissioned blockchain voting system for small organisations: student
councils, resident welfare associations, cooperatives. One verified member gets
one vote, and the count can be recomputed by anyone holding a copy of the ledger
rather than trusted from a single administrator.

This is the implementation of the Direct Democracy project proposal (Blockchain
Digital Assignment). Scoping it to a known membership set is deliberate. It
sidesteps the two problems that sink public-chain voting — proving identity at
national scale, and coercion in an environment nobody controls — while keeping
the property that actually matters to a society: a result nobody can quietly
edit after the fact.

Utkarsh Mishra (25BCE1508) and Aanya Tomar (25BCE5384), VIT Chennai.

## What is here

```
contracts/          Solidity: MemberRegistry, DirectDemocracy
test/               54 tests covering both contracts
scripts/            deploy, seed, and a nine-step workflow demonstration
frontend/           React + ethers dashboard
besu/               four-validator QBFT network (Docker)
deployments/        addresses and transaction hashes, written by deploy.js
```

## Running it

You need Node 18 or newer. Docker only if you want the four-node network.

```bash
npm install
npm test                    # 54 tests, in-process chain

npm run node                # terminal 1: a chain on localhost:8545
npm run deploy              # terminal 2
npm run seed                #   eight members, three proposals
npm run demo                #   the whole workflow, with real tx hashes

npm --prefix frontend install
npm run frontend            # http://127.0.0.1:5173
```

`deploy.js` writes the ABIs and addresses into `frontend/src/chain/`, so the UI
never reaches into Hardhat's build output and never needs a hardcoded address.

For the permissioned network, see [besu/README.md](besu/README.md).

## Architecture

Three layers, each answering one question.

**Identity — `MemberRegistry`.** Who is a member. A registrar maps a wallet
address to a member record holding `keccak256(registration number)`. The number
itself never reaches the chain; the society keeps the plaintext register on its
own machine. Members can be suspended and reinstated, and the roster keeps the
historical record either way, so a past vote stays attributable even after
somebody leaves.

**Rules — `DirectDemocracy`.** What counts as a valid vote. Holds the proposal
registry, the vote log and the tally. It reads eligibility from the registry
rather than keeping its own list, which means identity and voting can be
revised independently.

**Consensus — Besu QBFT.** Whether a transaction is committed at all. Four
validators, immediate finality, one faulty validator tolerated.

The frontend is a reader of all three, not a gatekeeper for any of them. Hiding
the vote button from a non-member is a courtesy; the contract refusing the
transaction is the actual control.

## The nine-step workflow

`scripts/demo.js` walks the sequence from Figure 2 of the proposal against a
live chain and prints the transaction hash, block number and gas for every
write, so the demonstration is auditable rather than narrated.

1. An officer opens a proposal with a fixed voting window.
2. The proposal becomes readable from the ledger by every node.
3. The identity layer decides who may vote.
4. A member submits a signed vote.
5. The contract checks: is the window open, is the caller an active member, has
   this address already been counted.
6. The vote is committed to a block by consensus.
7. The record is permanent and independently checkable.
8. The window closes and the tally is published on chain.
9. The dashboard, and any auditor, reads the same published result.

Step 9 is worth running twice. The demo rebuilds the tally from `VoteCast` event
logs alone and asserts it matches what the contract itself reports. If those two
numbers ever disagree, the contract is wrong, and you would rather find that out
from a script than from a member.

## Contract reference

### MemberRegistry

| Function | Who can call | What it does |
| --- | --- | --- |
| `enrol(address, bytes32)` | registrar | Adds one wallet with a hashed identifier |
| `enrolBatch(address[], bytes32[])` | registrar | The same, in one transaction |
| `suspend(address)` | registrar | Removes voting rights, keeps the record |
| `reinstate(address)` | registrar | Restores them |
| `isActiveMember(address)` | anyone | The eligibility check the voting contract uses |
| `activeMemberCount()` | anyone | The electorate size |
| `roster()` | anyone | Everyone ever enrolled |

Roles: `DEFAULT_ADMIN_ROLE` grants and revokes `REGISTRAR_ROLE`. The deployer
gets both, so a one-officer society works without any setup.

### DirectDemocracy

| Function | Who can call | What it does |
| --- | --- | --- |
| `createProposal(title, description, options[], opensAt, closesAt, quorumBps)` | proposer | Registers a question and snapshots the electorate |
| `castVote(proposalId, option)` | active members | One vote, once, inside the window |
| `finaliseProposal(proposalId)` | anyone | Computes and publishes the outcome |
| `cancelProposal(proposalId)` | admin | Withdraws a proposal before voting opens |
| `tallyOf(proposalId)` | anyone | Current counts per option |
| `receiptOf(proposalId, voter)` | anyone | How an address was recorded, and in which block |
| `receiptHash(proposalId, voter)` | anyone | A digest a member can keep and re-derive |
| `listProposals(offset, limit)` | anyone | Paged, newest first, for the dashboard |

A proposal moves through `Pending → Active → Closed → Finalised` on the clock,
not on anybody's say-so. `finaliseProposal` is open to any caller on purpose:
the result is a pure function of data already on chain, so restricting it to an
officer would add a gatekeeper without adding a safeguard.

Quorum is stored in basis points against the electorate snapshotted when the
proposal was created, so enrolling ten new members mid-vote cannot move the bar.
Missing quorum does not void the result; it marks it, and the interface reports
it as advisory.

## Testing

```
54 passing
```

Coverage is aimed at the failure modes rather than the happy path. Double
voting, wallets that were never enrolled, members suspended after a proposal
opened, option indices that do not exist, votes before the window opens and
after it closes, turnout exactly on the quorum line, ties, ballots nobody voted
on, a second finalisation, votes arriving after finalisation, and a revoked
registrar trying to enrol.

Two tests are about trust rather than correctness: one asserts that the raw
registration number is nowhere in the stored record, and one rebuilds the tally
from event logs and compares it against the contract's own count.

## Known gaps

Kept here rather than in the report, because they are the honest list.

- **Ballots are not secret.** Anyone can read how an address voted. For a
  society that publishes its minutes this is often correct, and for a
  contested motion it is not. Anonymous ballots need zero-knowledge proofs,
  which is future work.
- **The registrar is trusted.** Whoever holds `REGISTRAR_ROLE` decides who is on
  the roster, and the chain will faithfully record a rigged roster. Splitting
  the role across office bearers with a multisig is the obvious next step.
- **Wallet custody is the weakest link.** A member who loses their key loses
  their vote, and a member who shares it has given it away. This is the real
  onboarding problem for non-technical users, not the blockchain part.
- **Ties are reported, not resolved.** The contract flags a tie and stops. The
  society's own rules should decide what happens next.
