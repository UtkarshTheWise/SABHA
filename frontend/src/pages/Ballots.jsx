/**
 * Every ballot the society has put to its members. A table where there is room for
 * one, and a list of labelled blocks where there is not (a table squeezed onto a
 * phone loses the column that matters). Filtering lives in the address, so a link
 * to "open ballots" is a link to exactly that.
 */
import { useLocale } from "../i18n/index.jsx";
import { formatNumber } from "../lib/format.js";
import { outcomeOf, stageOf } from "../lib/proposal.js";
import { Link, useRoute } from "../router.jsx";
import { useChain, useNow } from "../state/chain.jsx";
import { useNetwork } from "../state/network.jsx";
import { useMediaQuery } from "../state/ui.jsx";
import { useCountdownText } from "../components/Timeline.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/States.jsx";
import Icon from "../components/Icon.jsx";

const FILTERS = ["all", "open", "soon", "finished"];

const matches = (filter, stage) =>
  filter === "all" ||
  (filter === "open" && stage === "active") ||
  (filter === "soon" && stage === "pending") ||
  (filter === "finished" && (stage === "closed" || stage === "finalised" || stage === "withdrawn"));

function StageLabel({ ballot, stage, now }) {
  const { t } = useLocale();
  const countdown = useCountdownText();
  const remaining = stage === "pending" ? ballot.opensAt - now : stage === "active" ? ballot.closesAt - now : null;
  return (
    <span className={`stage stage--${stage}`}>
      <strong>{t(`stage.${stage}`)}</strong>
      {remaining !== null && (
        <span className="stage__when">{stage === "pending" ? t("time.opensIn", { time: countdown(remaining) }) : t("time.closesIn", { time: countdown(remaining) })}</span>
      )}
    </span>
  );
}

function resultText(ballot, stage, t) {
  if (stage === "withdrawn") return t("ballots.result.withdrawn");
  if (stage === "pending") return t("ballots.result.notOpen");
  if (stage === "active") return t("ballots.result.open");
  if (stage === "closed") return t("ballots.result.uncounted");
  const o = outcomeOf(ballot);
  if (o.kind === "carried") return t("ballots.result.carried", { option: ballot.options[o.winner] });
  if (o.kind === "advisory") return t("ballots.result.advisory", { option: ballot.options[o.winner] });
  if (o.kind === "tied") return t("ballots.result.tied");
  return t("ballots.result.noVotes");
}

export default function Ballots() {
  const { t, lang } = useLocale();
  const { network } = useNetwork();
  const { status, ballots, refresh, me } = useChain();
  const { query } = useRoute();
  const now = useNow(30000);
  const wide = useMediaQuery("(min-width: 60rem)");

  const requested = query.get("show");
  const show = FILTERS.includes(requested) ? requested : "all";
  const rows = ballots.map((ballot) => ({ ballot, stage: stageOf(ballot, now) })).filter(({ stage }) => matches(show, stage));
  const voted = (ballot) => (me.receipts[ballot.id] ? t("ballots.youVoted", { option: ballot.options[me.receipts[ballot.id].option] }) : null);

  return (
    <>
      <PageHeader title={t("ballots.title")} lede={t("ballots.lede")} />

      <nav className="filters" aria-label={t("ballots.filter.label")}>
        <ul>
          {FILTERS.map((f) => (
            <li key={f}>
              <Link to={[]} query={f === "all" ? {} : { show: f }} aria-current={show === f ? "true" : undefined}>
                {t(`ballots.filter.${f}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {status === "loading" && <Skeleton rows={4} label={t("ballots.loading")} />}

      {status === "error" && (
        <ErrorState title={t("ballots.error.title")} onRetry={refresh}>
          {t("ballots.error.body", { network: network.label })}
        </ErrorState>
      )}

      {status === "stale" && <Notice tone="info">{t("ballots.stale")}</Notice>}

      {(status === "ready" || status === "stale") &&
        (rows.length === 0 ? (
          <EmptyState
            title={ballots.length === 0 ? t("ballots.empty.title") : t("ballots.empty.filtered")}
            action={
              ballots.length > 0 ? (
                <Link to={[]} className="btn">
                  {t("ballots.empty.showAll")}
                </Link>
              ) : null
            }
          >
            {ballots.length === 0 ? t("ballots.empty.body") : null}
          </EmptyState>
        ) : wide ? (
          <table className="ledger">
            <caption className="visually-hidden">{t("ballots.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("ballots.columns.question")}</th>
                <th scope="col">{t("ballots.columns.status")}</th>
                <th scope="col" className="num">
                  {t("ballots.columns.turnout")}
                </th>
                <th scope="col">{t("ballots.columns.result")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ballot, stage }) => (
                <tr key={ballot.id}>
                  <th scope="row">
                    <Link to={["ballot", String(ballot.id)]} dir="auto">
                      {ballot.title}
                    </Link>
                    {voted(ballot) && (
                      <span className="ledger__voted">
                        <Icon name="check" size={16} /> {voted(ballot)}
                      </span>
                    )}
                  </th>
                  <td>
                    <StageLabel ballot={ballot} stage={stage} now={now} />
                  </td>
                  <td className="num">{t("ballots.turnout", { votes: formatNumber(ballot.totalVotes, lang), electorate: formatNumber(ballot.electorate, lang) })}</td>
                  <td dir="auto">{resultText(ballot, stage, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul className="ledger-list">
            {rows.map(({ ballot, stage }) => (
              <li key={ballot.id} className="ledger-item">
                <h2 className="ledger-item__title">
                  <Link to={["ballot", String(ballot.id)]} dir="auto">
                    {ballot.title}
                  </Link>
                </h2>
                {voted(ballot) && (
                  <p className="ledger__voted">
                    <Icon name="check" size={16} /> {voted(ballot)}
                  </p>
                )}
                <dl className="ledger-item__facts">
                  <div>
                    <dt>{t("ballots.columns.status")}</dt>
                    <dd>
                      <StageLabel ballot={ballot} stage={stage} now={now} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t("ballots.columns.turnout")}</dt>
                    <dd className="num">{t("ballots.turnout", { votes: formatNumber(ballot.totalVotes, lang), electorate: formatNumber(ballot.electorate, lang) })}</dd>
                  </div>
                  <div>
                    <dt>{t("ballots.columns.result")}</dt>
                    <dd dir="auto">{resultText(ballot, stage, t)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}
