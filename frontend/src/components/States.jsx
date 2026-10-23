/**
 * The four states of a region that loads data: loading (a skeleton in the shape of
 * what is coming), empty (what belongs here and the one action that fills it),
 * error (what broke and what to do) and full, which is each page's own.
 */
import { useLocale } from "../i18n/index.jsx";
import Icon from "./Icon.jsx";

/** A placeholder in the shape of the content. Still, not shimmering: it says "reading", it does not perform. */
export function Skeleton({ rows = 3, label }) {
  const { t } = useLocale();
  return (
    <div className="skeleton" role="status" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label ?? t("states.loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton__row" key={i} aria-hidden="true">
          <span className="skeleton__bar skeleton__bar--wide" />
          <span className="skeleton__bar skeleton__bar--narrow" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <h2 className="empty__title">{title}</h2>
      {children && <p className="empty__body">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, children, onRetry }) {
  const { t } = useLocale();
  return (
    <div className="problem" role="alert">
      <h2 className="problem__title">
        <Icon name="alert" /> {title}
      </h2>
      {children && <p className="problem__body">{children}</p>}
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          {t("states.retry")}
        </button>
      )}
    </div>
  );
}

/** A short message that is not a failure: stale data, a hint, something that needs doing first. */
export function Notice({ tone = "info", children, role = "status" }) {
  return (
    <p className={`notice notice--${tone}`} role={role}>
      <Icon name={tone === "error" ? "alert" : tone === "success" ? "check" : "info"} />
      <span>{children}</span>
    </p>
  );
}
