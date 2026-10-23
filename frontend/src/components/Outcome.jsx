/**
 * What the result means, in a sentence a member cannot misread. "Carried",
 * "advisory because turnout missed the quorum", "tied" and "nobody voted" are four
 * different outcomes and each gets its own words, an icon where it helps, and the
 * reason, so a result is never a bare option name.
 */
import { useLocale } from "../i18n/index.jsx";
import { formatNumber } from "../lib/format.js";
import { outcomeOf } from "../lib/proposal.js";
import Icon from "./Icon.jsx";

export default function Outcome({ ballot, stage }) {
  const { t, lang } = useLocale();
  if (stage === "withdrawn") {
    return (
      <p className="outcome" role="status">
        <Icon name="info" /> {t("outcome.withdrawn")}
      </p>
    );
  }
  if (stage !== "closed" && stage !== "finalised") return null;

  const o = outcomeOf(ballot);
  const numbers = { votes: formatNumber(o.total, lang), electorate: formatNumber(o.electorate, lang), needed: formatNumber(o.needed, lang) };
  const optionName = (i) => ballot.options[i];

  if (o.kind === "counting") {
    return (
      <p className="outcome" role="status">
        <Icon name="info" /> {t("outcome.counting")}
      </p>
    );
  }

  const heading = {
    carried: t("outcome.carried", { option: optionName(o.winner) }),
    advisory: t("outcome.advisory", { option: optionName(o.winner) }),
    tied: t("outcome.tied"),
    no_votes: t("outcome.noVotes"),
  }[o.kind];

  const detail = {
    carried: t("outcome.carriedDetail", numbers),
    advisory: t("outcome.advisoryDetail", numbers),
    tied: t("outcome.tiedDetail", { options: o.leading.map(optionName).join(", "), count: formatNumber(Math.max(...ballot.tally), lang) }),
    no_votes: t("outcome.noVotesDetail"),
  }[o.kind];

  return (
    <div className={`outcome outcome--${o.kind}`}>
      <h3 className="outcome__heading" dir="auto">
        <Icon name={o.kind === "carried" ? "check" : "alert"} /> {heading}
      </h3>
      <p>{detail}</p>
    </div>
  );
}
