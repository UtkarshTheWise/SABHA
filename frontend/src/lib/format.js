/**
 * Display helpers. Every one takes the locale rather than reading a global, so
 * the same function serves English, Hindi and Tamil and can be tested alone.
 * On-chain text (titles, options, descriptions) is never passed through here:
 * it is shown exactly as it was written.
 */

const ELLIPSIS = "…";

/** 0x1234…abcd, for an address or a hash. */
export function shorten(value, head = 6, tail = 4) {
  const text = String(value ?? "");
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}${ELLIPSIS}${text.slice(-tail)}`;
}

const INTL_LOCALE = { en: "en-IN", hi: "hi-IN", ta: "ta-IN" };
export const intlLocale = (lang) => INTL_LOCALE[lang] || "en-IN";

export function formatNumber(value, lang = "en") {
  return new Intl.NumberFormat(intlLocale(lang)).format(Number(value));
}

export function formatPercent(value, lang = "en") {
  return new Intl.NumberFormat(intlLocale(lang), { style: "percent", maximumFractionDigits: 0 }).format(Number(value) / 100);
}

/** A moment given in seconds since the epoch, in the viewer's own time zone. */
export function formatDateTime(seconds, lang = "en") {
  if (seconds === null || seconds === undefined || Number(seconds) <= 0) return "";
  return new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(seconds) * 1000));
}

export function formatDate(seconds, lang = "en") {
  if (seconds === null || seconds === undefined || Number(seconds) <= 0) return "";
  return new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium" }).format(new Date(Number(seconds) * 1000));
}

/** "2 d 3 hr": units from countdownUnits(), spelled by the browser for the language. */
export function formatUnits(units, lang = "en") {
  return units
    .map(([unit, amount]) =>
      new Intl.NumberFormat(intlLocale(lang), { style: "unit", unit, unitDisplay: "short" }).format(amount)
    )
    .join(" ");
}

/** A byte count or gas figure with grouping, e.g. 106,302. */
export function formatGas(value, lang = "en") {
  return formatNumber(value, lang);
}

/** Seconds as a short span: 2 s, 12 s, 1 min 5 s. For block times. */
export function formatSeconds(value, lang = "en") {
  const total = Math.round(Number(value));
  const loc = intlLocale(lang);
  if (total < 60) return new Intl.NumberFormat(loc, { style: "unit", unit: "second", unitDisplay: "short" }).format(total);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  const m = new Intl.NumberFormat(loc, { style: "unit", unit: "minute", unitDisplay: "short" }).format(minutes);
  return rest ? `${m} ${new Intl.NumberFormat(loc, { style: "unit", unit: "second", unitDisplay: "short" }).format(rest)}` : m;
}

/** Roughly how long ago, for a block's age. Largest unit only. */
export function formatAgo(seconds, now, lang = "en") {
  const diff = Math.max(0, Math.round(now - Number(seconds)));
  const rtf = new Intl.RelativeTimeFormat(intlLocale(lang), { numeric: "auto", style: "short" });
  if (diff < 60) return rtf.format(-diff, "second");
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), "hour");
  return rtf.format(-Math.floor(diff / 86400), "day");
}
