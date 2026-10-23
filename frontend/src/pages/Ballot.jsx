/**
 * One ballot, top to bottom: where it is in its life, what it asks, what the count
 * is and means, then what the viewer can do about it (vote, count, withdraw) and
 * how to check it against the ledger. Facts about how it is decided sit beside the
 * count on a wide screen and below it on a phone.
 */
import { useEffect, useState } from "react";

import { useLocale } from "../i18n/index.jsx";
import { normaliseBallot } from "../lib/chain.js";
import { nameOf } from "../lib/directory.js";
import { formatDateTime, formatNumber, shorten } from "../lib/format.js";
import { stageOf } from "../lib/proposal.js";
import { Link, useRoute } from "../router.jsx";
import { useChain, useNow } from "../state/chain.jsx";
import { useNetwork } from "../state/network.jsx";
import { useSend } from "../state/send.js";
import { useUi } from "../state/ui.jsx";
import { useWallet } from "../state/wallet.jsx";
import Outcome from "../components/Outcome.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Results from "../components/Results.jsx";
import { EmptyState, ErrorState, Skeleton } from "../components/States.jsx";
import Timeline from "../components/Timeline.jsx";
import TxPanel from "../components/TxPanel.jsx";
import Turnout from "../components/Turnout.jsx";
import Verify from "../components/Verify.jsx";
import VoteForm from "../components/VoteForm.jsx";
import { quorumNeeded } from "../lib/tally.js";

/** The ballot from the polled list, or, if it is older than the page holds, read on its own. */
function useBallot(id) {
  const { ballots, status } = useChain();
  const { contracts } = useNetwork();
  const listed = ballots.find((b) => b.id === id);
  const [own, setOwn] = useState({ id: null, phase: "idle", ballot: null });

  useEffect(() => {
    if (listed || status === "loading" || !Number.isInteger(id)) return undefined;
    let live = true;
    setOwn({ id, phase: "loading", ballot: null });
    contracts.voting
      .getProposal(id)
      .then((p) => live && setOwn({ id, phase: "ready", ballot: normaliseBallot(p) }))
      .catch((error) => live && setOwn({ id, phase: /UnknownProposal/.test(String(error?.message ?? error)) || error?.revert?.name === "UnknownProposal" ? "missing" : "error", ballot: null }));
    return () => {
      live = false;
    };
  }, [id, listed, status, contracts]);

  if (listed) return { phase: "ready", ballot: listed };
  if (status === "loading") return { phase: "loading", ballot: null };
  if (own.id === id) return own;
  return { phase: "loading", ballot: null };
}

export default function BallotPage() {
  const { t, lang } = useLocale();
  const { network, contracts } = useNetwork();
  const { path } = useRoute();
  const { account } = useWallet();
  const { me, refresh } = useChain();
  const { openWallet } = useUi();
  const sender = useSend();
  const id = /^\d+$/.test(path[1] ?? "") ? Number(path[1]) : NaN;
  const { phase, ballot } = useBallot(id);
  const now = useNow(1000);

  if (phase === "loading") return <Skeleton rows={5} label={t("ballot.loading")} />;
  if (phase === "error") {
    return (
      <ErrorState title={t("ballot.error.title")} onRetry={refresh}>
        {t("ballot.error.body", { network: network.label })}
      </ErrorState>
    );
  }
  if (!ballot) {
    return (
      <>
        <PageHeader title={t("ballot.notFound.title")} />
        <EmptyState title={t("ballot.notFound.heading")} action={<Link to={[]} className="btn">{t("ballot.back")}</Link>}>
          {t("ballot.notFound.body", { id: Number.isNaN(id) ? String(path[1] ?? "") : id, network: network.label })}
        </EmptyState>
      </>
    );
  }

  const stage = stageOf(ballot, now);
  const proposer = nameOf(ballot.proposer) || shorten(ballot.proposer);
  const needed = quorumNeeded(ballot.electorate, ballot.quorumBps);
  const showActions = stage !== "finalised" && stage !== "withdrawn";

  return (
    <>
      <p className="crumb">
        <Link to={[]}>{t("ballot.back")}</Link>
      </p>
      <PageHeader title={ballot.title}>
        <p className="meta">{t("ballot.openedBy", { who: proposer })}</p>
      </PageHeader>

      <div className="ballot">
        <div className="ballot__main">
          <Timeline ballot={ballot} now={now} />

          <section className="prose" aria-label={t("ballot.about")}>
            <p dir="auto" className="ballot__description">
              {ballot.description}
            </p>
          </section>

          <Outcome ballot={ballot} stage={stage} />
          <Results ballot={ballot} />

          {/* A counted or withdrawn ballot has nothing left to do, so the section stays only for a receipt or the transaction that just ended it. */}
          {(showActions || me.receipts[ballot.id] || sender.tx) && (
          <section className="actions" aria-labelledby="actions-title">
            <h2 id="actions-title">{stage === "closed" ? t("finalise.title") : t("vote.title")}</h2>

            {stage === "closed" ? (
              <div className="stack">
                <p>{t("finalise.body")}</p>
                {account ? (
                  <button type="button" className="btn btn--primary" disabled={sender.busy} aria-busy={sender.busy} onClick={() => sender.send("finalise", (s) => contracts.voting.connect(s).finaliseProposal(ballot.id))}>
                    {sender.busy ? t("tx.working") : t("finalise.action")}
                  </button>
                ) : (
                  <button type="button" className="btn btn--primary" onClick={openWallet}>
                    {t("wallet.connect")}
                  </button>
                )}
              </div>
            ) : (
              <VoteForm ballot={ballot} stage={stage} sender={sender} />
            )}

            {stage === "pending" && me.roles.admin && (
              <div className="stack">
                <h3>{t("withdraw.title")}</h3>
                <p className="muted">{t("withdraw.body")}</p>
                <button type="button" className="btn btn--small" disabled={sender.busy} onClick={() => sender.send("withdraw", (s) => contracts.voting.connect(s).cancelProposal(ballot.id))}>
                  {t("withdraw.action")}
                </button>
              </div>
            )}

            <TxPanel tx={sender.tx} onDismiss={sender.dismiss} />
          </section>
          )}
        </div>

        <aside className="ballot__side" aria-label={t("ballot.facts")}>
          <Turnout ballot={ballot} />

          <section aria-labelledby="rules-title">
            <h3 id="rules-title">{t("rules.title")}</h3>
            <dl className="facts-list">
              <div>
                <dt>{t("rules.opens")}</dt>
                <dd>{formatDateTime(ballot.opensAt, lang)}</dd>
              </div>
              <div>
                <dt>{t("rules.closes")}</dt>
                <dd>{formatDateTime(ballot.closesAt, lang)}</dd>
              </div>
              <div>
                <dt>{t("rules.electorate")}</dt>
                <dd>
                  <span className="num">{formatNumber(ballot.electorate, lang)}</span>
                  <span className="muted block">{t("rules.electorateHelp")}</span>
                </dd>
              </div>
              <div>
                <dt>{t("rules.quorum")}</dt>
                <dd>{t("rules.quorumValue", { percent: formatNumber(ballot.quorumBps / 100, lang), needed: formatNumber(needed, lang) })}</dd>
              </div>
              <div>
                <dt>{t("rules.method")}</dt>
                <dd>{t("rules.methodValue")}</dd>
              </div>
            </dl>
          </section>

          <Verify ballot={ballot} />
        </aside>
      </div>
    </>
  );
}
