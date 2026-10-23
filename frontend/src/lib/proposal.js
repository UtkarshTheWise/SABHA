/**
 * Reading a proposal the way a member needs it: where it is in its life, what
 * the result means, and which of those words is on the screen. No React, no
 * chain calls; times are in seconds since the epoch.
 */
import { isTied, leaders, quorumMet, quorumNeeded, totalOf } from "./tally.js";

/** The contract's State enum, in order. */
export const CONTRACT_STATES = ["pending", "active", "closed", "finalised"];

/** The four stages a ballot passes through, in order. */
export const STAGES = ["pending", "active", "closed", "finalised"];

/**
 * Which stage a ballot is in. The clock decides, as it does on the chain, but a
 * node may be a block behind real time, so a finished or withdrawn ballot is
 * taken from the contract and everything else from the clock.
 */
export function stageOf(proposal, now) {
  if (proposal.cancelled) return "withdrawn";
  if (proposal.finalised || CONTRACT_STATES[Number(proposal.state)] === "finalised") return "finalised";
  if (now < Number(proposal.opensAt)) return "pending";
  if (now < Number(proposal.closesAt)) return "active";
  return "closed";
}

/**
 * The four steps of the timeline, each done, current or still to come, with the
 * moment it starts (null where the chain does not record one).
 */
export function timeline(proposal, now) {
  const stage = stageOf(proposal, now);
  if (stage === "withdrawn") return { stage, steps: [] };
  const current = STAGES.indexOf(stage);
  const starts = [Number(proposal.createdAt) || null, Number(proposal.opensAt), Number(proposal.closesAt), null];
  const steps = STAGES.map((name, i) => ({
    name,
    state: stage === "finalised" ? "done" : i < current ? "done" : i === current ? "current" : "next",
    at: starts[i],
  }));
  return { stage, steps };
}

/** Seconds until the ballot's next change, or null once nothing more happens by the clock. */
export function secondsToNextChange(proposal, now) {
  const stage = stageOf(proposal, now);
  if (stage === "pending") return Number(proposal.opensAt) - now;
  if (stage === "active") return Number(proposal.closesAt) - now;
  return null;
}

/**
 * What the result means, as one of a few named cases, so the screen can say each
 * in words and never lean on colour. `quorum` is a plain fact about turnout.
 *
 *   counting  closed, nobody has asked for the count yet (a preview)
 *   carried   counted, quorum met, one option ahead
 *   advisory  counted, one option ahead, but turnout missed the quorum
 *   tied      counted, two or more options share the top count
 *   no_votes  counted, nobody voted
 */
export function outcomeOf(proposal) {
  const tally = proposal.tally.map(Number);
  const total = Number(proposal.totalVotes) || totalOf(tally);
  const electorate = Number(proposal.electorate);
  const bps = Number(proposal.quorumBps);
  const needed = quorumNeeded(electorate, bps);
  const met = quorumMet(total, electorate, bps);
  const lead = leaders(tally);

  const base = {
    total,
    electorate,
    needed,
    quorumMet: met,
    leading: lead.indexes,
    tie: isTied(tally),
  };

  if (!proposal.finalised) return { ...base, kind: "counting", winner: lead.indexes.length === 1 ? lead.indexes[0] : null };
  if (total === 0) return { ...base, kind: "no_votes", winner: null };
  if (proposal.tied) return { ...base, kind: "tied", winner: null };
  const winner = Number(proposal.winningOption);
  return { ...base, kind: met ? "carried" : "advisory", winner };
}

/** Turnout against the electorate that was fixed when the ballot was created. */
export function turnoutOf(proposal) {
  const total = Number(proposal.totalVotes);
  const electorate = Number(proposal.electorate);
  return {
    total,
    electorate,
    needed: quorumNeeded(electorate, proposal.quorumBps),
    percent: electorate === 0 ? 0 : Math.min(100, Math.round((total / electorate) * 100)),
    quorumPercent: Math.min(100, Math.round(Number(proposal.quorumBps) / 100)),
  };
}

/** Split a number of seconds into the units a countdown shows. */
export function splitDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return { days, hours, minutes, seconds: s % 60 };
}

/** The two largest non-zero units, e.g. [["day", 2], ["hour", 3]]; a minute is the floor. */
export function countdownUnits(seconds) {
  const { days, hours, minutes } = splitDuration(seconds);
  const parts = [];
  if (days) parts.push(["day", days]);
  if (hours) parts.push(["hour", hours]);
  if (minutes && parts.length < 2 && !(days && hours)) parts.push(["minute", minutes]);
  if (parts.length === 0) return [["minute", 0]]; // under a minute
  return parts.slice(0, 2);
}
