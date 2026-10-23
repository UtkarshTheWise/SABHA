import { useEffect, useRef, useState } from "react";

import { useLocale } from "../i18n/index.jsx";
import Icon from "./Icon.jsx";

/**
 * Copies a value, and says so in its own label for a moment: no toast, since the
 * member can see what happened. Hidden where the browser cannot copy (an insecure
 * page), because a button that does nothing is worse than none.
 */
export default function CopyButton({ value, label }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (typeof navigator === "undefined" || !navigator.clipboard) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the browser refused; the value is still on screen to select */
    }
  }

  return (
    <button type="button" className="btn btn--quiet btn--small" onClick={copy}>
      <Icon name={copied ? "check" : "copy"} />
      <span aria-live="polite">{copied ? t("copy.copied") : label ?? t("copy.copy")}</span>
    </button>
  );
}
