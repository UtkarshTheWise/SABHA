/**
 * Where a ballot is in its life: Pending, Active, Closed, Finalised. Each step says
 * done, now or next in words (and a check mark where done), and the current one
 * carries the countdown, so the state is never a matter of colour.
 */
import { useLocale } from "../i18n/index.jsx";
import { formatDate, formatDateTime, formatUnits } from "../lib/format.js";
import { countdownUnits, secondsToNextChange, timeline } from "../lib/proposal.js";
import Icon from "./Icon.jsx";

export function useCountdownText() {
  const { t, lang } = useLocale();
  return (seconds) => {
    const units = countdownUnits(seconds);
    return units[0][0] === "minute" && units[0][1] === 0 ? t("time.underMinute") : formatUnits(units, lang);
  };
}

export default function Timeline({ ballot, now }) {
  const { t, lang } = useLocale();
  const countdown = useCountdownText();
  const { stage, steps } = timeline(ballot, now);
  if (stage === "withdrawn") return null;
  const remaining = secondsToNextChange(ballot, now);

  const detail = (step) => {
    const key = `timeline.detail.${step.name}.${step.state}`;
    if (step.state === "current" && remaining !== null) return t(key, { time: countdown(remaining) });
    return t(key, { date: step.name === "active" && step.state === "done" ? formatDateTime(ballot.closesAt, lang) : formatDateTime(step.at, lang), day: formatDate(step.at, lang) });
  };

  return (
    <ol className="steps" aria-label={t("timeline.label")}>
      {steps.map((step) => (
        <li key={step.name} className={`steps__item steps__item--${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="steps__name">{t(`stage.${step.name}`)}</span>
          <span className="steps__state">
            {step.state === "done" && <Icon name="check" size={16} />}
            {t(`timeline.state.${step.state}`)}
          </span>
          <span className="steps__detail">{detail(step)}</span>
        </li>
      ))}
    </ol>
  );
}
