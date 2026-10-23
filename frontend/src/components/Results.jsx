/**
 * The count, option by option. Each row carries its figure, its share, a bar and
 * the tally marks, and a word where an option leads, wins or is level, so a
 * reader who cannot tell colours apart loses nothing. Option text is the officer's
 * own and is shown exactly as written.
 */
import { useLocale } from "../i18n/index.jsx";
import { formatNumber } from "../lib/format.js";
import { outcomeOf } from "../lib/proposal.js";
import { share, totalOf } from "../lib/tally.js";
import TallyMarks from "./TallyMarks.jsx";

export default function Results({ ballot }) {
  const { t, lang } = useLocale();
  const outcome = outcomeOf(ballot);
  const total = totalOf(ballot.tally);

  const badgeFor = (index) => {
    if (total === 0) return null;
    if (outcome.kind === "carried" && outcome.winner === index) return "winner";
    if (outcome.kind === "advisory" && outcome.winner === index) return "advisory";
    if (outcome.kind === "tied" && outcome.leading.includes(index)) return "level";
    if (outcome.kind === "counting") {
      if (outcome.leading.length === 1 && outcome.leading[0] === index) return "leading";
      if (outcome.leading.length > 1 && outcome.leading.includes(index)) return "level";
    }
    return null;
  };

  return (
    <div className="results">
      <h3 className="results__title">{outcome.kind === "counting" ? t("results.live") : t("results.final")}</h3>
      <ul className="results__list">
        {ballot.options.map((option, index) => {
          const count = ballot.tally[index];
          const percent = share(count, total);
          const badge = badgeFor(index);
          return (
            <li className={badge ? "result result--ahead" : "result"} key={index}>
              <div className="result__head">
                <span className="result__name" dir="auto">
                  {option}
                </span>
                <span className="result__count num">
                  {formatNumber(count, lang)}
                  <span className="visually-hidden"> {t("results.unit", { count })}</span>
                </span>
              </div>
              <svg className="share-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <rect className="share-bar__track" x="0" y="0" width="100" height="6" />
                <rect className="share-bar__fill" x="0" y="0" width={percent} height="6" />
              </svg>
              <div className="result__foot">
                <TallyMarks count={count} />
                <span className="result__share">{t("results.share", { percent: formatNumber(percent, lang) })}</span>
                {badge && <span className="badge">{t(`results.badge.${badge}`)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {total === 0 && <p className="muted">{t("results.none")}</p>}
    </div>
  );
}
