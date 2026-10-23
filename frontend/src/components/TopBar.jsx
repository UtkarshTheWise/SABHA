/**
 * The shell: a top bar, because four destinations do not earn a sidebar. Wide, the
 * language and network choices sit in the bar; under 60rem they move into a menu,
 * so the bar keeps only the wordmark, the menu button and the wallet.
 */
import { useEffect, useId, useRef, useState } from "react";

import { LANGUAGES, useLocale } from "../i18n/index.jsx";
import { shorten } from "../lib/format.js";
import { NETWORKS, rememberNetwork } from "../lib/networks.js";
import { Link, useRoute } from "../router.jsx";
import { useChain } from "../state/chain.jsx";
import { useNetwork } from "../state/network.jsx";
import { useMediaQuery, useUi } from "../state/ui.jsx";
import { useWallet } from "../state/wallet.jsx";
import Icon from "./Icon.jsx";

function Choices({ onNetwork, idPrefix }) {
  const { t, lang, setLang } = useLocale();
  const { network } = useNetwork();

  return (
    <div className="bar-choices">
      <div className="choice">
        <label htmlFor={`${idPrefix}-lang`}>{t("controls.language")}</label>
        <select id={`${idPrefix}-lang`} value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      {NETWORKS.length > 1 && (
        <div className="choice">
          <label htmlFor={`${idPrefix}-network`}>{t("controls.network")}</label>
          <select
            id={`${idPrefix}-network`}
            value={network.key}
            onChange={(e) => {
              const next = NETWORKS.find((n) => n.key === e.target.value);
              if (next) {
                rememberNetwork(next.key);
                onNetwork(next);
              }
            }}
          >
            {NETWORKS.map((n) => (
              <option key={n.key} value={n.key}>
                {n.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export default function TopBar({ onNetwork }) {
  const { t } = useLocale();
  const { path } = useRoute();
  const { account, kind } = useWallet();
  const { me } = useChain();
  const { openWallet } = useUi();
  const wide = useMediaQuery("(min-width: 60rem)");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButton = useRef(null);

  const isOfficer = me.roles.registrar || me.roles.proposer || me.roles.admin;
  const section = path[0] ?? "ballots";
  const destinations = [
    { to: [], key: "ballots", label: t("nav.ballots"), current: section === "ballots" || section === "ballot" },
    { to: ["mine"], key: "mine", label: t("nav.mine"), current: section === "mine" },
    ...(isOfficer ? [{ to: ["officer"], key: "officer", label: t("nav.officer"), current: section === "officer" }] : []),
    { to: ["network"], key: "network", label: t("nav.network"), current: section === "network" },
  ];

  // The menu closes on Escape, on choosing a destination, and when the bar goes wide.
  useEffect(() => {
    if (wide) setMenuOpen(false);
  }, [wide]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const links = (
    <ul className="bar-links">
      {destinations.map((d) => (
        <li key={d.key}>
          <Link to={d.to} aria-current={d.current ? "page" : undefined} onClick={() => setMenuOpen(false)}>
            {d.label}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <header className="bar">
      {/* The address bar holds the route, so this moves focus itself instead of writing "#main" over it. */}
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {t("app.skip")}
      </a>
      <div className="bar__inner container">
        <Link to={[]} className="wordmark" aria-label={t("nav.home")}>
          Sabha
        </Link>

        {wide && <nav aria-label={t("nav.primary")}>{links}</nav>}

        <div className="bar__end">
          {wide && <Choices onNetwork={onNetwork} idPrefix="bar" />}
          <button type="button" className="btn btn--bar" onClick={openWallet}>
            {account ? (
              <>
                <Icon name={kind === "local" ? "lock" : "check"} />
                <span className="num">{shorten(account)}</span>
              </>
            ) : (
              t("wallet.connect")
            )}
          </button>
          {!wide && (
            <button
              ref={menuButton}
              type="button"
              className="btn btn--bar"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name={menuOpen ? "close" : "menu"} />
              {t("nav.menu")}
            </button>
          )}
        </div>
      </div>

      {!wide && menuOpen && (
        <div className="bar__menu" id={menuId}>
          <nav className="container" aria-label={t("nav.primary")}>
            {links}
            <Choices onNetwork={onNetwork} idPrefix="menu" />
          </nav>
        </div>
      )}
    </header>
  );
}
