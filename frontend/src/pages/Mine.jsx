/**
 * The member's own record: which ballots they voted on, how they voted and in which
 * block. Read from the ledger, tied to the connected address, so it needs a wallet
 * and says so rather than showing an empty page.
 */
import { useLocale } from "../i18n/index.jsx";
import { shorten } from "../lib/format.js";
import { stageOf } from "../lib/proposal.js";
import { Link } from "../router.jsx";
import { useChain, useNow } from "../state/chain.jsx";
import { useUi } from "../state/ui.jsx";
import { useWallet } from "../state/wallet.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { EmptyState, ErrorState, Skeleton } from "../components/States.jsx";

export default function Mine() {
  const { t } = useLocale();
  const { account } = useWallet();
  const { status, ballots, me, refresh } = useChain();
  const { openWallet } = useUi();
  const now = useNow(60000);

  const voted = ballots.filter((b) => me.receipts[b.id]);

  return (
    <>
      <PageHeader title={t("mine.title")} lede={t("mine.lede")} />

      {!account ? (
        <EmptyState
          title={t("mine.noWallet.title")}
          action={
            <button type="button" className="btn btn--primary" onClick={openWallet}>
              {t("wallet.connect")}
            </button>
          }
        >
          {t("mine.noWallet.body")}
        </EmptyState>
      ) : status === "error" ? (
        <ErrorState title={t("ballots.error.title")} onRetry={refresh}>
          {t("mine.error")}
        </ErrorState>
      ) : status === "loading" || me.status !== "ready" ? (
        <Skeleton rows={3} />
      ) : voted.length === 0 ? (
        <EmptyState title={t("mine.empty.title")} action={<Link to={[]} query={{ show: "open" }} className="btn">{t("mine.empty.action")}</Link>}>
          {t("mine.empty.body")}
        </EmptyState>
      ) : (
        <>
          <p className="muted">{t("mine.as", { address: shorten(account) })}</p>
          <ul className="records">
            {voted.map((ballot) => {
              const receipt = me.receipts[ballot.id];
              return (
                <li key={ballot.id} className="record">
                  <h2 className="record__title">
                    <Link to={["ballot", String(ballot.id)]} dir="auto">
                      {ballot.title}
                    </Link>
                  </h2>
                  <dl className="record__facts">
                    <div>
                      <dt>{t("mine.yourVote")}</dt>
                      <dd dir="auto">{ballot.options[receipt.option]}</dd>
                    </div>
                    <div>
                      <dt>{t("mine.recorded")}</dt>
                      <dd className="num">{t("mine.block", { block: receipt.blockNumber })}</dd>
                    </div>
                    <div>
                      <dt>{t("ballots.columns.status")}</dt>
                      <dd>{t(`stage.${stageOf(ballot, now)}`)}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
