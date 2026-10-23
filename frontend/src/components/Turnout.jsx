/**
 * Turnout against the quorum, measured against the electorate fixed when the
 * ballot was created. A bar with a marker where the quorum falls, and the same
 * thing in a sentence, because the bar alone says nothing to a screen reader.
 */
import { useLocale } from "../i18n/index.jsx";
import { quorumMet } from "../lib/tally.js";
import { turnoutOf } from "../lib/proposal.js";
import { formatNumber } from "../lib/format.js";

export default function Turnout({ ballot }) {
  const { t, lang } = useLocale();
  const turnout = turnoutOf(ballot);
  const reached = quorumMet(turnout.total, turnout.electorate, ballot.quorumBps);
  const params = {
    votes: formatNumber(turnout.total, lang),
    electorate: formatNumber(turnout.electorate, lang),
    needed: formatNumber(turnout.needed, lang),
  };
  const sentence = reached ? t("turnout.summaryReached", params) : t("turnout.summary", params);

  return (
    <div className="turnout">
      <h3 className="turnout__title">{t("turnout.title")}</h3>
      <svg className="meter" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label={sentence} focusable="false">
        <rect className="meter__track" x="0" y="0" width="100" height="10" />
        <rect className="meter__fill" x="0" y="0" width={turnout.percent} height="10" />
        <line className="meter__marker" x1={turnout.quorumPercent} x2={turnout.quorumPercent} y1="0" y2="10" />
      </svg>
      <p>{sentence}</p>
      <p className="turnout__state">
        <strong>{reached ? t("turnout.reached") : t("turnout.notYet")}</strong>
      </p>
    </div>
  );
}
