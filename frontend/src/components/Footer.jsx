import { useLocale } from "../i18n/index.jsx";
import { shorten } from "../lib/format.js";
import { Link } from "../router.jsx";
import { useChain } from "../state/chain.jsx";
import { useNetwork } from "../state/network.jsx";

/**
 * What the page is reading, stated plainly at the foot of every screen: which
 * network, which contracts, and the latest block. A member or an auditor can see
 * at a glance that the numbers above come from a ledger they can check.
 */
export default function Footer() {
  const { t } = useLocale();
  const { network } = useNetwork();
  const { blockNumber } = useChain();
  return (
    <footer className="foot">
      <div className="container">
        <dl className="foot__facts">
          <div>
            <dt>{t("footer.network")}</dt>
            <dd>{network.label}</dd>
          </div>
          <div>
            <dt>{t("footer.block")}</dt>
            <dd className="num">{blockNumber}</dd>
          </div>
          <div>
            <dt>{t("footer.ballots")}</dt>
            <dd className="num" title={network.contracts.DirectDemocracy.address}>
              {shorten(network.contracts.DirectDemocracy.address, 8, 6)}
            </dd>
          </div>
          <div>
            <dt>{t("footer.roster")}</dt>
            <dd className="num" title={network.contracts.MemberRegistry.address}>
              {shorten(network.contracts.MemberRegistry.address, 8, 6)}
            </dd>
          </div>
        </dl>
        <p className="muted">
          {t("footer.note")} <Link to={["network"]}>{t("footer.details")}</Link>
        </p>
      </div>
    </footer>
  );
}
