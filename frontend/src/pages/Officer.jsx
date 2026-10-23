/**
 * The officer desk. Opening a ballot and keeping the roster are the two jobs the
 * contracts give an officer; each is a form that says in advance what it will do
 * and in words afterwards what it did. The page only offers these to a wallet that
 * holds the role, but the contracts are what enforce it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useLocale } from "../i18n/index.jsx";
import { identifierHash } from "../lib/chain.js";
import { nameOf } from "../lib/directory.js";
import { formatDate, formatNumber, shorten } from "../lib/format.js";
import { useRoute, Link } from "../router.jsx";
import { useChain } from "../state/chain.jsx";
import { useNetwork } from "../state/network.jsx";
import { useSend } from "../state/send.js";
import { useUi } from "../state/ui.jsx";
import { useWallet } from "../state/wallet.jsx";
import Field from "../components/Field.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { EmptyState, ErrorState, Skeleton } from "../components/States.jsx";
import TxPanel from "../components/TxPanel.jsx";

const HOUR = 3600;
const OPENING_DELAY = 30; // seconds: long enough for the transaction to land before the window starts

function BallotForm({ sender }) {
  const { t, lang } = useLocale();
  const { contracts } = useNetwork();
  const { ballots } = useChain();
  const electorate = ballots[0]?.electorate;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState("");
  const [hours, setHours] = useState("48");
  const [quorum, setQuorum] = useState("50");
  const [touched, setTouched] = useState(false);

  const list = useMemo(() => options.split("\n").map((o) => o.trim()).filter(Boolean), [options]);
  const problems = {
    title: title.trim() ? null : t("officer.ballot.needTitle"),
    options: list.length >= 2 && list.length <= 16 ? null : t("officer.ballot.needOptions"),
    hours: Number(hours) >= 1 && Number.isFinite(Number(hours)) ? null : t("officer.ballot.needHours"),
    quorum: Number(quorum) >= 0 && Number(quorum) <= 100 && quorum !== "" ? null : t("officer.ballot.needQuorum"),
  };
  const invalid = Object.values(problems).some(Boolean);
  const show = (name) => (touched ? problems[name] : null);

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    const now = Math.floor(Date.now() / 1000);
    const result = await sender.send("create", (signer) =>
      contracts.voting
        .connect(signer)
        .createProposal(title.trim(), description.trim(), list, now + OPENING_DELAY, now + OPENING_DELAY + Math.round(Number(hours) * HOUR), Math.round(Number(quorum) * 100))
    );
    if (result?.phase === "confirmed") {
      setTitle("");
      setDescription("");
      setOptions("");
      setTouched(false);
    }
  }

  return (
    <form className="form stack" onSubmit={submit} noValidate>
      <Field id="b-title" label={t("officer.ballot.question")} error={show("title")} required requiredWord={t("form.required")}>
        {(p) => <input {...p} type="text" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field id="b-desc" label={t("officer.ballot.background")} help={t("officer.ballot.backgroundHelp")}>
        {(p) => <textarea {...p} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Field id="b-options" label={t("officer.ballot.options")} help={t("officer.ballot.optionsHelp", { count: list.length })} error={show("options")} required requiredWord={t("form.required")}>
        {(p) => <textarea {...p} rows={4} value={options} onChange={(e) => setOptions(e.target.value)} />}
      </Field>
      <div className="form__row">
        <Field id="b-hours" label={t("officer.ballot.duration")} help={t("officer.ballot.durationHelp", { delay: OPENING_DELAY })} error={show("hours")} required requiredWord={t("form.required")}>
          {(p) => <input {...p} type="number" inputMode="numeric" min="1" step="1" value={hours} onChange={(e) => setHours(e.target.value)} />}
        </Field>
        <Field
          id="b-quorum"
          label={t("officer.ballot.quorum")}
          help={electorate ? t("officer.ballot.quorumHelp", { electorate: formatNumber(electorate, lang) }) : t("officer.ballot.quorumHelpPlain")}
          error={show("quorum")}
          required
          requiredWord={t("form.required")}
        >
          {(p) => <input {...p} type="number" inputMode="numeric" min="0" max="100" step="1" value={quorum} onChange={(e) => setQuorum(e.target.value)} />}
        </Field>
      </div>
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={sender.busy} aria-busy={sender.busy}>
          {sender.busy ? t("tx.working") : t("officer.ballot.open")}
        </button>
      </div>
    </form>
  );
}

function Roster({ sender }) {
  const { t, lang } = useLocale();
  const { reader, contracts } = useNetwork();
  const { me, blockNumber } = useChain();
  const [state, setState] = useState({ phase: "loading", members: [], error: null });
  const [address, setAddress] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [touched, setTouched] = useState(false);

  const load = useCallback(async () => {
    try {
      const roster = await contracts.registry.roster();
      const members = await Promise.all(
        roster.map(async (account) => {
          const m = await contracts.registry.memberOf(account);
          return { account, active: m.active, enrolledAt: Number(m.enrolledAt) };
        })
      );
      setState({ phase: "ready", members, error: null });
    } catch (error) {
      setState((s) => ({ ...s, phase: "error", error }));
    }
  }, [contracts]);

  // reload when a block arrives, so a change an officer just made shows
  useEffect(() => {
    load();
  }, [load, blockNumber]);

  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  const problems = {
    address: isAddress ? null : t("officer.roster.needAddress"),
    identifier: identifier.trim() ? null : t("officer.roster.needIdentifier"),
  };
  const show = (name) => (touched ? problems[name] : null);

  async function enrol(event) {
    event.preventDefault();
    setTouched(true);
    if (problems.address || problems.identifier) return;
    const result = await sender.send("enrol", (signer) => contracts.registry.connect(signer).enrol(address.trim(), identifierHash(identifier)));
    if (result?.phase === "confirmed") {
      setAddress("");
      setIdentifier("");
      setTouched(false);
      load();
    }
  }

  const act = async (kind, account) => {
    const result = await sender.send(kind, (signer) => contracts.registry.connect(signer)[kind](account));
    if (result?.phase === "confirmed") load();
  };

  return (
    <div className="stack">
      {state.phase === "loading" && <Skeleton rows={4} />}
      {state.phase === "error" && (
        <ErrorState title={t("officer.roster.error")} onRetry={load}>
          {t("officer.roster.errorBody")}
        </ErrorState>
      )}
      {state.phase === "ready" && state.members.length === 0 && (
        <EmptyState title={t("officer.roster.empty.title")}>{t("officer.roster.empty.body")}</EmptyState>
      )}
      {state.phase === "ready" && state.members.length > 0 && (
        <div className="scroll-x">
          <table className="ledger">
            <caption className="visually-hidden">{t("officer.roster.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("officer.roster.member")}</th>
                <th scope="col">{t("officer.roster.status")}</th>
                <th scope="col">{t("officer.roster.enrolled")}</th>
                <th scope="col">{t("officer.roster.action")}</th>
              </tr>
            </thead>
            <tbody>
              {state.members.map((m) => (
                <tr key={m.account}>
                  <th scope="row">
                    <span className="block">{nameOf(m.account) || shorten(m.account)}</span>
                    {nameOf(m.account) && <span className="muted num">{shorten(m.account)}</span>}
                  </th>
                  <td>{m.active ? t("officer.roster.active") : t("officer.roster.suspended")}</td>
                  <td>{formatDate(m.enrolledAt, lang)}</td>
                  <td>
                    {me.roles.registrar && (
                      <button type="button" className="btn btn--small" disabled={sender.busy} onClick={() => act(m.active ? "suspend" : "reinstate", m.account)}>
                        {m.active ? t("officer.roster.suspend") : t("officer.roster.reinstate")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {me.roles.registrar && (
        <form className="form stack" onSubmit={enrol} noValidate>
          <h3>{t("officer.roster.addTitle")}</h3>
          <Field id="m-address" label={t("officer.roster.address")} error={show("address")} required requiredWord={t("form.required")}>
            {(p) => <input {...p} type="text" autoComplete="off" spellCheck="false" value={address} onChange={(e) => setAddress(e.target.value)} />}
          </Field>
          <Field id="m-id" label={t("officer.roster.identifier")} help={t("officer.roster.identifierHelp")} error={show("identifier")} required requiredWord={t("form.required")}>
            {(p) => <input {...p} type="text" autoComplete="off" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />}
          </Field>
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={sender.busy} aria-busy={sender.busy}>
              {sender.busy ? t("tx.working") : t("officer.roster.add")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function Officer() {
  const { t } = useLocale();
  const { account } = useWallet();
  const { me } = useChain();
  const { openWallet } = useUi();
  const { query } = useRoute();
  const sender = useSend();
  const tab = query.get("tab") === "roster" ? "roster" : "ballot";
  const isOfficer = me.roles.registrar || me.roles.proposer || me.roles.admin;

  if (!account) {
    return (
      <>
        <PageHeader title={t("officer.title")} />
        <EmptyState
          title={t("officer.noWallet.title")}
          action={
            <button type="button" className="btn btn--primary" onClick={openWallet}>
              {t("wallet.connect")}
            </button>
          }
        >
          {t("officer.noWallet.body")}
        </EmptyState>
      </>
    );
  }
  if (me.status !== "ready") {
    return (
      <>
        <PageHeader title={t("officer.title")} />
        <Skeleton rows={3} />
      </>
    );
  }
  if (!isOfficer) {
    return (
      <>
        <PageHeader title={t("officer.title")} />
        <EmptyState title={t("officer.noAccess.title")}>{t("officer.noAccess.body")}</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("officer.title")} lede={t("officer.lede")} />
      <nav className="filters" aria-label={t("officer.tabs.label")}>
        <ul>
          <li>
            <Link to={["officer"]} aria-current={tab === "ballot" ? "true" : undefined}>
              {t("officer.tabs.ballot")}
            </Link>
          </li>
          <li>
            <Link to={["officer"]} query={{ tab: "roster" }} aria-current={tab === "roster" ? "true" : undefined}>
              {t("officer.tabs.roster")}
            </Link>
          </li>
        </ul>
      </nav>
      {tab === "ballot" ? (
        me.roles.proposer ? (
          <BallotForm sender={sender} />
        ) : (
          <EmptyState title={t("officer.noProposer.title")}>{t("officer.noProposer.body")}</EmptyState>
        )
      ) : (
        <Roster sender={sender} />
      )}
      <TxPanel tx={sender.tx} onDismiss={sender.dismiss} />
    </>
  );
}
